'use client';

// What you just did, shown once, the moment a session is finished.
//
// It replaced a three-second "session saved" toast: finishing a workout is the
// one moment someone is guaranteed to look at the phone with nothing else to
// do, and it deserved more than small print. It covers the whole app,
// including the tab bar, until "Done" — by then Today is already underneath.
//
// It leads with the verdict and with tomorrow's readiness, the two things a
// lifter wants to know walking out, and offers two ways back: undo the finish
// for 30 seconds, and rate any set left unrated.

import { useEffect, useRef } from 'react';
import { resolveTarget, targetRpeFor } from '@/lib/adapt';
import { countsAsWork, fmtClock, toDisplay, tomorrowReadiness } from '@/lib/calc';
import type { SessionSummary } from '@/lib/history';
import { C, HERO_SIZE, R, T, TOUCH, Z, num, onInk } from '@/lib/tokens';
import { READY_WORD, readinessBand, type ReadinessBand } from '@/lib/today';
import { unratedSets } from '@/lib/train';
import { fatigueDelta, sessionVerdict } from '@/lib/verdict';
import { weightShort } from '@/lib/bodyweight';
import { UNDO_FINISH_MS, useBompa } from '@/state/BompaContext';
import { Btn, Hero, HeroEyebrow, InkButton, Row, Section, Sheet, useEscapeKey } from '@/components/ui';

export function FinishSummary() {
  const b = useBompa();
  const summary = b.s.summary;
  const open = summary !== null;

  useEscapeKey(open, b.closeSummary);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  if (!summary) return null;

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Session summary"
      tabIndex={-1}
      className="sheet no-scrollbar"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: Z.summary,
        background: C.screen,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        outline: 'none',
      }}
    >
      <SummaryBody summary={summary} />
    </div>
  );
}

