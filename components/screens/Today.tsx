'use client';

import { useState, type CSSProperties } from 'react';
import { daysBetween, series, toDisplay } from '@/lib/calc';
import { chipLayout } from '@/lib/supersets';
import {
  READY_AT,
  READY_LABEL,
  READY_WORD,
  curveGeometry,
  daysToMeet,
  historyPhrase,
  loadWord,
  readinessBand,
  readinessMarker,
  readinessScale,
  readinessTrend,
  readySentence,
  trendColour,
  trendPhrase,
  trendWords,
  type LoadWord,
  type ReadinessBand,
} from '@/lib/today';
import { C, HERO_SIZE, PHASE_LABEL, R, SHADOW, T, TOUCH, num, onInk } from '@/lib/tokens';
import type { PlannedSession } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { Btn, Hero, HeroEyebrow, HeroNumeral, HeroText, Sheet } from '@/components/ui';
import { Icon } from '@/components/icons';

/** The readiness word on ink. The light-surface greens and reds are too dark to read there. */
const READY_ON_INK: Record<ReadinessBand, string> = {
  primed: C.greenLight,
  steady: C.amberLight,
  buried: C.redLight,
};

/**
 * The way into Settings. It sits in the eyebrow row, and pulls itself out by
 * the same amount it adds so the hero stays the height it was: the 44px target
 * is for the thumb, not for the layout.
 */
function SettingsGear({ onOpen }: { onOpen: () => void }) {
  return (
    <Btn
      onClick={onOpen}
      label="Settings"
      style={{
        width: TOUCH,
        height: TOUCH,
        margin: '-14px -10px -14px 0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: onInk.body,
      }}
    >
      <Icon name="gear" size={20} />
    </Btn>
  );
}

