'use client';

// Settings, opened from the gear on Today. A sheet rather than a tab: these
// are set once and rarely touched, and a tab of their own would give them the
// same weight as training.
//
// The longer settings (timer alerts, the default warm-up, where exercise
// instructions come from) are rows that push a full screen of their own, so
// the sheet stays short enough to take in at a glance.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { lastBackupPhrase } from '@/lib/backup';
import { BODYWEIGHT_MAX_KG } from '@/lib/bodyweight';
import { toDisplay, toKg } from '@/lib/calc';
import { db, isPersisted, warn } from '@/lib/db';
import { buildEnvelope, saveEnvelope } from '@/lib/exchange';
import { weightPrecision } from '@/lib/numberEntry';
import { C, R, T, TOUCH, W, num, onInk } from '@/lib/tokens';
import type { Envelope, Unit } from '@/lib/types';
import { useBompa, type PushedView } from '@/state/BompaContext';
import { ImportPreview, useImport } from '@/components/ImportPreview';
import { Icon } from '@/components/icons';
import { Btn, ConfirmSheet, DarkSheet, EditableNumber, InkSegmented } from '@/components/ui';

/** How far below the top of the screen the sheet starts, leaving a strip of Today visible so it reads as over it. */
const SHEET_TOP = 96;

export function SettingsSheet() {
  const b = useBompa();
  const open = b.s.settingsOpen;
  const [confirmErase, setConfirmErase] = useState(false);

  return (
    <>
      {/* Hidden, not closed, while the erase question is up: the question
          covers the whole screen, and Cancel comes back to the sheet. */}
      <DarkSheet open={open && !confirmErase} onClose={b.closeSettings} title="Settings" top={SHEET_TOP}>
        <Group title="You">
          <Bodyweight />
          <Line title="Units">
            <div style={{ width: 150, display: 'flex' }}>
              <InkSegmented
                value={b.s.unit}
                label="Units"
                track={C.ink}
                options={[
                  { value: 'kg' as Unit, label: 'kg' },
                  { value: 'lb' as Unit, label: 'lb' },
                ]}
                onChange={b.setUnit}
              />
            </div>
          </Line>
          <Line title="Week starts">
            <div style={{ width: 150, display: 'flex' }}>
              <InkSegmented
                value={b.s.weekStart}
                label="Week starts"
                track={C.ink}
                options={[
                  { value: 'Mon' as const, label: 'Mon' },
                  { value: 'Sun' as const, label: 'Sun' },
                ]}
                onChange={b.setWeekStart}
              />
            </div>
          </Line>
        </Group>

        <Group title="Training">
          <PushRow view="alerts" title="Timer alerts" sub="Sound, vibration, notifications, screen on" first />
          <PushRow view="warmup" title="Default warm-up" sub="A checklist any workout can use" />
          <PushRow view="content" title="Exercise instructions" sub="Where How-to cues come from" />
        </Group>

        <YourData />

        {/* Last, and pushed to the bottom when there is room: the two that
            start over are the ones least often wanted. */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'auto' }}>
          <div style={CARD}>
            <Btn onClick={b.restartSetup} style={{ ...bottomRow, color: onInk.text, justifyContent: 'space-between' }}>
              Run setup again
              <Icon name="chevron-right" size={16} style={{ color: onInk.muted }} />
            </Btn>
            <Btn onClick={() => setConfirmErase(true)} style={{ ...bottomRow, color: C.redLight, borderTop: `1px solid ${onInk.line}` }}>
              Erase everything…
            </Btn>
          </div>
          <span style={{ fontSize: T.sm, lineHeight: 1.5, color: onInk.muted, padding: '0 4px' }}>
            Running setup again replaces your plan. Workouts, logged sets and history all stay.
          </span>
        </section>

        <Credit />
      </DarkSheet>

      <ConfirmSheet
        open={open && confirmErase}
        title="Erase everything?"
        body="Every session, set and plan on this phone goes, and there is no getting it back. Export a backup first if you might want it."
        confirmLabel="Erase everything"
        onCancel={() => setConfirmErase(false)}
        onConfirm={async () => {
          await db.delete();
          window.location.reload();
        }}
      />
    </>
  );
}

