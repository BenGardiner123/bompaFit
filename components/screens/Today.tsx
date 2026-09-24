'use client';

import { useState } from 'react';
import { daysBetween, fmtDayMonth, series, toDisplay } from '@/lib/calc';
import { volumeUnit } from '@/lib/history';
import { chipLayout } from '@/lib/supersets';
import {
  READY_LABEL,
  READY_WORD,
  curveGeometry,
  historyPhrase,
  readinessBand,
  readinessTrend,
  readySentence,
  trendColour,
  trendPhrase,
  trendWords,
  type ReadinessBand,
} from '@/lib/today';
import { C, HERO_SIZE, PHASE_LABEL, R, SHADOW, TOUCH, num, onInk } from '@/lib/tokens';
import { useBompa } from '@/state/BompaContext';
import { Btn, Hero, HeroEyebrow, HeroNumeral, HeroText, Sheet } from '@/components/ui';

/** The readiness word on ink. The light-surface greens and reds are too dark to read there. */
const READY_ON_INK: Record<ReadinessBand, string> = {
  primed: C.greenLight,
  steady: C.amberLight,
  buried: C.redLight,
};

export function Today() {
  const b = useBompa();
  const { s, scores, metrics } = b;

  const block = b.currentBlock;
  const weekInBlock = block ? Math.floor(daysBetween(block.startDate, b.currentWeek) / 7) + 1 : null;
  const totalWeeks = block ? block.weeks + block.deloadWeeks : null;

  // Which slot the card below is showing. Selecting is not starting: tapping a
  // slot loads it so you can see what is in it and decide, which is the whole
  // point of a week whose order is a suggestion. Local state on purpose —
  // it is a browsing choice, and coming back to Today should offer what is next
  // rather than whatever you were peering at earlier.
  const [previewSlotId, setPreviewSlotId] = useState<number | null>(null);

  // Falls back to the next slot whenever the previewed one is gone — dropped
  // from the plan, or the week rolled over while Today was open.
  const previewed = previewSlotId === null ? null : b.thisWeekSlots.find((p) => p.id === previewSlotId && p.status === 'plan') ?? null;
  const shownSlot = previewed ?? b.nextSlot;
  const showingNext = shownSlot?.id === b.nextSlot?.id;

  // What's next, whenever you get to it — not "what's on today". The plan
  // commits to a week's work, not to which day each session lands on.
  const routine = shownSlot ? b.routineById(shownSlot.routineId) : undefined;

  const band = readinessBand(scores.readiness);
  const sentence = readySentence(scores.readiness, scores.fatigueScore);

  // Fresher or more tired than when you last walked in. Null with nothing
  // before the last session to compare against, and then the line is absent.
  const trend = readinessTrend(b.loads, b.sessions, scores.readiness);
  const trendSpoken = trend === null ? '' : ` ${trendWords(trend)}`;

  // An observation that repeats the hero's own sentence word for word is the
  // same thing said twice on one screen.
  const insights = b.insights.filter((insight) => insight.text !== sentence);

  const volumeTonnes = metrics.volume7d >= 1000;

  return (
    <div className="rise" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <Hero>
        <HeroEyebrow right={block && weekInBlock && totalWeeks ? `${PHASE_LABEL[block.phase]} · wk ${weekInBlock} of ${totalWeeks}` : undefined}>
          Readiness
        </HeroEyebrow>

        {/* Nothing logged at all, not "under a day of history": a first session
            done this morning is something to read, it just reads with low confidence. */}
        {scores.sessions === 0 ? (
          <>
            {/* No number rather than a placeholder one: a dash the size of the
                readiness figure reads as a broken bar, not as "nothing yet". */}
            <p style={{ margin: 0, paddingTop: 6, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: onInk.text }}>Nothing to read yet</p>
            <HeroText maxWidth={320}>
              Log your first session and I’ll start reading your readiness. It takes about two weeks of data before the number means much.
            </HeroText>
          </>
        ) : scores.lowConfidence ? (
          <>
            <HeroNumeral
              value={scores.readiness}
              size={HERO_SIZE.today}
              label="Still learning"
              labelColor={C.amberLight}
              sub={<TrendSub first={historyPhrase(scores.historyDays)} trend={trend} />}
              ariaLabel={`Readiness ${scores.readiness} out of 100, still learning from ${historyPhrase(scores.historyDays)}.${trendSpoken}`}
            />
            <HeroText maxWidth={320}>Treat this number as a rough guide until there are two weeks behind it.</HeroText>
          </>
        ) : (
          <>
            <HeroNumeral
              value={scores.readiness}
              size={HERO_SIZE.today}
              label={READY_LABEL[band]}
              labelColor={READY_ON_INK[band]}
              sub={<TrendSub first={`fatigue ${scores.fatigueScore}`} trend={trend} />}
              ariaLabel={`Readiness ${scores.readiness} out of 100, ${READY_WORD[band]}. Fatigue ${scores.fatigueScore}.${trendSpoken}`}
            />
            <HeroText maxWidth={320}>{sentence}</HeroText>
          </>
        )}

        <FormCurve />
      </Hero>

      <Sheet gap={14} style={{ padding: '20px 18px 22px' }}>
        <WeekSegments shownId={shownSlot?.id} onPick={setPreviewSlotId} />

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: C.greenDark, ...num }}>
              {/* "Next up", never "today" — the plan does not claim a day.
                  When you have picked a different slot to look at, this names
                  it, so the card never looks like it is offering something it
                  is not. */}
              {b.progress.total > 0
                ? showingNext
                  ? `Next up · ${b.progress.done} of ${b.progress.total} done`
                  : `#${(shownSlot?.slotIndex ?? 0) + 1} · ${b.progress.done} of ${b.progress.total} done`
                : block
                  ? PHASE_LABEL[block.phase]
                  : 'Unplanned'}
            </span>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {routine?.name ?? (b.progress.total > 0 ? 'Week complete' : 'Nothing planned')}
            </h1>
          </div>
          {routine && (
            <span style={{ fontSize: 12, fontWeight: 700, color: C.tertiary, flex: 'none', ...num }}>
              {routine.slots.length} lifts · ~{routine.estMinutes} min
            </span>
          )}
        </div>

        {routine ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {chipLayout(
              [...routine.slots].sort((a, x) => a.order - x.order).map((slot) => slot.exerciseId),
              routine,
            ).map((chip, index) => {
              const slot = routine.slots.find((x) => x.exerciseId === chip.exerciseId)!;
              const exercise = b.exerciseById.get(slot.exerciseId);
              const target = b.prescriptions[slot.exerciseId];
              const weight = target?.weightKg ?? slot.targetWeightKg;
              return (
                <div
                  key={slot.exerciseId}
                  style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 8, alignItems: 'baseline', fontSize: 14 }}
                >
                  <span style={{ fontSize: 11, fontWeight: 800, color: C.amberDark, ...num }}>{String(index + 1).padStart(2, '0')}</span>
                  <span
                    style={{
                      fontWeight: 700,
                      minWidth: 0,
                      // Superset members hang off an amber rule so the list
                      // shows the shape of the session, not a flat run of lifts.
                      paddingLeft: chip.letter ? 8 : 0,
                      borderLeft: chip.letter ? `2px solid ${C.amber}` : 'none',
                    }}
                  >
                    {exercise?.name ?? slot.exerciseId}
                    {chip.startsGroup && <span style={{ color: C.amberDark, fontWeight: 800 }}> · superset {chip.letter}</span>}
                  </span>
                  <span style={{ color: C.tertiary, fontWeight: 600, ...num }}>
                    {Math.max(1, Math.round(slot.sets * (target?.volumeFactor ?? 1)))} × {slot.reps}
                    {weight ? ` @ ${toDisplay(weight, s.unit)}` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: C.ink60 }}>
            {b.progress.total > 0
              ? "That's the week's work done. Rest is part of the plan — fatigue only drains when you let it."
              : b.routines.length === 0
                ? "No workouts yet. Build one and I'll schedule a block around it."
                : 'No plan running. Start a workout whenever you like, or build a block on the Plan tab.'}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <Btn
            onClick={() => (routine ? b.startSession(routine.id, shownSlot?.id) : b.patch({ library: true }))}
            style={{
              flex: 1,
              height: 58,
              borderRadius: R.block,
              background: C.amber,
              color: C.ink,
              fontSize: 16,
              fontWeight: 800,
              boxShadow: SHADOW.cta,
            }}
          >
            {/* "Train anyway" is nonsense when there is nothing to train —
                it sent people looking for a workout they had not built yet. */}
            {b.openSession ? 'Resume workout' : routine ? 'Start workout' : b.routines.length === 0 ? 'Build a workout' : 'Train anyway'}
          </Btn>
          <Btn
            onClick={() => b.patch({ library: true })}
            label="Open workout library"
            style={{
              width: 58,
              height: 58,
              flex: 'none',
              borderRadius: R.block,
              border: `1px solid ${C.lineStrong}`,
              color: C.ink,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={{ width: 18, height: 18 }} aria-hidden>
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </Btn>
        </div>

        {insights.map((insight) => {
          const action = insight.tone === 'action';
          const adjustment = insight.adjustmentId === undefined ? undefined : b.adjustments.find((a) => a.id === insight.adjustmentId);
          // One tap, and only ever an offer — an overreaching week is
          // sometimes exactly what you meant to do.
          const canTrim = insight.id === 'week-over-budget' && b.budget.remaining.length > 0;
          return (
            <div key={insight.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '0 2px' }}>
              {/* Amber and pulsing when Bompa did or wants something; a still
                  blue dot when it is only remarking on the numbers. */}
              <span
                className={action ? 'pulse' : undefined}
                style={{ width: 7, height: 7, borderRadius: '50%', background: action ? C.amber : C.blue, flex: 'none', alignSelf: 'flex-start', marginTop: 6 }}
              />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.45, color: C.ink80 }}>{insight.text}</span>
              {/* The actions sit beside the sentence rather than inside it so
                  they can be a full thumb's height without stretching the line. */}
              {adjustment && (
                <InsightAction onClick={() => b.undoAdjustment(adjustment)} label={`Undo: ${insight.text}`}>
                  Undo
                </InsightAction>
              )}
              {canTrim && <InsightAction onClick={() => void b.trimWeekToBudget()}>Trim what’s left</InsightAction>}
            </div>
          );
        })}

        <dl
          className="no-scrollbar"
          style={{ margin: 0, display: 'flex', gap: 22, overflowX: 'auto', padding: '10px 0 2px', borderTop: `1px solid ${C.line}` }}
        >
          <StripMetric
            label="7-day volume"
            value={volumeTonnes ? (toDisplay(metrics.volume7d, s.unit) / 1000).toFixed(1) : Math.round(toDisplay(metrics.volume7d, s.unit))}
            unit={volumeTonnes ? volumeUnit(s.unit, true) : s.unit}
          />
          <StripMetric
            label="since rest"
            value={metrics.daysSinceRest}
            unit="d"
            // Five straight days is when a rest day stops being optional.
            color={metrics.daysSinceRest >= 5 ? C.redDark : C.ink}
          />
          <StripMetric
            label="to peak"
            value={metrics.peakInDays ?? '—'}
            unit={metrics.peakInDays === null ? undefined : 'd'}
            color={C.amberDark}
          />
          <StripMetric
            label="intensity"
            value={metrics.intensity === null ? '—' : Math.round(metrics.intensity * 100)}
            unit={metrics.intensity === null ? undefined : '%'}
          />
          <StripMetric
            label="load vs usual"
            value={metrics.acwr === null ? '—' : metrics.acwr.toFixed(2)}
            unit={metrics.acwr === null ? undefined : '×'}
            // Half again the load you have a base for is where injuries start.
            color={metrics.acwr !== null && metrics.acwr > 1.5 ? C.redDark : C.greenDark}
          />
        </dl>
      </Sheet>
    </div>
  );
}