function SummaryBody({ summary }: { summary: SessionSummary }) {
  const b = useBompa();
  const { unit } = b.s;
  const { session } = summary;
  const routine = b.routineById(session.routineId);

  const all = summary.lifts.flatMap((lift) => lift.sets);
  const work = all.filter((row) => countsAsWork(row.type));

  // Tonnes for kilograms. Pounds have no tonne, so they read in thousands.
  const tonnes = (toDisplay(summary.tonnageKg, unit) / 1000).toFixed(1);
  const tonnesLabel = unit === 'kg' ? 'tonnes' : 'thousand lb';

  const avgRpe = work.length ? (work.reduce((total, row) => total + row.rpe, 0) / work.length).toFixed(1) : '—';
  const minutes = Math.round(summary.durationMs / 60_000);

  // Measured from just before the first set, so what it shows is this session
  // and nothing else. An empty session has no first set and added nothing.
  const firstAt = all.reduce((earliest, row) => Math.min(earliest, row.at), Infinity);
  const endedAt = session.finishedAt ?? b.now;
  const before = Number.isFinite(firstAt) ? firstAt - 1 : endedAt;
  const delta = Number.isFinite(firstAt) ? fatigueDelta(b.loads, before, endedAt) : 0;
  const deltaText = delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0';

  // What the lifter will walk in with tomorrow, which is the question a
  // finished session actually raises. Tonnage answers a question nobody asked.
  const tomorrow = tomorrowReadiness(b.loads, before, endedAt);
  const band = readinessBand(tomorrow.readiness);
  // The same check Today makes, read from the same scores: with too little
  // history the number is a rough guide, and a band word beside it would
  // claim more than it knows — and contradict Today, one tap away.
  const learning = b.scores.lowConfidence;
  const changeText =
    tomorrow.change < 0 ? `down ${Math.abs(tomorrow.change)}` : tomorrow.change > 0 ? `up ${tomorrow.change}` : 'no change';

  // Every lift the session was built around, trained or not, plus anything
  // added along the way. Skipping a planned lift is worth seeing here.
  const order = [...session.exerciseIds];
  for (const lift of summary.lifts) if (!order.includes(lift.exerciseId)) order.push(lift.exerciseId);

  const rows = order.flatMap((exerciseId) => {
    const lift = summary.lifts.find((x) => x.exerciseId === exerciseId);
    const slot = routine?.slots.find((x) => x.exerciseId === exerciseId);
    const done = lift ? lift.sets.filter((row) => countsAsWork(row.type)) : [];
    // Added mid-session and then never trained: nothing planned, nothing done.
    if (!slot && !lift) return [];

    const unrated = lift ? unratedSets(lift.sets) : [];
    const top = done.reduce((best, row) => Math.max(best, row.rpe), 0);
    const base = done.length
      ? `${done.length} × ${done[0]!.reps} @ ${weightShort(toDisplay(lift!.topWeightKg, unit), unit, b.isBodyweightLift(exerciseId))}`
      : '';
    const detail = done.length
      ? unrated.length > 0
        ? `${base} · ${unrated.length} ${unrated.length === 1 ? 'set' : 'sets'} unrated`
        : `${base} · top RPE ${top}`
      : lift
        ? 'Warm-ups only'
        : 'Not trained today';

    let status: string;
    let statusColor: string;
    if (!slot) {
      status = `+${done.length} extra`;
      statusColor = C.ink60;
    } else {
      const planned = resolveTarget(slot, b.prescriptions, b.e1rmByExercise[exerciseId] ?? 0).sets;
      status = `${done.length}/${planned}`;
      statusColor = done.length >= planned ? C.greenDark : done.length > 0 ? C.amberDark : C.tertiary;
    }

    const unratedIds = unrated.map((row) => row.id).filter((id): id is number => id !== undefined);
    const untrained = Boolean(slot) && done.length === 0;
    return [{ exerciseId, name: b.exerciseById.get(exerciseId)?.name ?? exerciseId, detail, status, statusColor, unratedIds, untrained }];
  });

  const verdict = sessionVerdict(
    all,
    targetRpeFor(routine),
    (id) => b.exerciseById.get(id)?.name ?? id,
    rows.filter((row) => row.untrained).map((row) => row.exerciseId),
  );

  const { done, total } = b.progress;
  const next = b.nextSlot ? b.routineById(b.nextSlot.routineId)?.name : undefined;
  const week =
    total === 0
      ? 'Nothing planned this week'
      : `${done} of ${total} done${next ? ` · ${next} is next` : done >= total ? ' · week complete' : ''}`;

  return (
    <>
      <Hero gap={14} style={{ padding: '14px 22px 46px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: TOUCH }}>
          <HeroEyebrow color={C.greenLight}>Session saved · {session.routineName}</HeroEyebrow>
          <UndoFinish />
        </div>

        <p style={{ margin: 0, fontSize: T.xxl, lineHeight: 1.18, fontWeight: 800, letterSpacing: '-0.02em', textWrap: 'pretty' }}>{verdict}</p>

        <div
          role="img"
          aria-label={`Tomorrow's readiness ${tomorrow.readiness}, ${learning ? 'still learning' : READY_WORD[band]}. Readiness ${changeText}, fatigue ${deltaText}.`}
          style={{ display: 'flex', alignItems: 'flex-end', gap: 12, paddingTop: 4 }}
        >
          <span aria-hidden style={{ fontSize: HERO_SIZE.summary, fontWeight: 800, lineHeight: 0.82, letterSpacing: '-0.05em', ...num }}>
            {tomorrow.readiness}
          </span>
          <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingBottom: 6 }}>
            {learning && <span style={{ fontSize: T.lg, fontWeight: 800, color: onInk.muted }}>Still learning</span>}
            {!learning && <span style={{ fontSize: T.lg, fontWeight: 800, color: BAND_COLOR[band] }}>{BAND_WORD[band]} tomorrow</span>}
            <span style={{ fontSize: T.sm, fontWeight: 700, color: onInk.muted, ...num }}>
              readiness, {changeText} · fatigue {deltaText}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 26, paddingTop: 6 }}>
          <Figure value={String(summary.workingSets)} label="sets" />
          <Figure value={String(minutes)} label="min" />
          <Figure value={avgRpe} label="avg RPE" />
          <Figure value={tonnes} label={tonnesLabel} />
        </div>
      </Hero>

      <Sheet>
        <Section title="What you did">
          {rows.map((row) => (
            <Row
              key={row.exerciseId}
              title={row.name}
              // Amber when something is still owed: the Rate button beside it is the way to settle it.
              sub={row.unratedIds.length > 0 ? <span style={{ color: C.amberDark }}>{row.detail}</span> : row.detail}
              right={
                row.unratedIds.length > 0 ? (
                  <Btn
                    onClick={() => b.patch({ rateSheet: { exerciseId: row.exerciseId, setIds: row.unratedIds } })}
                    label={`Rate ${row.name}`}
                    style={{
                      height: TOUCH,
                      padding: '0 14px',
                      borderRadius: R.chip,
                      border: `1px solid ${C.ink}`,
                      fontSize: T.sm,
                      fontWeight: 800,
                      flex: 'none',
                    }}
                  >
                    Rate
                  </Btn>
                ) : (
                  <span style={{ fontSize: T.md, fontWeight: 800, color: row.statusColor, flex: 'none', ...num }}>{row.status}</span>
                )
              }
            />
          ))}
          {rows.length === 0 && <Row title="No lifts in this session" />}
        </Section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
          <span style={{ fontSize: T.xs, fontWeight: 800, letterSpacing: '.14em', color: C.tertiary }}>THIS WEEK</span>
          <span style={{ fontSize: T.lg, fontWeight: 800, ...num }}>{week}</span>
        </div>

        <Btn
          onClick={b.closeSummary}
          style={{
            marginTop: 'auto',
            height: 58,
            borderRadius: R.block,
            background: C.amber,
            color: C.ink,
            fontSize: T.lg,
            fontWeight: 800,
          }}
        >
          Done
        </Btn>
      </Sheet>
    </>
  );
}

const BAND_WORD: Record<ReadinessBand, string> = { primed: 'Primed', steady: 'Steady', buried: 'Buried' };

/** The word carries the colour; the numeral stays white. */
const BAND_COLOR: Record<ReadinessBand, string> = { primed: C.greenLight, steady: C.amberLight, buried: C.redLight };

/**
 * "Undo finish · 0:24", counting down on the wall clock, and gone once the
 * window closes.
 */
function UndoFinish() {
  const b = useBompa();
  if (b.lastFinishedAt === null) return null;
  // The app's clock ticks once a second, so it can lag the finish by most of
  // one; clamped so the count never starts above the window it describes.
  const left = Math.min(UNDO_FINISH_MS / 1000, Math.ceil((b.lastFinishedAt + UNDO_FINISH_MS - b.now) / 1000));
  if (left <= 0) return null;
  return (
    <InkButton onClick={b.undoFinish} shape="pill" height={44} fontSize={T.sm} label={`Undo finish, ${left} seconds left`}>
      Undo finish · {fmtClock(left)}
    </InkButton>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: T.xl, fontWeight: 800, ...num }}>{value}</span>
      <span style={{ fontSize: T.xs, fontWeight: 700, color: onInk.muted }}>{label}</span>
    </div>
  );
}