const bottomRow = {
  height: 52,
  display: 'flex',
  alignItems: 'center',
  fontSize: T.title,
  fontWeight: W.button,
  textAlign: 'left',
} as const;

/**
 * A group of settings on one raised card, with hairlines between its rows.
 * Grouped cards rather than a run of rows on the sheet: the groups read as
 * groups without a heading having to do all the work.
 */
const CARD = { background: onInk.raised, borderRadius: R.card, padding: '0 14px', display: 'flex', flexDirection: 'column' } as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h3 style={{ margin: 0, paddingLeft: 4, fontSize: T.sm, fontWeight: W.label, color: onInk.muted }}>
        {title}
      </h3>
      <div style={CARD}>{children}</div>
    </section>
  );
}

/** A setting's name on the left and its control on the right, under a hairline unless it opens its card. */
function Line({ title, sub, first = false, children }: { title: string; sub?: string; first?: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: 58,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        borderTop: first ? 'none' : `1px solid ${onInk.line}`,
        padding: '4px 0',
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: T.title, fontWeight: W.button }}>{title}</span>
        {sub && <span style={{ fontSize: T.sm, fontWeight: W.label, color: onInk.muted, lineHeight: 1.4 }}>{sub}</span>}
      </span>
      {children}
    </div>
  );
}

/** A row that opens a full screen of its own, and comes back here from it. */
function PushRow({ view, title, sub, first = false }: { view: PushedView; title: string; sub: string; first?: boolean }) {
  const b = useBompa();
  return (
    <Btn
      onClick={() => b.openView(view, 'settings')}
      style={{
        minHeight: 58,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderTop: first ? 'none' : `1px solid ${onInk.line}`,
        padding: '4px 0',
        textAlign: 'left',
        color: onInk.text,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: T.title, fontWeight: W.button }}>{title}</span>
        <span style={{ fontSize: T.sm, fontWeight: W.label, color: onInk.muted }}>{sub}</span>
      </span>
      <Icon name="chevron-right" size={16} style={{ color: onInk.muted }} />
    </Btn>
  );
}

/**
 * One number, not a tracker: no history and no graph, because tracking
 * bodyweight is not what Bompa is for. It exists so pull-ups and dips cost
 * something in the fatigue model. Typed in the display unit and converted to
 * kilograms once, on the way in.
 */
function Bodyweight() {
  const b = useBompa();
  const { unit } = b.s;
  const kg = b.bodyweightKg;
  return (
    <Line title="Bodyweight" sub="Used to cost bodyweight lifts in fatigue" first>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, flex: 'none' }}>
        <EditableNumber
          label="Your bodyweight"
          unit={unit}
          value={kg === null ? 0 : toDisplay(kg, unit)}
          min={0}
          max={toDisplay(BODYWEIGHT_MAX_KG, unit)}
          precision={weightPrecision(unit)}
          onCommit={(next) => b.setBodyweightKg(next > 0 ? toKg(next, unit) : null)}
          {...(kg === null ? { display: '—', spoken: 'Your bodyweight not set', openEmpty: true } : {})}
          style={{ fontSize: 20, fontWeight: W.title }}
        />
        <span style={{ fontSize: T.sm, fontWeight: W.label, color: onInk.muted }}>{unit}</span>
      </div>
    </Line>
  );
}

