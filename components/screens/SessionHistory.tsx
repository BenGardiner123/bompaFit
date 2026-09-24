'use client';

// What did I actually do on Tuesday.
//
// Slicing history by lift answers "how is my squat going" and cannot answer
// this: a session's squats sit under Back Squat and its presses under Overhead
// Press, so without this view a finished workout cannot be found as a whole.

import { useId, useState, type ReactNode } from 'react';
import { addDays, isSet, segmentOf, toDisplay } from '@/lib/calc';
import {
  WARMUP_OPACITY,
  dailyTonnage,
  fmtShortDay,
  fmtVolume,
  percentChange,
  summariseSessions,
  volumeUnit,
  weekdayShort,
  type SessionSummary,
} from '@/lib/history';
import { C, FONT, HERO_SIZE, TOUCH, num, onInk } from '@/lib/tokens';
import type { LoggedSet, Unit } from '@/lib/types';
import { weightShort } from '@/lib/bodyweight';
import { useBompa } from '@/state/BompaContext';
import { Btn, Empty, Hero, HeroEyebrow, HeroNumeral, Section, Sheet } from '@/components/ui';
import { pieceNoun } from '@/components/screens/SegmentControls';

/** The By session view: the last seven days in the hero, every finished session below. */
export function SessionHistory({ tabs }: { tabs: ReactNode }) {
  const b = useBompa();
  const { s } = b;
  const summaries = summariseSessions(b.sessions, b.sets);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <>
      <Hero gap={14} style={{ paddingTop: 4 }}>
        {tabs}
        <LastSevenDays />
      </Hero>

      <Sheet>
        {summaries.length === 0 ? (
          <Empty>No finished sessions yet. They land here once you tap Finish.</Empty>
        ) : (
          <Section title="Sessions">
            {summaries.map((summary) => (
              <SessionRow
                key={summary.session.id}
                summary={summary}
                unit={s.unit}
                todayKey={b.todayKey}
                expanded={open === summary.session.id}
                onToggle={() => setOpen(open === summary.session.id ? null : (summary.session.id ?? null))}
              />
            ))}
          </Section>
        )}
      </Sheet>
    </>
  );
}

/**
 * Tonnage for the last seven calendar days, how that compares with the seven
 * before, and a bar per day. Working and back-off sets only: a warm-up is not
 * the work, and every other tonnage in the app leaves it out too.
 */
