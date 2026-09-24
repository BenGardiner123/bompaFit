'use client';

import { useLayoutEffect, useState } from 'react';
import { HOWTO_BY_ID } from '@/lib/data';
import { statusSentence, type ResolvedHowTo } from '@/lib/content/resolve';
import { C, R, num, onInk } from '@/lib/tokens';
import type { ProviderCredit, ProviderMedia } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { DarkSheet } from '@/components/ui';
import { SheetDot, SheetHeading, sheetHairline } from '@/components/SheetParts';

/**
 * What the sheet shows before the resolver has answered for this movement —
 * the same thing its synchronous first answer would say. The resolver runs in
 * a layout effect, so this only ever lasts for a render nobody sees; it exists
 * so that render never shows the *previous* movement's cues under this title.
 */
function placeholderFor(exerciseId: string): ResolvedHowTo {
  const seeded = HOWTO_BY_ID.get(exerciseId);
  const text = seeded && seeded.steps.length > 0 ? { steps: seeded.steps, ...(seeded.fault ? { fault: seeded.fault } : {}), muscles: seeded.muscles } : null;
  return { exerciseId, text, textSource: text ? 'bundled' : 'none', media: [], status: { kind: 'ok' }, loading: text === null };
}

/**
 * The placeholder's second line when Bompa's own cues are showing. The same
 * words the seeded and ingested cues carry: the resolver passes on steps, not
 * this note, and a sheet that read differently for the two kinds would be odd.
 */
const BUNDLED_NOTE = 'Cues bundled offline · no demo clip yet';

export function HowToSheet() {
  const b = useBompa();
  const id = b.s.howToKey;
  const { resolveHowTo } = b;
  const [resolved, setResolved] = useState<ResolvedHowTo | null>(null);

  // Precedence, caching, the network and the eight-second deadline are all the
  // resolver's business (lib/content/resolve.ts). The sheet shows whatever the
  // latest answer is. A layout effect rather than a plain one: the seeded
  // fourteen answer synchronously, and a passive effect would let the browser
  // paint one frame of "Loading" first on exactly the movements people open most.
  useLayoutEffect(() => {
    if (!id) {
      setResolved(null);
      return;
    }
    // The sheet can close, or move to another lift, while a provider is still
    // being asked. `live` stops a late answer landing on an unmounted sheet or
    // under the wrong title; `cancel` stops the request itself.
    let live = true;
    const resolution = resolveHowTo(id, (next) => {
      if (live) setResolved(next);
    });
    setResolved(resolution.first);
    return () => {
      live = false;
      resolution.cancel();
    };
  }, [id, resolveHowTo]);

  if (!id) return null;

  const exercise = b.exerciseById.get(id);
  const view = resolved?.exerciseId === id ? resolved : placeholderFor(id);
  const providerName = view.providerId ? (b.contentConnections.find((c) => c.providerId === view.providerId)?.name ?? view.providerId) : undefined;
  const name = exercise?.name ?? id;
  const sentence = statusSentence(view.status);
  const close = () => b.patch({ howToKey: null });

  return (
    <DarkSheet
      open
      onClose={close}
      eyebrow="How to"
      title={name}
      sub={view.text?.muscles ?? exercise?.muscle}
      label={`How to perform ${exercise?.name ?? 'this movement'}`}
    >
      <Demo
        media={view.media[0]}
        movement={name}
        providerName={providerName}
        note={view.textSource === 'bundled' ? BUNDLED_NOTE : undefined}
      />

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        <Fact label="Pattern" value={exercise?.pattern ?? '—'} />
        <Fact label="Equipment" value={exercise?.equipment ?? '—'} />
      </div>

      <Cues view={view} sentence={sentence} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <Credits view={view} providerName={providerName} />
          {/* "Checking wger…", "Couldn't reach wger…" and the offline sentences.
              A live region, because it changes while the sheet is already open
              and a screen reader would otherwise never hear that it did. When
              there is no text at all, Cues says the sentence instead. */}
          <span role="status" style={{ fontSize: 11.5, fontWeight: 600, color: onInk.body, lineHeight: 1.4 }}>
            {view.text && sentence}
          </span>
        </div>
        <AvailabilityTag view={view} />
      </div>
    </DarkSheet>
  );
}

