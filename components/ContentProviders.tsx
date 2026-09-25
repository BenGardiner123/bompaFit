'use client';

/**
 * Settings → Exercise instructions: connecting a service, reviewing suggested links,
 * downloading for offline, and each provider's credits.
 *
 * Nothing on this screen talks to a provider by itself. Every request starts
 * from a button the user pressed, or from the one automatic match run right
 * after they connect — so opening this screen with nothing connected sends nothing.
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { ContentProvider, TestResult } from '@/lib/content/provider';
import { loadProvider } from '@/lib/content/registry';
import type { DownloadRun } from '@/lib/content/resolve';
import type { MatchRun } from '@/lib/content/match';
import { C, FONT, R, T, TOUCH, num } from '@/lib/tokens';
import { useBompa } from '@/state/BompaContext';
import { Btn, Row, Section, Segmented, Tag } from '@/components/ui';
import { LinkReviewSheet } from '@/components/LinkReviewSheet';

type Connection = ReturnType<typeof useBompa>['contentConnections'][number];

export function ContentProviders() {
  const b = useBompa();
  const entries = b.contentProviders;
  const adapters = useAdapters(entries.map((entry) => entry.id));
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Section title="Exercise content" right="optional">
      <p style={{ margin: '0 0 12px', fontSize: T.sm, lineHeight: 1.5, color: C.tertiary }}>
        Nothing is sent anywhere unless you connect a service. Once you do, lookups send that service only exercise names and ids — never
        your training.
      </p>
      {entries.length === 0 && (
        <span style={{ fontSize: T.sm, lineHeight: 1.5, color: C.tertiary, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
          No services can be connected in this version of Bompa.
        </span>
      )}
      {entries.map((entry) => {
        const adapter = adapters.get(entry.id);
        const connection = b.contentConnections.find((c) => c.providerId === entry.id);
        const expanded = open === entry.id;
        return (
          <Row
            key={entry.id}
            title={entry.name}
            titleSize={14}
            sub={adapter ? offers(adapter) : adapter === null ? 'Not available right now' : undefined}
            onClick={() => setOpen(expanded ? null : entry.id)}
            label={`${entry.name}, ${connection ? 'connected' : 'not connected'}`}
            right={
              connection ? (
                <Tag bg={C.greenBg} fg={C.greenDark}>
                  CONNECTED
                </Tag>
              ) : (
                <span style={{ fontSize: T.sm, fontWeight: 800, color: C.amberDark }}>{expanded ? 'Close' : 'Connect'}</span>
              )
            }
          >
            {expanded && adapter && !connection && <ConnectPanel provider={adapter} onDone={() => setOpen(entry.id)} />}
            {expanded && adapter && connection && <ConnectedPanel provider={adapter} connection={connection} />}
          </Row>
        );
      })}
      <Credits adapters={adapters} />
    </Section>
  );
}

/**
 * The adapters themselves, for what each can do and how it signs in. They are
 * loaded when this screen is opened — code from Bompa's own origin, never a request
 * to the provider — so a person who never visits this screen never pays for them.
 */
function useAdapters(ids: string[]): Map<string, ContentProvider | null> {
  const [adapters, setAdapters] = useState<Map<string, ContentProvider | null>>(new Map());
  const key = ids.join('|');
  useEffect(() => {
    let live = true;
    for (const id of key ? key.split('|') : []) {
      void loadProvider(id).then((adapter) => {
        if (live) setAdapters((prev) => new Map(prev).set(id, adapter));
      });
    }
    return () => {
      live = false;
    };
  }, [key]);
  return adapters;
}