/**
 * This week's slots as a row of bars. Position, not weekday — the plan commits
 * to a week's work and leaves the timing to you.
 *
 * Each pending bar is a button that loads that workout into the card below.
 * The bar is drawn 5px tall but the button around it is a full thumb's height;
 * the negative margin gives that extra height back so the row still sits as
 * tight as the drawing.
 */
function WeekSegments({ shownId, onPick }: { shownId: number | undefined; onPick: (id: number) => void }) {
  const b = useBompa();
  if (b.thisWeekSlots.length === 0) return null;

  const bleed = (TOUCH - 5) / 2;
  return (
    <div role="group" aria-label="This week" style={{ display: 'flex', gap: 4, margin: `-${bleed}px 0` }}>
      {b.thisWeekSlots.map((slot) => {
        const name = b.routineById(slot.routineId)?.name ?? 'workout';
        const done = slot.status === 'done';
        const skipped = slot.status === 'skip';
        const shown = shownId !== undefined && slot.id === shownId;
        const isNext = slot.id !== undefined && slot.id === b.nextSlot?.id;
        const colour = done
          ? C.green
          : skipped
            ? C.grey
            : shown && !isNext
              ? C.ink // a slot you picked to look at, so the row agrees with the card
              : isNext
                ? C.amber
                : C.lineStrong;
        const bar = <span style={{ display: 'block', width: '100%', height: 5, borderRadius: 3, background: colour }} />;
        const key = slot.id ?? `${slot.weekStart}-${slot.slotIndex}`;
        const cell = { flex: 1, minWidth: 0, height: TOUCH, display: 'flex', alignItems: 'center' } as const;

        // Only a pending slot is worth loading. A done one is history and a
        // skipped one is a decision already taken; neither is something to
        // weigh up doing today, so neither is a control.
        if (slot.status !== 'plan' || slot.id === undefined) {
          return (
            <span key={key} style={cell}>
              {bar}
              <span className="sr-only">
                {name}, slot {slot.slotIndex + 1}, {done ? 'done' : 'skipped'}
              </span>
            </span>
          );
        }
        const id = slot.id;
        return (
          <Btn key={key} onClick={() => onPick(id)} label={`Show ${name}, slot ${slot.slotIndex + 1}`} pressed={shown} style={cell}>
            {bar}
          </Btn>
        );
      })}
    </div>
  );
}