/**
 * Whether the words on the sheet will still be here in a basement. OFFLINE
 * for Bompa's own cues, the user's, and anything saved on the phone; ONLINE
 * ONLY when a service's terms forbid keeping what it just sent, because a
 * promise of offline there is one the basement would break. Nothing at all
 * when there are no words to make a promise about.
 */
function AvailabilityTag({ view }: { view: ResolvedHowTo }) {
  if (!view.text) return null;
  // Outlined rather than filled: a filled green tag on ink would be the
  // loudest thing on the sheet, and this is reassurance, not news. Online-only
  // takes the quiet caption colour — worth knowing, not a warning.
  const colour = view.onlineOnly ? onInk.muted : C.greenLight;
  return (
    <span
      style={{
        fontSize: 9.5,
        fontWeight: 800,
        letterSpacing: '.08em',
        padding: '4px 7px',
        borderRadius: 6,
        border: `1px solid ${colour}`,
        color: colour,
        flex: 'none',
      }}
    >
      {view.onlineOnly ? 'ONLINE ONLY' : 'OFFLINE'}
    </span>
  );
}

/**
 * The demonstration box. A provider's picture or clip when the resolver has
 * one; otherwise the placeholder the sheet has always had. Offline, the
 * resolver only offers pictures saved on the phone, but a saved copy can still
 * fail (evicted, corrupt), and a broken-image icon says nothing useful.
 */
function Demo({ media, movement, providerName, note }: { media?: ProviderMedia; movement: string; providerName?: string; note?: string }) {
  // Keyed by URL so a different picture gets its own chance to load.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = Boolean(media) && failedUrl === media?.url;
  const source = providerName ? ` from ${providerName}` : '';

  if (media && !failed) {
    const fill = { width: '100%', height: '100%', objectFit: 'contain', display: 'block' } as const;
    return (
      <div style={{ ...demoBox, padding: 0, overflow: 'hidden' }}>
        {media.kind === 'image' && (
          // eslint-disable-next-line @next/next/no-img-element -- a static export has no image optimiser, and this is another site's picture
          <img src={media.url} alt={`Demonstration of ${movement}${source}`} onError={() => setFailedUrl(media.url)} style={fill} />
        )}
        {/* Streamed only, never saved — providers forbid keeping clips, and one
            runs to tens of megabytes — and never autoplayed: the phone is on a
            gym's data and the user decides when to spend it. The provider's
            watermark is part of the frame and is left alone. */}
        {media.kind === 'video' && (
          <video
            src={media.url}
            controls
            playsInline
            preload="none"
            aria-label={`Demonstration clip of ${movement}${source}`}
            onError={() => setFailedUrl(media.url)}
            style={fill}
          />
        )}
      </div>
    );
  }

  let line = note ?? 'No demo clip yet';
  if (failed && media?.kind === 'image') line = "This picture isn't saved on this phone, and it can't load right now.";
  if (failed && media?.kind === 'video') line = 'This clip needs a connection to play.';

  // The fill is the lighter ink80, where the usual muted grey drops under
  // readable, so both lines use body text.
  return (
    <div style={demoBox}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: onInk.body }}>Demo clip</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: onInk.body }}>{line}</span>
    </div>
  );
}

const demoBox = {
  height: 160,
  flex: 'none',
  borderRadius: R.block,
  background: onInk.line,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 16px',
  textAlign: 'center',
} as const;

/**
 * Who supplied what. Bundled cues keep their dataset credit. A provider is
 * credited for exactly what it supplied: its instructions, its picture, or
 * both on one line when the same credit covers both. Every part of it comes
 * from the saved row, so it reads the same offline.
 */
function Credits({ view, providerName }: { view: ResolvedHowTo; providerName?: string }) {
  const { textCredit, mediaCredit } = view;
  const mediaKind = view.media[0]?.kind === 'video' ? 'Clip' : 'Image';
  const sameCredit = Boolean(textCredit && mediaCredit && sameAs(textCredit, mediaCredit));

  return (
    <>
      {/* The starter movements' cues were written for this app, so they are
          credited as such, not to the dataset the other movements came from. */}
      {view.textSource === 'bundled' && HOWTO_BY_ID.has(view.exerciseId) && (
        <span style={creditText}>Cues written for Bompa · CC0</span>
      )}
      {/* The imported movements' cues are ours too, written from each movement's
          facts; only the movement list itself comes from the dataset. */}
      {view.textSource === 'bundled' && !HOWTO_BY_ID.has(view.exerciseId) && (
        <span style={creditText}>
          Written by Bompa · CC0 · movement from{' '}
          {/* The global link colour is a dark amber tuned for light pages; on ink
              it is too dim to read, so the link takes body text and an underline. */}
          <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener noreferrer" style={creditLink}>
            Free Exercise DB
          </a>
        </span>
      )}
      {view.textSource === 'provider' && textCredit && <CreditLine credit={textCredit} lead={textCredit.line} />}
      {mediaCredit && !sameCredit && <CreditLine credit={mediaCredit} lead={`${mediaKind} from ${providerName ?? 'the connected service'}`} />}
    </>
  );
}