/** "Instructions, pictures and video (online only) · free, no account" */
function offers(provider: ContentProvider): string {
  const parts = [provider.capabilities.steps && 'instructions', provider.capabilities.images && 'pictures', provider.capabilities.video && 'video (online only)'].filter(
    (part): part is string => Boolean(part),
  );
  const what = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? 'content');
  const how = provider.auth.kind === 'none' ? 'free, no account' : 'needs your API key';
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} · ${how}`;
}

/**
 * Whether what may be kept on the phone depends on the user's plan. Asked of
 * the adapter's own rules rather than a flag, so the question appears exactly
 * when the answer changes something.
 */
function cachingDependsOnPlan(provider: ContentProvider): boolean {
  const base = { providerId: provider.id, connectedAt: 0, rank: 0 };
  const no = provider.cachePolicy({ ...base, cachingAllowed: false });
  const yes = provider.cachePolicy({ ...base, cachingAllowed: true });
  return no.textMaxAgeMs !== yes.textMaxAgeMs || no.imageMaxAgeMs !== yes.imageMaxAgeMs;
}

function testSentence(result: TestResult, provider: ContentProvider): string {
  if (result.ok) {
    return result.quotaRemaining === undefined
      ? `It works. ${provider.name} answered.`
      : `It works. ${result.quotaRemaining.toLocaleString('en-GB')} calls left on your plan.`;
  }
  switch (result.reason) {
    case 'unauthorised':
      return provider.auth.kind === 'apiKey' ? 'That key was refused — check it was copied whole.' : `${provider.name} refused the request.`;
    case 'quota':
      return `Your quota with ${provider.name} is used up for now. Try again later.`;
    case 'network':
      return `Couldn't reach ${provider.name} — are you online?`;
    case 'blocked':
      return 'That address isn’t allowed. It must start with https://.';
    case 'unexpected':
      return `${provider.name} answered in a way Bompa doesn't understand. Try again later.`;
  }
}

function ConnectPanel({ provider, onDone }: { provider: ContentProvider; onDone: () => void }) {
  const b = useBompa();
  const online = useOnline();
  const keyed = provider.auth.kind === 'apiKey';
  const askCaching = useMemo(() => cachingDependsOnPlan(provider), [provider]);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [cachingAllowed, setCachingAllowed] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  // A passing test only vouches for exactly what was tested. Change the key or
  // the address and Connect has to be earned again.
  const edit = (apply: () => void) => {
    apply();
    setResult(null);
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    const outcome = await b.testProvider(provider.id, { apiKey: keyed ? apiKey : undefined, baseUrl: provider.allowsBaseUrl ? baseUrl : undefined });
    setResult(outcome);
    setTesting(false);
  };

  const passed = result?.ok === true;
  const missingKey = keyed && apiKey.trim() === '';

  return (
    <div style={panel}>
      {keyed && provider.auth.kind === 'apiKey' && (
        <>
          <Field label="API key">
            <input
              type="password"
              value={apiKey}
              onChange={(event) => edit(() => setApiKey(event.target.value))}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              style={input}
            />
          </Field>
          <a href={provider.auth.helpUrl} target="_blank" rel="noopener noreferrer" style={link}>
            Where to get a key
          </a>
          <Note>Your key is stored only on this phone. It is not in your backup file. Disconnecting deletes it.</Note>
        </>
      )}

      {provider.allowsBaseUrl && (
        <Field label={`Your own ${provider.name} server (optional)`}>
          <input
            type="url"
            inputMode="url"
            value={baseUrl}
            onChange={(event) => edit(() => setBaseUrl(event.target.value))}
            placeholder={provider.apiHosts[0] ? `https://${provider.apiHosts[0]}` : 'https://'}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            style={input}
          />
        </Field>
      )}

      {askCaching && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800 }}>Does your plan allow saving content on this phone?</span>
          <Segmented
            value={cachingAllowed ? 'yes' : 'no'}
            label="Does your plan allow saving content on this phone?"
            itemWidth={60}
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes' },
            ]}
            onChange={(value) => setCachingAllowed(value === 'yes')}
          />
          <Note>
            {cachingAllowed
              ? `Instructions and pictures are kept on this phone for offline use, and deleted when ${provider.name}'s terms say they must go.`
              : 'Instructions show while you are online and are never saved on this phone, so they are not there offline.'}
          </Note>
        </div>
      )}

      <div style={{ display: 'flex', gap: 7 }}>
        <Btn onClick={() => void test()} disabled={testing || missingKey || !online} style={{ ...outline, flex: 1 }}>
          {testing ? 'Testing…' : 'Test connection'}
        </Btn>
        <Btn
          onClick={() => {
            b.connectProvider(provider.id, {
              apiKey: keyed ? apiKey : undefined,
              baseUrl: provider.allowsBaseUrl ? baseUrl : undefined,
              cachingAllowed: askCaching ? cachingAllowed : false,
            });
            // The typed key goes to storage and leaves this screen's memory.
            setApiKey('');
            b.say(`Connected to ${provider.name}. Looking for matches.`);
            onDone();
          }}
          disabled={!passed}
          style={{ ...solid, flex: 1 }}
        >
          Connect
        </Btn>
      </div>
      <div role="status" style={{ fontSize: T.sm, lineHeight: 1.5, fontWeight: 700, color: result && !result.ok ? C.redDark : C.greenDark, ...num }}>
        {!online ? 'Needs a connection.' : result ? testSentence(result, provider) : ''}
      </div>
    </div>
  );
}