function YourData() {
  const b = useBompa();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Same flow as importing workouts: the file is read and shown first, and
  // nothing is written until "Import it". A backup restore is the import most
  // worth a second look.
  const importer = useImport();

  useEffect(() => {
    void isPersisted().then(setPersisted);
  }, []);

  const exportJson = async () => {
    const now = new Date();
    let envelope: Envelope;
    try {
      envelope = await buildEnvelope(now.toISOString());
    } catch (err) {
      warn(err);
      b.say("Couldn't read the database to export it.");
      return;
    }
    try {
      const outcome = await saveEnvelope(envelope, `bompa-${now.toISOString().slice(0, 10)}.json`);
      if (outcome === 'cancelled') return;
      // A plain download never says whether it landed, so it is still recorded
      // (it almost always does) but the message says where to check rather than
      // promising a file nobody has seen.
      b.recordExport(now.getTime());
      b.say(outcome === 'saved' ? 'Saved. That file is a complete backup.' : 'Backup downloaded. Check your downloads for the file.');
    } catch (err) {
      warn(err);
      b.say("Couldn't save the backup file. Nothing was recorded; try again.");
    }
  };

  const storage = storageState(b.s.storageOk, persisted);

  const tonal = {
    flex: 1,
    height: 52,
    borderRadius: R.pill,
    background: onInk.raised,
    color: onInk.text,
    fontSize: T.md,
    fontWeight: W.button,
  } as const;

  // Not a card: two buttons and two lines of status sit straight on the sheet.
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h3 style={{ margin: 0, paddingLeft: 4, fontSize: T.sm, fontWeight: W.label, color: onInk.muted }}>Your data · on this phone only</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={exportJson} style={tonal}>
            Export backup
          </Btn>
          <Btn onClick={() => fileInput.current?.click()} style={tonal}>
            Restore
          </Btn>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            aria-label="Bompa backup file"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importer.choose(file);
              event.target.value = '';
            }}
          />
        </div>
        {importer.preview && <ImportPreview dark preview={importer.preview} onCommit={importer.commit} onCancel={importer.cancel} />}
        <span style={{ paddingLeft: 4, fontSize: T.sm, fontWeight: W.label, color: onInk.muted }}>{lastBackupPhrase(b.s.lastExportAt, Date.now())}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4, fontSize: T.sm, fontWeight: W.label, color: onInk.muted, ...num }}>
          {/* The dot answers the words beside it. Green only when storage works
              and the browser has promised to keep it; a green dot next to "not
              protected" read as all clear when it was not. */}
          <span role="img" aria-label={storage.label} style={{ width: 8, height: 8, borderRadius: R.pill, background: storage.colour, flex: 'none' }} />
          {b.sessions.length} sessions · {b.sets.length} sets ·{' '}
          {persisted === null ? 'checking storage' : persisted ? 'protected from eviction' : 'not protected'}
        </span>
      </div>
    </section>
  );
}

/**
 * The storage dot's colour and spoken name. Red when nothing is being saved,
 * green when saving and protected from eviction, and neutral otherwise: saving,
 * but the browser may clear it under storage pressure (or has not said yet).
 */
export function storageState(storageOk: boolean, persisted: boolean | null): { colour: string; label: string } {
  if (!storageOk) return { colour: C.redLight, label: 'Not saving to this device' };
  if (persisted) return { colour: C.greenLight, label: 'Saving to this device, protected' };
  if (persisted === null) return { colour: onInk.muted, label: 'Saving to this device' };
  return { colour: onInk.muted, label: 'Saving to this device, not protected' };
}

function Credit() {
  const b = useBompa();
  return (
    <span style={{ fontSize: T.xs, lineHeight: 1.5, color: onInk.muted, textAlign: 'center', minHeight: TOUCH }}>
      Movement library from{' '}
      <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener noreferrer" style={{ color: C.amberLight }}>
        Free Exercise DB
      </a>
      . Everything you log stays on this device — {b.s.storageOk ? 'no account, no server' : 'storage is unavailable, running from memory'}.
      {/* Which copy of the app this is. An installed app runs the copy it saved
          until an update lands, so this is how to tell a new deploy has arrived. */}
      <span style={{ display: 'block', paddingTop: 6, ...num }}>
        Bompa {process.env.NEXT_PUBLIC_APP_VERSION} · build {process.env.NEXT_PUBLIC_APP_BUILD} · {process.env.NEXT_PUBLIC_APP_BUILT_AT}
      </span>
    </span>
  );
}