/** The fitness-and-fatigue curve under the readiness number: the history the number comes from. */
function FormCurve() {
  const b = useBompa();
  // Two sessions is the least that draws a line rather than a dot.
  if (b.loads.length < 2) return null;

  const width = 300;
  const height = 70;
  const geometry = curveGeometry(series(b.loads, b.now, 90), b.peakWindow?.daysAway ?? null, width, height);

  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: 62, display: 'block', marginTop: 10 }}
        aria-hidden
      >
        {/* Non-scaling strokes, because the box stretches to the screen width
            and would otherwise smear the dashes and fatten the lines. */}
        <polyline points={geometry.fitness} fill="none" stroke={C.greenLight} strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <polyline
          points={geometry.fatigue}
          fill="none"
          stroke={C.redLight}
          strokeWidth={2.5}
          strokeDasharray="5 4"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {geometry.peakX !== null && (
          <line x1={geometry.peakX} y1={0} x2={geometry.peakX} y2={height} stroke={C.amber} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div aria-hidden style={{ display: 'flex', gap: 14, fontSize: 11, fontWeight: 700, ...num }}>
        <span style={{ color: C.greenLight }}>— Fitness</span>
        <span style={{ color: C.redLight }}>- - Fatigue</span>
        {b.peakWindow && <span style={{ color: C.amberLight }}>| Peak {fmtDayMonth(b.peakWindow.startDate)}</span>}
      </div>
      <p className="sr-only">
        Over the last 90 days: fitness is now {Math.round(b.scores.fitness)} and fatigue {Math.round(b.scores.fatigue)}.
        {b.peakWindow ? ` Your predicted peak starts ${fmtDayMonth(b.peakWindow.startDate)}, ${b.peakWindow.daysAway} days away.` : ''}
      </p>
    </>
  );
}