function ConnectedPanel({ provider, connection }: { provider: ContentProvider; connection: Connection }) {
  const b = useBompa();
  const online = useOnline();
  const [reviewing, setReviewing] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matchNote, setMatchNote] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [downloadNote, setDownloadNote] = useState('');
  const [saved, setSaved] = useState<{ text: number; images: number } | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [forgetLinks, setForgetLinks] = useState(false);

  const links = b.contentLinks.filter((l) => l.providerId === provider.id);
  const suggested = links.filter((l) => l.status === 'suggested').length;
  const none = links.filter((l) => l.status === 'none').length;
  const confirmed = new Set(links.filter((l) => l.status === 'confirmed').map((l) => l.exerciseId));
  const lifts = [...new Set(b.routines.flatMap((routine) => routine.slots.map((slot) => slot.exerciseId)))];
  const linkedLifts = lifts.filter((id) => confirmed.has(id)).length;

  // The adapter's rules need the whole connection shape; the key is the one
  // part the interface never holds, and no rule depends on it.
  const policy = provider.cachePolicy({ ...connection, apiKey: undefined });
  const mayStore = policy.textMaxAgeMs !== 0;
  const inSession = Boolean(b.openSession);

  const refreshSaved = () => {
    void b
      .savedContent(provider.id)
      .then(setSaved)
      .catch(() => setSaved(null));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refreshSaved, [provider.id]);

  const findMatches = async () => {
    setMatching(true);
    setMatchNote('');
    const run = await b.findMatches(provider.id);
    setMatchNote(matchSentence(run, provider.name));
    setMatching(false);
  };

  const download = async () => {
    setDownloadNote('');
    setProgress({ done: 0, total: 0 });
    const run = await b.downloadContent(provider.id, (done, total) => setProgress({ done, total }));
    setProgress(null);
    setDownloadNote(downloadSentence(run, provider.name));
    refreshSaved();
  };

  return (
    <div style={panel}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13.5, fontWeight: 800, ...num }}>
          Linked {linkedLifts} of {lifts.length} {lifts.length === 1 ? 'lift' : 'lifts'} in your workouts
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.tertiary, ...num }}>
          {confirmed.size} linked · {suggested} to review · {none} with no match
        </span>
      </div>

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {suggested > 0 && (
          <Btn onClick={() => setReviewing(true)} style={{ ...solid, flex: '1 1 140px' }}>
            Review {suggested} {suggested === 1 ? 'suggestion' : 'suggestions'}
          </Btn>
        )}
        <Btn onClick={() => void findMatches()} disabled={matching || !online} style={{ ...outline, flex: '1 1 140px' }}>
          {!online ? 'Needs a connection' : matching ? 'Searching…' : 'Find matches'}
        </Btn>
      </div>
      {matchNote && <Note live>{matchNote}</Note>}

      {mayStore ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Btn onClick={() => void download()} disabled={progress !== null || !online || inSession} style={outline}>
            {progress ? `Downloading ${progress.done} of ${progress.total}…` : !online ? 'Needs a connection' : 'Download for offline'}
          </Btn>
          {inSession && <Note>Downloads wait until your session is finished.</Note>}
          {progress && (
            <div
              role="progressbar"
              aria-label="Download for offline"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              style={{ height: 4, borderRadius: R.pill, background: C.line, overflow: 'hidden' }}
            >
              <div style={{ height: '100%', width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: C.amber }} />
            </div>
          )}
          <Note live>{downloadNote}</Note>
          {saved && (
            <span style={{ fontSize: 12, fontWeight: 700, color: C.tertiary, ...num }}>
              Saved on this phone: {saved.text} {saved.text === 1 ? 'instruction' : 'instructions'}, {saved.images} {saved.images === 1 ? 'image' : 'images'}
            </span>
          )}
        </div>
      ) : (
        <Note>Your {provider.name} plan doesn&apos;t allow saving content on this phone, so instructions show only while you are online.</Note>
      )}

      {confirmingDisconnect ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
          <Note>
            Disconnecting deletes {connection.hasKey ? 'your key and ' : ''}everything saved from {provider.name} on this phone. Your links stay
            unless you forget them too.
          </Note>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: TOUCH, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={forgetLinks}
              onChange={(event) => setForgetLinks(event.target.checked)}
              style={{ width: 20, height: 20, accentColor: C.ink, margin: 0 }}
            />
            Also forget links
          </label>
          <div style={{ display: 'flex', gap: 7 }}>
            <Btn
              onClick={() => {
                void b.disconnectProvider(provider.id, { forgetLinks });
                b.say(`Disconnected from ${provider.name}.`);
              }}
              style={{ ...outline, flex: 1, border: `1px solid ${C.redBd}`, background: C.redBg, color: C.redDark }}
            >
              Disconnect {provider.name}
            </Btn>
            <Btn onClick={() => setConfirmingDisconnect(false)} style={{ ...outline, flex: 1 }}>
              Keep it
            </Btn>
          </div>
        </div>
      ) : (
        <Btn onClick={() => setConfirmingDisconnect(true)} style={{ ...outline, color: C.redDark }}>
          Disconnect
        </Btn>
      )}

      <LinkReviewSheet open={reviewing} onClose={() => setReviewing(false)} providerId={provider.id} providerName={provider.name} />
    </div>
  );
}