function LastSevenDays() {
  const b = useBompa();
  const { s } = b;

  const days = dailyTonnage(b.sets, b.todayKey);
  const thisWeek = days.reduce((a, d) => a + d.kg, 0);
  const lastWeek = dailyTonnage(b.sets, addDays(b.todayKey, -7)).reduce((a, d) => a + d.kg, 0);
  const change = percentChange(thisWeek, lastWeek);
  const peak = Math.max(...days.map((d) => d.kg));

  const figure = fmtVolume(thisWeek, s.unit);
  const unitWord = volumeUnit(s.unit);
  let sub = 'nothing logged the week before';
  let subColor: string = onInk.muted;
  if (change !== null && change > 0) {
    sub = `↑ ${change}% on last week`;
    subColor = C.greenLight;
  } else if (change !== null && change < 0) {
    // Down is not bad news — a deload week is meant to be lighter — so it
    // stays neutral rather than going red.
    sub = `↓ ${Math.abs(change)}% on last week`;
  } else if (change === 0) {
    sub = 'level with last week';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <HeroEyebrow>Last 7 days</HeroEyebrow>
      <HeroNumeral
        value={figure}
        size={HERO_SIZE.screen}
        label={unitWord}
        sub={sub}
        subColor={subColor}
        ariaLabel={`${figure} ${unitWord} lifted in the last 7 days, ${sub}`}
      />

      {/* One bar per day, scaled to the heaviest. A rest day keeps a thin
          stub so the week still reads as seven days rather than a gap. The
          row is one image to a screen reader, described in words. */}
      <div
        role="img"
        aria-label={`Tonnage by day: ${days.map((d) => `${weekdayShort(d.key)} ${fmtVolume(d.kg, s.unit)}`).join(', ')}`}
        style={{ display: 'flex', flexDirection: 'column', gap: 5 }}
      >
        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 44, paddingTop: 14 }}>
          {days.map((d) => (
            <div key={d.key} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <span
                style={{
                  width: '100%',
                  height: d.kg > 0 ? `${Math.round((d.kg / peak) * 100)}%` : 3,
                  borderRadius: 3,
                  background: d.kg > 0 ? C.amber : onInk.line,
                }}
              />
            </div>
          ))}
        </div>
        <div aria-hidden style={{ display: 'flex', gap: 4 }}>
          {days.map((d) => (
            <span key={d.key} style={{ flex: 1, textAlign: 'center', fontSize: 10.5, fontWeight: 700, color: onInk.muted }}>
              {weekdayShort(d.key)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionRow({
  summary,
  unit,
  todayKey,
  expanded,
  onToggle,
}: {
  summary: SessionSummary;
  unit: Unit;
  todayKey: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const b = useBompa();
  const panelId = useId();
  const { session, lifts, workingSets, tonnageKg, durationMs } = summary;
  const minutes = Math.round(durationMs / 60_000);
  const empty = lifts.length === 0;
  const day = fmtShortDay(session.date, todayKey);

  const head = (
    <>
      <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, width: '100%' }}>
        {/* The snapshot, not a live lookup: renaming a routine must not
            rewrite what you did under its old name. */}
        <span style={{ fontSize: 15, fontWeight: 800, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.routineName}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.tertiary, flex: 'none', ...num }}>
          {day}
          {!empty && <span aria-hidden>{expanded ? ' ▴' : ' ▾'}</span>}
        </span>
      </span>

      {empty ? (
        <span style={{ fontSize: 12, fontWeight: 600, color: C.tertiary }}>Started and finished with nothing logged.</span>
      ) : (
        <span style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Figure value={String(workingSets)} label="sets" />
          <Figure value={fmtVolume(tonnageKg, unit)} label={volumeUnit(unit)} />
          <Figure value={String(minutes)} label="min" />
          <Figure value={String(lifts.length)} label={lifts.length === 1 ? 'lift' : 'lifts'} />
        </span>
      )}

      {session.autoClosed && (
        <span style={{ fontSize: 11, fontWeight: 700, color: C.amberDark }}>Closed automatically — four hours passed with nothing logged.</span>
      )}
    </>
  );

  const line = {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    width: '100%',
    minHeight: TOUCH,
    padding: '13px 0',
    textAlign: 'left',
    color: C.ink,
  } as const;

  return (
    <div style={{ borderTop: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column' }}>
      {empty ? (
        // Nothing to open, so nothing to press.
        <div style={line}>{head}</div>
      ) : (
        // A plain button rather than the shared Row, because a row that opens
        // has to say whether it is open, and that needs aria-expanded.
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${expanded ? 'Hide' : 'Show'} ${session.routineName} on ${day}`}
          style={{ ...line, fontFamily: FONT, border: 'none', background: 'transparent', cursor: 'pointer' }}
        >
          {head}
        </button>
      )}

      {expanded && !empty && (
        <div id={panelId} className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '2px 0 16px' }}>
          {lifts.map((lift) => (
            <div key={lift.exerciseId} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {/* Custom and archived lifts are in the same lookup, so a
                  retired movement still shows its name. */}
              <h3 style={{ margin: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: C.amberDark }}>
                {b.exerciseById.get(lift.exerciseId)?.name ?? lift.exerciseId}
              </h3>
              {withPieces(lift.sets).map(({ row, pieces }, i) =>
                pieces.length === 0 ? (
                  <SetLine key={row.id ?? `${row.at}-${i}`} row={row} unit={unit} />
                ) : (
                  <PiecesLine key={row.id ?? `${row.at}-${i}`} row={row} pieces={pieces} unit={unit} />
                ),
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A lift's rows as sets, each with the pieces that belong to it. A drop or
 * cluster piece is its own row in storage but not its own set, and listing it
 * as one would make a triple drop look like three sets.
 *
 * A piece whose set is missing — only possible in a hand-edited import — is
 * listed on its own rather than hidden: a row that exists must appear.
 */
function withPieces(rows: LoggedSet[]): { row: LoggedSet; pieces: LoggedSet[] }[] {
  const out: { row: LoggedSet; pieces: LoggedSet[] }[] = [];
  const owner = new Map<number, { row: LoggedSet; pieces: LoggedSet[] }>();
  for (const row of rows) {
    if (isSet(row)) {
      const entry = { row, pieces: [] };
      out.push(entry);
      owner.set(row.setNo, entry);
      continue;
    }
    const parent = owner.get(row.setNo);
    if (parent) parent.pieces.push(row);
    else out.push({ row, pieces: [] });
  }
  return out;
}

/**
 * A set and its pieces on one line, heaviest first as it was lifted:
 * "80 × 8 → 64 × 6 → 51 × 5 kg". Each figure opens that row in the Edit Set
 * sheet, because a mistyped second drop is fixed there like any other row.
 */
function PiecesLine({ row, pieces, unit }: { row: LoggedSet; pieces: LoggedSet[]; unit: Unit }) {
  const b = useBompa();
  const noun = pieceNoun(pieces[0]?.segmentStyle).toLowerCase();
  const figure = (x: LoggedSet, name: string) => (
    <Btn
      key={x.id ?? x.at}
      label={`Edit ${name}: ${toDisplay(x.weightKg, unit)} ${unit} × ${x.reps}`}
      disabled={x.id === undefined}
      onClick={x.id === undefined ? undefined : () => b.patch({ editingSetId: x.id! })}
      style={{ minHeight: TOUCH, fontSize: 13.5, fontWeight: 700, color: C.ink, opacity: 1, ...num }}
    >
      {toDisplay(x.weightKg, unit)} × {x.reps}
    </Btn>
  );
  const warm = row.type === 'warmup';
  const label = warm ? C.ink : C.tertiary;

  return (
    <div
      role="group"
      aria-label={`Set ${row.setNo} with ${pieces.length} ${noun}${pieces.length === 1 ? '' : 's'}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '24px 1fr 44px',
        alignItems: 'center',
        gap: 8,
        fontSize: 13.5,
        opacity: warm ? WARMUP_OPACITY : 1,
      }}
    >
      <span style={{ fontSize: 11.5, fontWeight: 800, color: label, ...num }}>
        {warm ? 'W' : row.type === 'backoff' ? 'B' : row.setNo}
      </span>
      {/* Wraps rather than scrolls: a long rest-pause set runs to several
          pieces, and a clipped line would hide the last of them. */}
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 6 }}>
        {figure(row, `set ${row.setNo}`)}
        {pieces.map((x) => (
          <span key={x.id ?? x.at} style={{ display: 'inline-flex', alignItems: 'center', columnGap: 6 }}>
            <span aria-hidden style={{ color: C.tertiary, fontWeight: 700 }}>
              →
            </span>
            {figure(x, `${pieceNoun(x.segmentStyle).toLowerCase()} ${segmentOf(x)} of set ${row.setNo}`)}
          </span>
        ))}
        <span style={{ fontWeight: 700, color: C.tertiary }}>{unit}</span>
      </span>
      <span style={{ fontSize: 12, fontWeight: 800, color: label, ...num }}>@{row.rpe}</span>
    </div>
  );
}

function SetLine({ row, unit }: { row: SessionSummary['lifts'][number]['sets'][number]; unit: Unit }) {
  const warm = row.type === 'warmup';
  // Warm-ups are dimmed rather than hidden: they happened, and they cost a
  // little. Dimmed grey drops below readable, so a dimmed line is all ink and
  // the opacity alone does the quieting.
  const label = warm ? C.ink : C.tertiary;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '24px 1fr 1fr 44px',
        alignItems: 'baseline',
        gap: 8,
        fontSize: 13.5,
        opacity: warm ? WARMUP_OPACITY : 1,
      }}
    >
      <span style={{ fontSize: 11.5, fontWeight: 800, color: label, ...num }}>
        {warm ? 'W' : row.type === 'backoff' ? 'B' : row.setNo}
      </span>
      <span style={{ fontWeight: 700, ...num }}>
        {weightShort(toDisplay(row.weightKg, unit), unit)}
      </span>
      <span style={{ fontWeight: 700, ...num }}>{row.reps} reps</span>
      <span style={{ fontSize: 12, fontWeight: 800, color: label, ...num }}>@{row.rpe}</span>
    </div>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ fontSize: 17, fontWeight: 800, ...num }}>{value}</span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: C.tertiary }}>{label}</span>
    </span>
  );
}