/** How many days the curve looks back. A month shows the last block's shape without flattening this week into it. */
const CURVE_DAYS = 28;

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

  const load = loadWord(metrics.acwr);
  const toMeet = daysToMeet(b.todayKey, b.competition?.date);

  return (
    <div className="rise" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <Hero style={{ paddingTop: 4 }}>
        <HeroEyebrow right={<SettingsGear onOpen={b.openSettings} />}>
          {block && weekInBlock && totalWeeks ? `Readiness · ${PHASE_LABEL[block.phase]} wk ${weekInBlock} of ${totalWeeks}` : 'Readiness'}
        </HeroEyebrow>

        {/* Nothing logged at all, not "under a day of history": a first session
            done this morning is something to read, it just reads with low confidence. */}
        {scores.sessions === 0 ? (
          <>
            {/* No number rather than a placeholder one: a dash the size of the
                readiness figure reads as a broken bar, not as "nothing yet". */}
            <p style={{ margin: 0, paddingTop: 6, fontSize: T.xxl, fontWeight: 800, letterSpacing: '-0.02em', color: onInk.text }}>Nothing to read yet</p>
            <HeroText maxWidth={340}>
              Log your first session and I’ll start reading your readiness. It takes about two weeks of data before the number means much.
            </HeroText>
          </>
        ) : scores.lowConfidence ? (
          <>
            <HeroNumeral
              value={scores.readiness}
              size={HERO_SIZE.today}
              color={onInk.text}
              label="Still learning"
              labelColor={onInk.muted}
              labelSize={T.xl}
              sub={<TrendSub first={historyPhrase(scores.historyDays)} trend={trend} />}
              ariaLabel={`Readiness ${scores.readiness} out of 100, still learning from ${historyPhrase(scores.historyDays)}.${trendSpoken}`}
            />
            <ScaleTrack readiness={scores.readiness} />
            <HeroText maxWidth={340}>Treat this number as a rough guide until there are two weeks behind it.</HeroText>
          </>
        ) : (
          <>
            <HeroNumeral
              value={scores.readiness}
              size={HERO_SIZE.today}
              // White, not amber: amber is kept for things you can tap. The
              // band word beside it carries the colour.
              color={onInk.text}
              label={READY_LABEL[band]}
              labelColor={READY_ON_INK[band]}
              labelSize={T.xl}
              sub={<TrendSub first={`out of 100 · primed at ${READY_AT.primed}+`} trend={trend} />}
              ariaLabel={`Readiness ${scores.readiness} out of 100, ${READY_WORD[band]}. Fatigue ${scores.fatigueScore}.${trendSpoken}`}
            />
            <ScaleTrack readiness={scores.readiness} />
            <HeroText maxWidth={340}>{sentence}</HeroText>
          </>
        )}

        <FormCurve />
      </Hero>

      <Sheet gap={10} style={{ padding: '16px 18px 14px' }}>
        <WeekChips shownId={shownSlot?.id} onPick={setPreviewSlotId} />

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, paddingTop: 2 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: T.xs, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: C.tertiary, ...num }}>
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
            <h1 style={{ margin: 0, fontSize: T.xxl, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              {routine?.name ?? (b.progress.total > 0 ? 'Week complete' : 'Nothing planned')}
            </h1>
          </div>
          {routine && (
            <span style={{ fontSize: T.sm, fontWeight: 700, color: C.tertiary, flex: 'none', whiteSpace: 'nowrap', ...num }}>
              {routine.slots.length} lifts · ~{routine.estMinutes} min
            </span>
          )}
        </div>

        {routine ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                  style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 8, alignItems: 'baseline', fontSize: T.md }}
                >
                  <span style={{ fontSize: T.xs, fontWeight: 800, color: C.tertiary, ...num }}>{String(index + 1).padStart(2, '0')}</span>
                  <span
                    style={{
                      fontWeight: 700,
                      minWidth: 0,
                      // Superset members hang off an ink rule so the list shows
                      // the shape of the session, not a flat run of lifts.
                      paddingLeft: chip.letter ? 8 : 0,
                      borderLeft: chip.letter ? `2px solid ${C.ink}` : 'none',
                    }}
                  >
                    {exercise?.name ?? slot.exerciseId}
                    {chip.startsGroup && <span style={{ color: C.tertiary, fontWeight: 700 }}> · superset {chip.letter}</span>}
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 2 }}>
          <Btn
            onClick={() => (routine ? b.startSession(routine.id, shownSlot?.id) : b.go('workouts'))}
            style={{
              // In a column now, where flex: 1 would size its height from zero.
              flex: 'none',
              minWidth: 0,
              height: 56,
              padding: '0 14px',
              borderRadius: R.block,
              background: C.amber,
              color: C.ink,
              fontSize: T.lg,
              fontWeight: 800,
              boxShadow: SHADOW.cta,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {/* Names the workout, so the button says exactly what a tap
                starts. "Train anyway" is nonsense when there is nothing to
                train — it sent people looking for a workout they had not
                built yet. */}
            {b.openSession ? 'Resume workout' : routine ? `Start ${routine.name}` : b.routines.length === 0 ? 'Build a workout' : 'Train anyway'}
          </Btn>
          {/* Words, not a hamburger: "Other workouts" says where it goes,
              and a bare three-line icon read as a menu of the whole app. */}
          <Btn
            onClick={() => b.go('workouts')}
            style={{ height: TOUCH, marginBottom: -6, fontSize: T.md, fontWeight: 800, color: C.ink }}
          >
            Other workouts
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
              {/* Always ink: amber is kept for things you can tap, and the
                  Undo beside the sentence already says there is an action.
                  It pulses on arrival when Bompa did or wants something. */}
              <span
                className={action ? 'pulse' : undefined}
                style={{ width: 7, height: 7, borderRadius: '50%', background: C.ink, flex: 'none', alignSelf: 'flex-start', marginTop: 6 }}
              />
              <span style={{ flex: 1, minWidth: 0, fontSize: T.sm, lineHeight: 1.45, color: C.ink80 }}>{insight.text}</span>
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

        {/* Three figures that fit the width, rather than five that scrolled
            sideways where the last two were never seen. Volume and intensity
            are a look back, so they live on History. */}
        <dl
          style={{
            margin: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 10,
            paddingTop: 8,
            borderTop: `1px solid ${C.line}`,
          }}
        >
          <StripMetric
            label="load vs usual"
            value={metrics.acwr === null ? '—' : metrics.acwr.toFixed(2)}
            unit={metrics.acwr === null ? undefined : '×'}
            word={load ?? undefined}
            wordColor={load ? LOAD_COLOUR[load] : undefined}
          />
          <StripMetric
            label="since rest"
            // With nothing logged there is no run of training to count, and
            // "0 days" would read as "you rested today".
            value={scores.sessions === 0 ? '—' : metrics.daysSinceRest}
            unit={scores.sessions === 0 ? undefined : metrics.daysSinceRest === 1 ? 'day' : 'days'}
            // Five straight days is when a rest day stops being optional.
            color={metrics.daysSinceRest >= 5 ? C.redDark : C.ink}
          />
          <StripMetric label="to meet" value={toMeet ?? '—'} unit={toMeet === null ? undefined : toMeet === 1 ? 'day' : 'days'} />
        </dl>
      </Sheet>
    </div>
  );
}