function matchSentence(run: MatchRun, name: string): string {
  const found = run.suggestions.length;
  const head = found === 0 ? 'No new suggestions.' : `${found} new ${found === 1 ? 'suggestion' : 'suggestions'} to review.`;
  switch (run.stoppedBy) {
    case undefined:
      return run.searched === 0 ? 'Every lift already has a link or an answer.' : head;
    case 'quota':
      return `${head} Stopped early: your quota with ${name} is used up for now.`;
    case 'network':
      return `${head} Stopped early: couldn't reach ${name}.`;
    case 'unauthorised':
      return `${head} ${name} refused the key. Disconnect and connect again with a fresh one.`;
    default:
      return `${head} Stopped early: something went wrong. Try again later.`;
  }
}

function downloadSentence(run: DownloadRun, name: string): string {
  const sofar = `${run.done} of ${run.total}`;
  switch (run.stoppedBy) {
    case undefined:
      return run.total === 0 ? 'Nothing to download yet — link some lifts in your workouts first.' : `Downloaded ${sofar}.`;
    case 'quota':
      return `Stopped at ${sofar}: your quota with ${name} is used up. Try again later.`;
    case 'network':
      return `Stopped at ${sofar}: couldn't reach ${name}. Try again when you're online.`;
    case 'not-allowed':
      return `Your ${name} plan doesn't allow saving content on this phone, so nothing was downloaded.`;
    case 'in-session':
      return 'Downloads wait until your session is finished.';
    case 'cancelled':
      return `Stopped at ${sofar}. Try again whenever you like.`;
    case 'unauthorised':
      return `Stopped at ${sofar}: ${name} refused the key.`;
    default:
      return `Stopped at ${sofar}: something went wrong. Try again later.`;
  }
}

/** One attribution line per connected service. */
function Credits({ adapters }: { adapters: Map<string, ContentProvider | null> }) {
  const b = useBompa();
  if (b.contentConnections.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
      {b.contentConnections.map((connection) => {
        const name = adapters.get(connection.providerId)?.name ?? connection.name;
        return (
          <span key={connection.providerId} style={{ fontSize: 11.5, lineHeight: 1.5, color: C.tertiary }}>
            Exercise content from {name}, fetched with your own access. Each How-to sheet names the source, with the licence and author
            wherever {name} gives them.
          </span>
        );
      })}
    </div>
  );
}

/** The browser's own word on whether it is offline. It is only ever sure about "no". */
function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 800, color: C.tertiary }}>
      {label}
      {children}
    </label>
  );
}

function Note({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <span role={live ? 'status' : undefined} style={{ fontSize: T.sm, lineHeight: 1.5, color: C.tertiary, ...num }}>
      {children}
    </span>
  );
}

const panel: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 14 };

const input: CSSProperties = {
  height: 48,
  borderRadius: R.control,
  border: `1px solid ${C.lineStrong}`,
  background: C.card,
  color: C.ink,
  padding: '0 12px',
  fontFamily: FONT,
  fontSize: T.md,
  fontWeight: 600,
};

const outline: CSSProperties = {
  minHeight: TOUCH,
  padding: '0 14px',
  borderRadius: R.control,
  border: `1px solid ${C.lineStrong}`,
  background: 'transparent',
  color: C.ink,
  fontSize: 13,
  fontWeight: 800,
  ...num,
};

const solid: CSSProperties = { ...outline, border: 'none', background: C.ink, color: C.white };

const link: CSSProperties = {
  alignSelf: 'flex-start',
  minHeight: TOUCH,
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: T.sm,
  fontWeight: 800,
  color: C.amberDark,
};