function sameAs(a: ProviderCredit, b: ProviderCredit): boolean {
  return a.line === b.line && a.licence === b.licence && a.licenceUrl === b.licenceUrl && a.author === b.author && a.url === b.url;
}

/**
 * "Instructions from wger · CC-BY-SA 4 · deusinvictus". The lead links to the
 * entry on the provider's site: opening it is a tap, never a background request.
 */
function CreditLine({ credit, lead }: { credit: ProviderCredit; lead: string }) {
  return (
    <span style={creditText}>
      {credit.url ? (
        <a href={credit.url} target="_blank" rel="noopener noreferrer" style={creditLink}>
          {lead}
        </a>
      ) : (
        lead
      )}
      {/* Creative Commons asks for a link to the licence itself, so its name
          is one whenever the provider says where the terms live. */}
      {credit.licence && ' · '}
      {credit.licence && credit.licenceUrl && (
        <a href={credit.licenceUrl} target="_blank" rel="noopener noreferrer license" style={creditLink}>
          {credit.licence}
        </a>
      )}
      {credit.licence && !credit.licenceUrl && credit.licence}
      {credit.author && ` · ${credit.author}`}
    </span>
  );
}

const creditText = { fontSize: 11.5, fontWeight: 600, color: onInk.muted, lineHeight: 1.4, overflowWrap: 'anywhere' } as const;
const creditLink = { color: onInk.body, textDecoration: 'underline' } as const;

/**
 * Three states, as early returns rather than nested ternaries: cues we have,
 * nothing yet but still looking, and nothing at all. The resolver guarantees
 * the middle one ends within eight seconds, in a sentence.
 */
function Cues({ view, sentence }: { view: ResolvedHowTo; sentence: string | null }) {
  const text = view.text;
  if (text) {
    return (
      <>
        <section style={{ display: 'flex', flexDirection: 'column' }}>
          <SheetHeading style={{ paddingBottom: 6 }}>Execution</SheetHeading>
          <ol style={{ display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' }}>
            {text.steps.map((step, index) => (
              <li
                // Index in the key as well: a provider's steps are not
                // guaranteed unique, and a duplicate key drops a row.
                key={`${index}:${step}`}
                style={{ display: 'grid', gridTemplateColumns: '34px 1fr', gap: 10, alignItems: 'baseline', padding: '11px 0', ...sheetHairline }}
              >
                <span aria-hidden style={{ fontSize: 24, fontWeight: 800, lineHeight: 1, color: C.amber, ...num }}>
                  {index + 1}
                </span>
                <span style={{ fontSize: 14, lineHeight: 1.5, color: onInk.body }}>{step}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Only the hand-written 14 (and some providers) have a common fault.
            Free Exercise DB records how to perform a movement and nothing about
            what people get wrong, so the block is dropped rather than filled
            with something invented. */}
        {text.fault && (
          <section style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingTop: 12, ...sheetHairline }}>
            <SheetDot />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <SheetHeading color={C.amberLight}>Common fault</SheetHeading>
              <span style={{ fontSize: 14, lineHeight: 1.5, color: onInk.text }}>{text.fault}</span>
            </div>
          </section>
        )}
      </>
    );
  }

  if (view.loading) {
    return <span style={{ fontSize: 14, lineHeight: 1.5, color: onInk.muted, padding: '12px 0', ...sheetHairline }}>Loading cues…</span>;
  }

  return (
    <span style={{ fontSize: 14, lineHeight: 1.5, color: onInk.muted, padding: '12px 0', ...sheetHairline }}>
      {sentence ?? 'No cues bundled for this movement yet.'}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: onInk.muted }}>{label}</span>
      <span style={{ fontSize: 14.5, fontWeight: 800, color: onInk.text }}>{value}</span>
    </div>
  );
}