/** Green for fine, amber-dark for a look, red for half again the load you have a base for, which is where injuries start. */
const LOAD_COLOUR: Record<LoadWord, string> = {
  ok: C.greenDark,
  high: C.amberDark,
  'too high': C.redDark,
};

/**
 * Where the number sits on the 0–100 scale, cut where the band word changes.
 * Hidden from screen readers: the numeral's own sentence already says the
 * number and its band, and a picture of the same thing would say it twice.
 */
function ScaleTrack({ readiness }: { readiness: number }) {
  const scale = readinessScale();
  return (
    <div aria-hidden style={{ position: 'relative', display: 'flex', gap: 2, height: 6, marginTop: 8 }}>
      {scale.map((stretch, index) => (
        <span
          key={stretch.band}
          style={{
            flex: stretch.share,
            background: onInk.control,
            borderRadius: index === 0 ? '3px 0 0 3px' : index === scale.length - 1 ? '0 3px 3px 0' : 0,
          }}
        />
      ))}
      <span
        style={{
          position: 'absolute',
          left: `${readinessMarker(readiness)}%`,
          top: -4,
          width: 4,
          height: 14,
          marginLeft: -2,
          borderRadius: R.bar,
          background: onInk.text,
        }}
      />
    </div>
  );
}

/**
 * This week's slots as a row of chips, one per slot. Position, not weekday —
 * the plan commits to a week's work and leaves the timing to you.
 *
 * Each pending chip is a button that loads that workout into the card below.
 * A done or skipped chip is not: a done one is history and a skipped one is a
 * decision already taken, so neither is something to weigh up doing today.
 */
function WeekChips({ shownId, onPick }: { shownId: number | undefined; onPick: (id: number) => void }) {
  const b = useBompa();
  if (b.thisWeekSlots.length === 0) return null;

  return (
    <div role="group" aria-label="This week" style={{ display: 'flex', gap: 6 }}>
      {b.thisWeekSlots.map((slot) => {
        const name = b.routineById(slot.routineId)?.name ?? 'workout';
        const key = slot.id ?? `${slot.weekStart}-${slot.slotIndex}`;
        const shown = shownId !== undefined && slot.id === shownId;
        const isNext = slot.id !== undefined && slot.id === b.nextSlot?.id;
        const style = { ...CHIP, ...chipLook(slot, shown, isNext) };
        const text = (
          // Ellipsis inside a flex chip needs its own box: the chip itself
          // centres its children, and a flex container cannot clip its text.
          <span aria-hidden style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
        );

        if (slot.status !== 'plan' || slot.id === undefined) {
          const done = slot.status === 'done';
          return (
            <span key={key} style={style}>
              {done && <Icon name="check" size={13} style={{ flex: 'none' }} />}
              {text}
              <span className="sr-only">
                {name}, slot {slot.slotIndex + 1}, {done ? 'done' : 'skipped'}
              </span>
            </span>
          );
        }
        const id = slot.id;
        return (
          <Btn key={key} onClick={() => onPick(id)} label={`Show ${name}, slot ${slot.slotIndex + 1}`} pressed={shown} style={style}>
            {text}
          </Btn>
        );
      })}
    </div>
  );
}