/**
 * The small lines beside the readiness numeral: the existing context line, then
 * the trend under it when there is one. It rides in the numeral's side column
 * so it reads as part of the number, and because that column grows upward from
 * the baseline it costs the hero no height.
 */
function TrendSub({ first, trend }: { first: string; trend: number | null }) {
  return (
    <>
      {first}
      {trend !== null && (
        <span style={{ display: 'block', marginTop: 3, color: trendColour(trend), ...num }}>{trendPhrase(trend)}</span>
      )}
    </>
  );
}

function InsightAction({ onClick, children, label }: { onClick: () => void; children: string; label?: string }) {
  return (
    <Btn
      onClick={onClick}
      label={label}
      style={{ flex: 'none', minHeight: TOUCH, minWidth: TOUCH, padding: '0 4px', fontSize: 12.5, fontWeight: 800, color: C.amberDark, whiteSpace: 'nowrap' }}
    >
      {children}
    </Btn>
  );
}

/** One figure in the unboxed strip at the foot of Today. A description list, so each value is read with its name. */
function StripMetric({ label, value, unit, color = C.ink }: { label: string; value: string | number; unit?: string; color?: string }) {
  return (
    <div style={{ flex: 'none', display: 'flex', flexDirection: 'column-reverse', gap: 2 }}>
      {/* The label comes first in the markup so a screen reader hears the name
          before the number; column-reverse puts it back under the figure. */}
      <dt style={{ fontSize: 11, fontWeight: 700, color: C.tertiary }}>{label}</dt>
      <dd style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 2 }}>
        <span style={{ fontSize: 24, fontWeight: 800, color, ...num }}>{value}</span>
        {unit && <span style={{ fontSize: 12, fontWeight: 700, color: C.tertiary }}>{unit}</span>}
      </dd>
    </div>
  );
}