const CHIP: CSSProperties = {
  flex: 1,
  // Lets a long workout name shrink to its share instead of widening the row.
  minWidth: 0,
  height: TOUCH,
  padding: '0 6px',
  borderRadius: R.chip,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  fontSize: T.sm,
  fontWeight: 800,
};

function chipLook(slot: PlannedSession, shown: boolean, isNext: boolean): CSSProperties {
  if (slot.status === 'done') return { background: C.greenBg, border: `1px solid ${C.greenBd}`, color: C.greenDark };
  if (slot.status === 'skip') return { border: `1px solid ${C.lineStrong}`, color: C.tertiary, textDecoration: 'line-through' };
  // The one the card is showing is filled, so the row agrees with the card.
  if (shown) return { background: C.ink, border: `1px solid ${C.ink}`, color: C.white };
  // What is next keeps an ink outline while you look at another, so the
  // suggestion is still findable.
  if (isNext) return { border: `1px solid ${C.ink}`, color: C.ink };
  return { border: `1px solid ${C.lineStrong}`, color: C.ink60 };
}

/**
 * The fitness-and-fatigue curve under the readiness number: the history the
 * number comes from. Four weeks rather than a season, and history only: a
 * peak line weeks ahead would squash the month into a corner, and the days to
 * the meet are in the figures below.
 */
function FormCurve() {
  const b = useBompa();
  // Two sessions is the least that draws a line rather than a dot.
  if (b.loads.length < 2) return null;

  const width = 300;
  const height = 60;
  const geometry = curveGeometry(series(b.loads, b.now, CURVE_DAYS), null, width, height);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, marginTop: 6 }}>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ flex: 1, minWidth: 0, height: 40, display: 'block' }} aria-hidden>
          {/* Non-scaling strokes, because the box stretches to the screen width
              and would otherwise smear the dashes and fatten the lines. */}
          <line x1={0} y1={height - 1} x2={width} y2={height - 1} stroke={onInk.line} strokeWidth={1} vectorEffect="non-scaling-stroke" />
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
        </svg>
        {/* The labels double as the legend. Fitness has no 0–100 score of its
            own, so it is named rather than given a number that means nothing. */}
        <div
          aria-hidden
          style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: T.xs, fontWeight: 800, whiteSpace: 'nowrap', ...num }}
        >
          <span style={{ color: C.greenLight }}>fitness</span>
          <span style={{ color: C.redLight }}>fatigue {b.scores.fatigueScore}</span>
          <span style={{ color: onInk.muted, fontWeight: 700 }}>{CURVE_DAYS} days</span>
        </div>
      </div>
      <p className="sr-only">
        Over the last {CURVE_DAYS} days: fitness is now {Math.round(b.scores.fitness)} and fatigue {Math.round(b.scores.fatigue)}.
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
      style={{ flex: 'none', minHeight: TOUCH, minWidth: TOUCH, padding: '0 4px', fontSize: T.sm, fontWeight: 800, color: C.amberDark, whiteSpace: 'nowrap' }}
    >
      {children}
    </Btn>
  );
}

/** One figure in the grid at the foot of Today. A description list, so each value is read with its name. */
function StripMetric({
  label,
  value,
  unit,
  word,
  color = C.ink,
  wordColor,
}: {
  label: string;
  value: string | number;
  unit?: string;
  /** A verdict after the figure, such as "ok", in its own colour. */
  word?: string;
  color?: string;
  wordColor?: string;
}) {
  return (
    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column-reverse', gap: 1 }}>
      {/* The label comes first in the markup so a screen reader hears the name
          before the number; column-reverse puts it back under the figure. */}
      <dt style={{ fontSize: T.xs, fontWeight: 700, color: C.tertiary }}>{label}</dt>
      <dd style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 2, whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: T.xl, fontWeight: 800, color, ...num }}>{value}</span>
        {unit && <span style={{ fontSize: T.sm, fontWeight: 700, color: C.tertiary }}>{unit}</span>}
        {word && <span style={{ fontSize: T.xs, fontWeight: 800, color: wordColor, paddingLeft: 4 }}>{word}</span>}
      </dd>
    </div>
  );
}
