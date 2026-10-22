'use client';

import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { addDays, daysBetween, fmtDayMonth, toDisplay } from '@/lib/calc';
import { weightShort } from '@/lib/bodyweight';
import { summariseSessions } from '@/lib/history';
import { blockContaining, blockRotation, blocksUsing, mesocycleCurve } from '@/lib/plan';
import { weekIsUserModified, weekSlots } from '@/lib/schedule';
import { daysToMeet } from '@/lib/today';
import { C, FONT, HERO_SIZE, ON_PHASE, PH, PHASE_ABBR, PHASE_LABEL, PH_ON_INK, R, ROW_COMPACT, T, TOUCH, W, num, onInk } from '@/lib/tokens';
import type { Phase, PlannedSession, Routine } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { Btn, DarkSheet, Hero, HeroNumeral, HeroText, InkButton, Row, Scroller, Section, Segmented, Sheet } from '@/components/ui';
import { browsableWeeks, macrocycle, nextBlockStart, weekAt, weekPosition } from './PlanMacrocycle';
import { SessionRow } from './SessionHistory';
import { Icon } from '@/components/icons';

/**
 * One scrolling view: where you are in the macrocycle, a week of the plan, the
 * meet, then the blocks. It used to be three tabs, and the meet and the block
 * builder each hid the other two thirds of the plan while you were in them.
 * Building a block and editing the meet are occasional jobs, so they open as
 * sheets over the plan rather than replacing it.
 *
 * The week shown is this week until you step to another, with the arrows, by
 * tapping the macrocycle bar, or by tapping a block. What Bompa changed is not
 * listed here: it lives behind the bell on Today, where it can be dismissed.
 */
export function Plan() {
  const b = useBompa();
  const [building, setBuilding] = useState(false);
  const [editingMeet, setEditingMeet] = useState(false);
  // The week being looked at. Null means this week, and keeps meaning it if
  // the week rolls over with the screen open. Local on purpose: it is browsing,
  // and coming back to Plan should start from now.
  const [picked, setPicked] = useState<string | null>(null);
  const week = picked ?? b.currentWeek;
  const weekTop = useRef<HTMLDivElement>(null);
  const show = (target: string, scroll: boolean) => {
    setPicked(target === b.currentWeek ? null : target);
    // From the bar or a block, the week can be a long way up the page.
    if (scroll) weekTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="rise" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <Hero gap={14}>
        <MacrocycleHero week={week} onPick={(target) => show(target, true)} />
      </Hero>
      <Sheet gap={20}>
        <div ref={weekTop} style={{ display: 'flex', flexDirection: 'column', gap: 8, scrollMarginTop: 12 }}>
          <WeekNav week={week} onPick={(target) => show(target, false)} />
          {week === b.currentWeek ? <ThisWeek /> : <OtherWeek key={week} week={week} />}
        </div>
        <Meet onEdit={() => setEditingMeet(true)} />
        <PlanBlocks week={week} onPick={(target) => show(target, true)} />
        <Btn onClick={() => setBuilding(true)} style={inkButton(52, R.pill, 15)}>
          <Icon name="plus" size={16} style={{ marginRight: 8 }} />
          Add a block
        </Btn>
      </Sheet>

      {/* Outside the sheet above, which is positioned: inside it, these would
          cover only the sheet rather than the whole screen. */}
      <BlockBuilder open={building} onClose={() => setBuilding(false)} />
      <MeetEditor open={editingMeet} onClose={() => setEditingMeet(false)} />
    </div>
  );
}

/** A plain sentence on the light sheet where a list would otherwise be empty. */
function Note({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: T.note, lineHeight: 1.5, color: C.tertiary, padding: '12px 0', borderTop: `1px solid ${C.line}` }}>{children}</span>;
}

/** The same inside a dark sheet. */
function DarkNote({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: T.note, lineHeight: 1.5, color: onInk.muted, padding: '12px 0', borderTop: `1px solid ${onInk.line}` }}>{children}</span>;
}

/** The ink call to action on the light sheet. */
function inkButton(height: number, radius: number, fontSize: number): CSSProperties {
  return {
    height,
    borderRadius: radius,
    background: C.ink,
    color: C.white,
    fontSize,
    fontWeight: W.button,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

// ─────────────────────────────────────────────────────────────
// The macrocycle
// ─────────────────────────────────────────────────────────────

/** The screen's title, with how long the whole plan is beside it. */
function PlanTitle({ right }: { right?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: W.title, letterSpacing: '-0.03em' }}>Plan</h1>
      {right && <span style={{ fontSize: T.sm, fontWeight: W.label, color: onInk.muted, ...num }}>{right}</span>}
    </div>
  );
}

function MacrocycleHero({ week: viewing, onPick }: { week: string; onPick: (week: string) => void }) {
  const b = useBompa();
  const macro = macrocycle(b.blocks, b.todayKey);

  if (!macro) {
    return (
      <>
        <PlanTitle />
        <HeroText>No blocks yet. Add one below.</HeroText>
      </>
    );
  }

  const { totalWeeks, blockWeek } = macro;
  // Before the plan starts or after it ends there is no "week n" to show, so
  // the numeral pins to the nearest end and the line under it says why.
  const before = macro.week < 1;
  const after = macro.week > totalWeeks;
  const week = before ? 0 : after ? totalWeeks : macro.week;

  let sub: string;
  let subColor: string = onInk.muted;
  if (before) sub = `Starts ${fmtDayMonth(macro.start)}`;
  else if (after || !blockWeek) sub = 'Plan complete';
  else if (blockWeek.deload) {
    sub = `Deload · after ${PHASE_LABEL[blockWeek.phase].toLowerCase()}`;
    subColor = PH_ON_INK.deload;
  } else {
    sub = `${PHASE_LABEL[blockWeek.phase]} · week ${blockWeek.week} of ${blockWeek.of}`;
    subColor = PH_ON_INK[blockWeek.phase];
  }

  // The week being looked at, outlined on the bar when it is not this week.
  const viewedIndex = daysBetween(macro.start, viewing) / 7;
  const viewedAt = viewing !== b.currentWeek && viewedIndex >= 0 && viewedIndex < totalWeeks ? viewedIndex / totalWeeks : null;

  return (
    <>
      <PlanTitle right={`${totalWeeks}-week macrocycle`} />
      <HeroNumeral
        value={week}
        size={HERO_SIZE.screen}
        // White: amber is kept for things you can tap.
        color={onInk.text}
        label={`of ${totalWeeks} weeks`}
        labelSize={T.title}
        labelWeight={W.button}
        sub={sub}
        subColor={subColor}
        ariaLabel={`Week ${week} of ${totalWeeks}. ${sub}.`}
      />

      {/* The top padding is the room the today marker pokes up into.
          Tapping anywhere on the bar shows that week below. Touch and mouse
          only: the week arrows and the block list do the same from a
          keyboard, so the bar stays one picture to a screen reader. */}
      <div
        data-macrocycle-bar
        style={{ position: 'relative', paddingTop: 8, cursor: 'pointer' }}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onPick(weekAt(macro, (event.clientX - box.left) / box.width));
        }}
      >
        <div
          role="img"
          aria-label={`${macro.segments
            .map((seg) => `${PHASE_LABEL[seg.phase]} ${seg.weeks} ${seg.weeks === 1 ? 'week' : 'weeks'}${seg.done ? ', done' : ''}`)
            .join('; ')}. Tap the bar to see that week.`}
          style={{ display: 'flex', gap: 3, height: 28 }}
        >
          {macro.segments.map((seg, index) => {
            const first = index === 0;
            const last = index === macro.segments.length - 1;
            return (
              <span
                key={seg.key}
                aria-hidden
                style={{
                  flex: seg.weeks,
                  // Lets a one-week deload shrink to its share instead of
                  // widening to fit its label.
                  minWidth: 0,
                  overflow: 'hidden',
                  background: PH[seg.phase],
                  // Rounded only at the two ends, so the bar reads as one plan cut into blocks.
                  borderRadius: `${first ? R.pill : 0}px ${last ? R.pill : 0}px ${last ? R.pill : 0}px ${first ? R.pill : 0}px`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: T.xs,
                  fontWeight: W.button,
                  whiteSpace: 'nowrap',
                  // Finished blocks are marked with a tick, never faded: fading
                  // the fill takes the ink label on it below a readable contrast.
                  color: ON_PHASE,
                }}
              >
                {PHASE_ABBR[seg.phase]}
                {seg.done && <Icon name="check" size={11} style={{ marginLeft: 2 }} />}
              </span>
            );
          })}
        </div>
        {viewedAt !== null && (
          <span
            aria-hidden
            data-viewing-week
            style={{
              position: 'absolute',
              top: 6,
              height: 32,
              left: `${viewedAt * 100}%`,
              width: `${100 / totalWeeks}%`,
              boxSizing: 'border-box',
              border: `2px solid ${onInk.text}`,
              borderRadius: R.tag,
              pointerEvents: 'none',
            }}
          />
        )}
        {macro.todayAt !== null && (
          <span
            aria-hidden
            style={{ position: 'absolute', top: 2, bottom: -4, left: `${macro.todayAt * 100}%`, width: 2, marginLeft: -1, background: onInk.text, borderRadius: 1 }}
          />
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: T.xs, fontWeight: W.label, color: onInk.muted, ...num }}>
        <span>{fmtDayMonth(macro.start)}</span>
        {macro.todayAt !== null && <span style={{ color: onInk.text }}>Today · {fmtDayMonth(b.todayKey)}</span>}
        <span>{fmtDayMonth(macro.end)}</span>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// This week
// ─────────────────────────────────────────────────────────────

function ThisWeek() {
  const b = useBompa();
  // Which slot has its options expanded.
  const [open, setOpen] = useState<number | null>(null);
  // Whether a swap reaches the rest of the block. Back to this week each time
  // the options open, so a wide swap is never the leftover of an earlier one.
  const [scope, setScope] = useState<'week' | 'block'>('week');
  const slots = b.thisWeekSlots;
  const done = slots.filter((slot) => slot.status === 'done').length;

  return (
    <Section
      title={`This week · ${done} of ${slots.length} done`}
      // Says which of you rearranged this week. `adjustedByBompa` on a row is
      // Bompa doing it and tags ADJUSTED; this is the user doing it, and
      // staying silent would let Bompa take credit for someone else's decision.
      right={weekIsUserModified(slots, b.currentWeek) ? 'You rearranged this week' : 'Order is a suggestion'}
    >
      {slots.length === 0 && <Note>Nothing scheduled this week.</Note>}
      {slots.map((slot, index) => {
        const routine = b.routineById(slot.routineId);
        const isNext = b.nextSlot?.id === slot.id;
        // Done work is history; rearranging it would rewrite what happened.
        // A negative id is a slot just added whose write has not landed yet;
        // moving or dropping it before then would act on a row that is not
        // stored, and it would come back on reload.
        const editable = slot.id !== undefined && slot.id > 0 && slot.status !== 'done';
        const isOpen = open === slot.id;

        return (
          <Row
            key={slot.id ?? index}
            compact
            title={<SlotTitle routine={routine} slot={slot} isNext={isNext} />}
            sub={detailFor(slot, routine, isNext)}
            lead={<StatusCircle slot={slot} index={index} isNext={isNext} />}
            right={
              // Kept even when empty, so every row lines up.
              <span style={{ width: TOUCH, flex: 'none', display: 'flex', marginRight: -10 }}>
                {editable && (
                  <Btn
                    onClick={() => {
                      setOpen(isOpen ? null : slot.id!);
                      setScope('week');
                    }}
                    label={isOpen ? 'Close options' : `Options for ${routine?.name ?? 'this slot'}`}
                    expanded={isOpen}
                    style={{
                      width: TOUCH,
                      height: TOUCH,
                      color: isOpen ? C.ink : C.tertiary,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name={isOpen ? 'close' : 'more'} size={18} />
                  </Btn>
                )}
              </span>
            }
          >
            {isOpen && (
              <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 0 14px 38px' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <SlotBtn onClick={() => void b.moveSession(slot.id!, index - 1)} disabled={index === 0}>
                    <Icon name="arrow-up" size={14} style={{ marginRight: 6 }} />
                    Earlier
                  </SlotBtn>
                  <SlotBtn onClick={() => void b.moveSession(slot.id!, index + 1)} disabled={index === slots.length - 1}>
                    <Icon name="arrow-down" size={14} style={{ marginRight: 6 }} />
                    Later
                  </SlotBtn>
                  <SlotBtn
                    onClick={() => {
                      void b.dropSlot(slot.id!);
                      setOpen(null);
                    }}
                    danger
                  >
                    Drop
                  </SlotBtn>
                </div>
                {/* People look for the workout itself where they see it scheduled.
                    Each slot points to the workout rather than holding a copy,
                    so when other blocks use it too, one quiet Edit would change
                    them all under the same name. Asking first is the fix: this
                    block gets its own version, or the change goes everywhere
                    knowingly. A block's own version is only this block's. */}
                {routine && <EditChoice routine={routine} slot={slot} onDone={() => setOpen(null)} />}
                {b.routines.length > 1 && (
                  <Segmented
                    label="Swap in"
                    value={scope}
                    onChange={setScope}
                    options={[
                      { value: 'week', label: 'Just this week' },
                      { value: 'block', label: 'Every week in block' },
                    ]}
                  />
                )}
                {b.routines.length > 1 && (
                  <Scroller style={{ gap: 6 }}>
                    {b.routines
                      .filter((r) => r.id !== slot.routineId)
                      .map((r) => (
                        <Btn
                          key={r.id}
                          onClick={() => {
                            void b.swapSlotRoutine(slot.id!, r.id, scope);
                            setOpen(null);
                          }}
                          style={{
                            flex: 'none',
                            height: TOUCH,
                            padding: '0 14px',
                            borderRadius: R.pill,
                            background: C.sunken,
                            color: C.ink80,
                            fontSize: T.caption,
                            fontWeight: W.button,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Swap for {r.name}
                        </Btn>
                      ))}
                  </Scroller>
                )}
              </div>
            )}
          </Row>
        );
      })}
      <AddWorkout />
      <span style={{ fontSize: T.caption, lineHeight: 1.5, color: C.tertiary, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
        Train these whenever the week suits you. Dropping one lowers what the week expects; it isn&apos;t a miss, and you can undo it.
      </span>
    </Section>
  );
}

/** "This week", "Last week", "3 weeks ago", "In 5 weeks": the week said against this one. */
function relativeWeek(week: string, currentWeek: string): string {
  const n = Math.round(daysBetween(currentWeek, week) / 7);
  if (n === 0) return 'This week';
  if (n === -1) return 'Last week';
  if (n === 1) return 'Next week';
  return n < 0 ? `${-n} weeks ago` : `In ${n} weeks`;
}

/**
 * Step through the plan a week at a time. The dates and where the week sits in
 * its block are said here; the list below carries "This week", "Last week" and
 * so on in its heading.
 */
function WeekNav({ week, onPick }: { week: string; onPick: (week: string) => void }) {
  const b = useBompa();
  const { first, last } = browsableWeeks(macrocycle(b.blocks, b.todayKey), b.currentWeek);
  const at = weekPosition(b.blocks, week);
  const where = !at ? 'Outside your plan' : at.deload ? `Deload after ${PHASE_LABEL[at.phase].toLowerCase()}` : `${PHASE_LABEL[at.phase]} · week ${at.week} of ${at.of}`;

  return (
    <div role="group" aria-label="Week" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <WeekArrow icon="chevron-left" label="Previous week" disabled={week <= first} onClick={() => onPick(addDays(week, -7))} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, textAlign: 'center' }}>
        <span style={{ fontSize: T.title, fontWeight: W.button, color: C.ink, ...num }}>
          {fmtDayMonth(week)} – {fmtDayMonth(addDays(week, 6))}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: T.caption, fontWeight: W.label, color: C.tertiary }}>
          {at && <span aria-hidden style={{ width: 8, height: 8, flex: 'none', borderRadius: R.swatch, background: PH[at.deload ? 'deload' : at.phase] }} />}
          {where}
        </span>
        {week !== b.currentWeek && (
          <Btn onClick={() => onPick(b.currentWeek)} style={{ minHeight: TOUCH, padding: '0 8px', fontSize: T.sm, fontWeight: W.button, color: C.amberDark }}>
            Back to this week
          </Btn>
        )}
      </div>
      <WeekArrow icon="chevron-right" label="Next week" disabled={week >= last} onClick={() => onPick(addDays(week, 7))} />
    </div>
  );
}

function WeekArrow({ icon, label, disabled, onClick }: { icon: 'chevron-left' | 'chevron-right'; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <Btn
      onClick={onClick}
      label={label}
      disabled={disabled}
      style={{
        width: TOUCH,
        height: TOUCH,
        flex: 'none',
        borderRadius: R.pill,
        background: C.sunken,
        color: C.ink,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={18} />
    </Btn>
  );
}

/**
 * Any week but this one. A week behind you shows what happened: each done
 * session opens to every set, as on History, and anything trained that week
 * outside the plan is listed after it. A week ahead shows what is planned, and
 * each workout opens to its lifts. Neither can be rearranged from here; that
 * is this week's job.
 */
function OtherWeek({ week }: { week: string }) {
  const b = useBompa();
  const [open, setOpen] = useState<string | null>(null);
  const slots = weekSlots(b.planned, week);
  const past = week < b.currentWeek;
  const done = slots.filter((slot) => slot.status === 'done').length;
  const summaries = summariseSessions(b.sessions, b.sets);
  const bySession = new Map(summaries.map((summary) => [summary.session.id, summary]));
  const inPlan = new Set(slots.map((slot) => slot.sessionId).filter((id): id is number => id !== undefined));
  const weekEnds = addDays(week, 7);
  const extras = summaries.filter((x) => x.session.date >= week && x.session.date < weekEnds && !inPlan.has(x.session.id ?? -1));
  const toggle = (key: string) => setOpen(open === key ? null : key);
  const name = relativeWeek(week, b.currentWeek);

  return (
    <Section title={past ? `${name} · ${done} of ${slots.length} done` : `${name} · ${slots.length} planned`}>
      {slots.length === 0 && extras.length === 0 && <Note>{past ? 'Nothing planned or trained this week.' : 'Nothing planned this week.'}</Note>}
      {slots.map((slot, index) => {
        const summary = slot.sessionId === undefined ? undefined : bySession.get(slot.sessionId);
        const key = `slot-${slot.id ?? index}`;
        if (slot.status === 'done' && summary) {
          return (
            <SessionRow
              key={key}
              summary={summary}
              unit={b.s.unit}
              todayKey={b.todayKey}
              expanded={open === key}
              onToggle={() => toggle(key)}
            />
          );
        }
        return <PlannedRow key={key} slot={slot} index={index} expanded={open === key} onToggle={() => toggle(key)} />;
      })}
      {extras.length > 0 && (
        <>
          <span style={{ paddingTop: 10, fontSize: T.sm, fontWeight: W.label, color: C.tertiary }}>
            Also trained
          </span>
          {extras.map((summary) => {
            const key = `session-${summary.session.id}`;
            return (
              <SessionRow
                key={key}
                summary={summary}
                unit={b.s.unit}
                todayKey={b.todayKey}
                expanded={open === key}
                onToggle={() => toggle(key)}
              />
            );
          })}
        </>
      )}
    </Section>
  );
}

/**
 * A slot in a week other than this one. It opens to the workout's lifts as the
 * workout is written; the line under the name already says how this week
 * scales them. A skipped slot, or one whose workout was deleted, has nothing
 * to open.
 */
function PlannedRow({ slot, index, expanded, onToggle }: { slot: PlannedSession; index: number; expanded: boolean; onToggle: () => void }) {
  const b = useBompa();
  const panelId = useId();
  const routine = b.routineById(slot.routineId);
  const name = routine?.name ?? 'Deleted workout';
  const canOpen = Boolean(routine) && slot.status !== 'skip';

  const head = (
    <>
      <StatusCircle slot={slot} index={index} isNext={false} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <SlotTitle routine={routine} slot={slot} isNext={false} />
        <span style={{ fontSize: T.sm, fontWeight: W.label, color: C.tertiary, ...num }}>{detailFor(slot, routine, false)}</span>
      </span>
      <span style={{ width: 16, flex: 'none', display: 'flex', color: C.tertiary }}>
        {canOpen && <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} />}
      </span>
    </>
  );
  const line = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: ROW_COMPACT, padding: '6px 0', textAlign: 'left', color: C.ink } as const;

  return (
    <div style={{ borderTop: `1px solid ${C.lineSoft}`, display: 'flex', flexDirection: 'column' }}>
      {canOpen ? (
        // A plain button rather than Row, because a row that opens has to say
        // whether it is open, and that needs aria-expanded.
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${expanded ? 'Hide' : 'Show'} ${name}, slot ${index + 1}`}
          style={{ ...line, fontFamily: FONT, border: 'none', background: 'transparent', cursor: 'pointer' }}
        >
          {head}
        </button>
      ) : (
        <div style={line}>{head}</div>
      )}
      {expanded && routine && (
        <ul id={panelId} className="rise" style={{ listStyle: 'none', margin: 0, padding: '0 0 12px 38px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {routine.slots.map((lift) => {
            const exercise = b.exerciseById.get(lift.exerciseId);
            const reps = lift.repsMax ? `${lift.reps}–${lift.repsMax}` : `${lift.reps}`;
            const weight =
              lift.targetWeightKg !== null
                ? weightShort(toDisplay(lift.targetWeightKg, b.s.unit), b.s.unit, b.isBodyweightLift(lift.exerciseId))
                : lift.targetPct1RM
                  ? `${Math.round(lift.targetPct1RM * 100)}% of max`
                  : weightShort(0, b.s.unit);
            return (
              <li key={`${lift.exerciseId}-${lift.order}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: T.note, color: C.ink80 }}>
                <span style={{ minWidth: 0 }}>
                  {lift.supersetGroup && <span style={{ fontWeight: W.button, color: C.tertiary }}>{lift.supersetGroup} · </span>}
                  {exercise?.name ?? lift.exerciseId}
                </span>
                <span style={{ flex: 'none', fontWeight: 700, ...num }}>
                  {lift.sets} × {reps} @ {weight}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Put one of your own workouts into the plan: this week only, or every week
 * left in the block. Your own workouts only — templates are copied before they
 * are trained, never scheduled as they are.
 */
function AddWorkout() {
  const b = useBompa();
  const [open, setOpen] = useState(false);
  // Which workout has its two choices showing.
  const [picked, setPicked] = useState<string | null>(null);
  const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 0', borderTop: `1px solid ${C.line}` };

  // Said rather than offered: a button that silently does nothing when there
  // is no week to put the workout in would look broken.
  if (!b.plan) return <Note>No plan yet, so there is no week to add a workout to. Add a block below.</Note>;
  if (!blockContaining(b.blocks, b.currentWeek)) {
    return <Note>No block covers this week, so there is nowhere to add a workout. Add a block below.</Note>;
  }

  const close = () => {
    setOpen(false);
    setPicked(null);
  };

  return (
    <div style={wrap}>
      <Btn
        onClick={() => (open ? close() : setOpen(true))}
        label="Add a workout"
        pressed={open}
        style={{
          height: TOUCH,
          borderRadius: R.pill,
          // Dashed: a slot to fill, not a choice already made.
          border: `1px dashed ${open ? C.ink : C.lineStrong}`,
          background: 'transparent',
          color: C.ink60,
          fontSize: T.note,
          fontWeight: W.button,
        }}
      >
        + Add a workout
      </Btn>

      {open && b.routines.length === 0 && (
        <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: T.note, lineHeight: 1.5, color: C.tertiary }}>
            You have no workouts of your own yet. Build one, or copy a template, on the Workouts tab.
          </span>
          {/* In a row so the button's flex: 1 fills the width. In a column,
              flex: 1 would act on its height instead. */}
          <div style={{ display: 'flex' }}>
            <SlotBtn onClick={() => b.go('workouts')}>Go to Workouts</SlotBtn>
          </div>
        </div>
      )}

      {open && b.routines.length > 0 && (
        <div className="rise" style={{ display: 'flex', flexDirection: 'column' }}>
          {b.routines.map((routine) => {
            const isPicked = picked === routine.id;
            return (
              <Row
                key={routine.id}
                title={routine.name}
                sub={`${routine.slots.length} ${routine.slots.length === 1 ? 'lift' : 'lifts'}`}
                label={isPicked ? `Close choices for ${routine.name}` : `Choose ${routine.name}`}
                onClick={() => setPicked(isPicked ? null : routine.id)}
                right={
                  <span style={{ display: 'flex', color: isPicked ? C.ink : C.tertiary }}>
                    <Icon name={isPicked ? 'close' : 'plus'} size={16} />
                  </span>
                }
              >
                {isPicked && (
                  <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 14 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <SlotBtn
                        label={`Add ${routine.name} just this week`}
                        onClick={() => {
                          b.addWorkout(routine.id, 'week');
                          close();
                        }}
                      >
                        Just this week
                      </SlotBtn>
                      <SlotBtn
                        label={`Add ${routine.name} every week from now`}
                        onClick={() => {
                          b.addWorkout(routine.id, 'every');
                          close();
                        }}
                      >
                        Every week from now
                      </SlotBtn>
                    </div>
                    <span style={{ fontSize: T.caption, lineHeight: 1.5, color: C.tertiary }}>
                      Either way it is planned work, so the week expects it. Every week runs to the end of this block.
                    </span>
                  </div>
                )}
              </Row>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Edit the slot's workout, asking which blocks the change is for when more than this one use it. */
function EditChoice({ routine, slot, onDone }: { routine: Routine; slot: PlannedSession; onDone: () => void }) {
  const b = useBompa();
  const users = blocksUsing(routine.id, b.blocks, b.planned, b.plan).length;
  const edit = () => b.patch({ editingRoutineId: routine.id });
  if (users < 2 || routine.versionOf?.blockId === slot.blockId) {
    return (
      <div style={{ display: 'flex' }}>
        <SlotBtn onClick={edit} label={`Edit workout ${routine.name}`}>
          <Icon name="edit" size={14} style={{ marginRight: 6 }} />
          Edit {routine.name}
        </SlotBtn>
      </div>
    );
  }
  // Stacked, not side by side: at phone width two of these would wrap mid-word.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex' }}>
        <SlotBtn
          onClick={() => {
            b.makeBlockVersion(slot.id!);
            onDone();
          }}
        >
          <Icon name="edit" size={14} style={{ marginRight: 6 }} />
          Edit for this block only
        </SlotBtn>
      </div>
      <div style={{ display: 'flex' }}>
        <SlotBtn onClick={edit}>
          Edit everywhere (<span style={num}>{users}</span> blocks)
        </SlotBtn>
      </div>
    </div>
  );
}

function SlotBtn({
  children,
  onClick,
  disabled,
  danger,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** When the visible text alone would not say which workout it acts on. */
  label?: string;
}) {
  return (
    <Btn
      onClick={onClick}
      disabled={disabled}
      label={label}
      style={{
        flex: 1,
        height: TOUCH,
        borderRadius: R.pill,
        background: danger ? C.redBg : C.sunken,
        color: danger ? C.redDark : C.ink80,
        fontSize: T.caption,
        fontWeight: W.button,
      }}
    >
      {children}
    </Btn>
  );
}

/**
 * The circle that leads a slot's row, in place of a tag at its end: a tick
 * when done, otherwise the slot's place in the week, filled ink when it is
 * next. Ink rather than amber, because amber means something to tap. The
 * status itself is said in words on the line under the name.
 */
function StatusCircle({ slot, index, isNext }: { slot: PlannedSession; index: number; isNext: boolean }) {
  const done = slot.status === 'done';
  const look = done
    ? { background: C.greenBg, color: C.greenDark }
    : isNext
      ? { background: C.ink, color: C.white }
      : { background: C.sunken, color: C.ink60 };
  return (
    <span
      data-slot-status={done ? 'done' : isNext ? 'next' : slot.status === 'skip' ? 'skip' : 'planned'}
      style={{
        width: 28,
        height: 28,
        flex: 'none',
        borderRadius: R.pill,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: T.sm,
        fontWeight: W.button,
        ...look,
        ...num,
      }}
    >
      {done ? <Icon name="check" size={14} /> : index + 1}
    </span>
  );
}

/** The workout's name: quieter once done, firmer when it is next, grey when its workout is gone. */
function SlotTitle({ routine, slot, isNext }: { routine: Routine | undefined; slot: PlannedSession; isNext: boolean }) {
  const color = !routine ? C.tertiary : slot.status === 'done' ? C.ink60 : C.ink;
  return <span style={{ fontSize: T.title, fontWeight: isNext ? W.title : W.button, color }}>{routine?.name ?? 'Deleted workout'}</span>;
}

/**
 * The line under a slot's name, led by its status in words. When I changed
 * it, it says what and says it was me.
 */
function detailFor(slot: PlannedSession, routine: Routine | undefined, isNext: boolean): string {
  const count = routine?.slots.length ?? 0;
  const lifts = `${count} ${count === 1 ? 'lift' : 'lifts'}`;
  if (slot.status === 'done') return slot.date ? `Done ${fmtDayMonth(slot.date)} · ${lifts}` : `Done · ${lifts}`;
  if (slot.status === 'skip') return 'Skipped · the week rolled over before this one happened';
  const pct = Math.round(slot.volumeFactor * 100);
  let rest: string;
  if (slot.adjustedByBompa) {
    const verb = pct < 100 ? 'I trimmed it' : pct > 100 ? 'I added to it' : 'I changed it';
    rest = `Adjusted · ${lifts} · ${pct}% volume, ${verb}`;
  } else if (pct !== 100) rest = `${lifts} · ${pct}% volume`;
  else rest = routine ? `${lifts} · ~${routine.estMinutes} min` : lifts;
  return isNext ? `Next · ${rest}` : rest;
}

// ─────────────────────────────────────────────────────────────
// The meet
// ─────────────────────────────────────────────────────────────

/**
 * Whether the projected peak lands on meet day, or null when there is no
 * meet or no peak to compare. Three days either side still puts the peak on
 * the platform.
 */
function peakAlignment(peakWindow: { startDate: string; endDate: string } | null, meetDate: string | undefined) {
  if (!peakWindow || !meetDate) return null;
  const drift = daysBetween(peakWindow.endDate, meetDate);
  return { drift, aligned: Math.abs(drift) <= 3, range: `${fmtDayMonth(peakWindow.startDate)}–${fmtDayMonth(peakWindow.endDate)}` };
}

function Meet({ onEdit }: { onEdit: () => void }) {
  const b = useBompa();
  const meet = b.competition;
  const days = daysToMeet(b.todayKey, meet?.date);
  const alignment = peakAlignment(b.taper && b.taper.phases.length > 0 ? b.peakWindow : null, meet?.date);

  let sub: ReactNode = "Give me a date and I'll work the whole build backwards from it.";
  if (meet) {
    const where = [fmtDayMonth(meet.date), meet.location].filter(Boolean).join(' · ');
    if (!alignment) sub = where;
    else if (alignment.aligned) sub = <span style={{ color: C.greenDark }}>{fmtDayMonth(meet.date)} · peak lines up with it</span>;
    else {
      sub = (
        <span style={{ color: C.amberDark }}>
          {fmtDayMonth(meet.date)} · peak lands {Math.abs(alignment.drift)} days {alignment.drift > 0 ? 'early' : 'late'}
        </span>
      );
    }
  }

  // The whole row opens the meet, so the countdown is the thing the eye lands on
  // rather than an Edit button beside it.
  return (
    <Section title="Meet">
      <Row
        compact
        onClick={onEdit}
        label={meet ? 'Edit meet' : 'Set a meet'}
        title={<span style={{ fontWeight: W.title }}>{meet ? meet.name : 'No meet set'}</span>}
        sub={sub}
        right={
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
            {meet && days !== null && (
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 3, ...num }}>
                <span style={{ fontSize: T.count, fontWeight: W.title, letterSpacing: '-0.03em' }}>{days}</span>
                <span style={{ fontSize: T.sm, fontWeight: W.label, color: C.tertiary }}>{days === 1 ? 'day' : 'days'}</span>
              </span>
            )}
            {!meet && <span style={{ fontSize: T.note, fontWeight: W.button, color: C.amberDark }}>Set</span>}
            <span style={{ display: 'flex', color: C.tertiary }}>
              <Icon name="chevron-right" size={18} />
            </span>
          </span>
        }
      />
    </Section>
  );
}

function MeetEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const b = useBompa();
  return (
    <DarkSheet open={open} onClose={onClose} eyebrow="Meet" title={b.competition ? 'Edit meet' : 'Set a meet'} gap={16}>
      {/* Mounted with the sheet, so the fields start from what is saved each time it opens. */}
      {open && <MeetForm />}
    </DarkSheet>
  );
}

function MeetForm() {
  const b = useBompa();
  const [name, setName] = useState(b.competition?.name ?? '');
  const [date, setDate] = useState(b.competition?.date ?? '');
  const [place, setPlace] = useState(b.competition?.location ?? '');
  const alignment = peakAlignment(b.peakWindow, b.competition?.date);

  return (
    <>
      <p style={{ margin: 0, fontSize: T.md, lineHeight: 1.45, color: onInk.body }}>The whole build is worked backwards from this date.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="Name" value={name} onChange={setName} placeholder="Autumn Open" />
        <div style={{ display: 'flex', gap: 8 }}>
          <Field label="Date" value={date} onChange={setDate} type="date" />
          <Field label="Where" value={place} onChange={setPlace} placeholder="Bristol" />
        </div>
        <InkButton variant="amber" height={52} onClick={() => name && date && b.saveCompetition(name, date, place)} disabled={!name || !date}>
          {b.competition ? 'Update meet' : 'Set meet day'}
        </InkButton>
      </div>

      {b.taper && (
        <Section title="Reverse taper" titleColor={onInk.muted}>
          {b.taper.phases.length === 0 && <DarkNote>{b.taper.warning}</DarkNote>}
          {b.taper.phases.map((phase) => (
            <div
              key={phase.name}
              style={{ display: 'grid', gridTemplateColumns: '12px 1fr auto', gap: 12, alignItems: 'flex-start', padding: '12px 0', borderTop: `1px solid ${onInk.line}` }}
            >
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: R.swatch, background: PH[phase.phase], marginTop: 5 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: T.title, fontWeight: W.button }}>{phase.name}</span>
                <span style={{ fontSize: T.caption, fontWeight: 600, color: onInk.muted, ...num }}>{phase.detail}</span>
              </div>
              <span style={{ fontSize: T.caption, fontWeight: W.label, color: onInk.body, textAlign: 'right', ...num }}>
                {fmtDayMonth(phase.startDate)}–{fmtDayMonth(phase.endDate)}
              </span>
            </div>
          ))}
          {b.taper.phases.length > 0 && b.taper.warning && <DotLine tone="amber">{b.taper.warning}</DotLine>}
          {b.taper.phases.length > 0 && alignment && (
            <DotLine tone={alignment.aligned ? 'green' : 'amber'}>
              {alignment.aligned
                ? `Your peak window lands ${alignment.range}, right on meet day.`
                : `Your peak window lands ${alignment.range} — ${Math.abs(alignment.drift)} days ${alignment.drift > 0 ? 'early' : 'late'}. Stretch or shorten the strength block to move it onto meet day.`}
            </DotLine>
          )}
        </Section>
      )}
    </>
  );
}

/** A sentence on ink led by a coloured dot: green when things line up, amber when they need a look. */
function DotLine({ tone, children }: { tone: 'green' | 'amber'; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 0 0', borderTop: `1px solid ${onInk.line}` }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: tone === 'green' ? C.greenLight : C.amberLight, marginTop: 6, flex: 'none' }} />
      <span style={{ fontSize: T.copy, lineHeight: 1.45, fontWeight: 600, color: tone === 'green' ? C.greenLight : C.amberLight, ...num }}>{children}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    // minWidth 0 lets the two side-by-side fields share the row; a flex child
    // otherwise refuses to shrink below the date picker's natural width.
    <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: T.xs, fontWeight: 700, color: onInk.muted }}>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        style={{
          height: 48,
          borderRadius: R.chip,
          border: `1px solid ${onInk.control}`,
          background: 'transparent',
          padding: type === 'date' ? '0 11px' : '0 13px',
          fontSize: type === 'date' ? 14 : 15,
          fontWeight: 700,
          color: onInk.text,
          // Draws the browser's own date picker icon light, so it shows on ink.
          colorScheme: 'dark',
          fontFamily: 'inherit',
          width: '100%',
          minWidth: 0,
          ...num,
        }}
      />
    </label>
  );
}

// ─────────────────────────────────────────────────────────────
// Blocks
// ─────────────────────────────────────────────────────────────

const BLOCK_TYPES: { id: Phase; label: string; sub: string }[] = [
  { id: 'hypertrophy', label: 'Hypertrophy', sub: 'High volume · RPE 7' },
  { id: 'strength', label: 'Strength', sub: '80–90% · RPE 8' },
  { id: 'power', label: 'Power', sub: 'Speed · RPE 7' },
  { id: 'peak', label: 'Peak', sub: 'Taper to test' },
];

/**
 * Every block in the plan, its dates and the workouts it cycles through, so a
 * block with its own versions says so. Tapping one shows its first week above,
 * or the week being looked at if that is already inside it.
 */
function PlanBlocks({ week, onPick }: { week: string; onPick: (week: string) => void }) {
  const b = useBompa();
  if (b.blocks.length === 0) return null;
  const blocks = [...b.blocks].sort((x, y) => (x.startDate < y.startDate ? -1 : 1));

  return (
    <Section title="Blocks in your plan">
      <div role="list" aria-label="Blocks in your plan" style={{ display: 'flex', flexDirection: 'column' }}>
        {blocks.map((block) => {
          const names = blockRotation(block, b.plan).map((id) => b.routineById(id)?.name ?? 'Deleted workout');
          const ends = addDays(block.startDate, (block.weeks + block.deloadWeeks) * 7 - 1);
          const inside = week >= block.startDate && week <= ends;
          const length = `${block.weeks} ${block.weeks === 1 ? 'week' : 'weeks'}${block.deloadWeeks > 0 ? ' + deload' : ''}`;
          return (
            <div key={block.id ?? block.startDate} role="listitem" style={{ borderTop: `1px solid ${C.line}` }}>
              <Btn
                onClick={() => onPick(inside ? week : block.startDate)}
                label={`Show the ${PHASE_LABEL[block.phase].toLowerCase()} block, ${fmtDayMonth(block.startDate)} to ${fmtDayMonth(ends)}`}
                style={{ width: '100%', display: 'grid', gridTemplateColumns: '12px 1fr auto', gap: 12, alignItems: 'flex-start', padding: '12px 0', textAlign: 'left', color: C.ink }}
              >
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: R.swatch, background: PH[block.phase], marginTop: 5 }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: T.title, fontWeight: W.button }}>{PHASE_LABEL[block.phase]} block</span>
                  <span style={{ fontSize: T.caption, fontWeight: 700, color: C.ink80, ...num }}>
                    {fmtDayMonth(block.startDate)} – {fmtDayMonth(ends)} · {length}
                  </span>
                  <span style={{ fontSize: T.caption, fontWeight: 600, color: C.tertiary }}>
                    {block.rotation ? 'Its own workouts: ' : ''}
                    {names.join(', ')}
                  </span>
                </span>
                <Icon name="chevron-right" size={16} style={{ marginTop: 3, color: inside ? C.ink : C.tertiary }} />
              </Btn>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** The block builder, as a sheet over the plan. It adds the block after the last one, so nothing already scheduled moves. */
function BlockBuilder({ open, onClose }: { open: boolean; onClose: () => void }) {
  const b = useBompa();
  const phase = b.s.builderPhase;
  const type = BLOCK_TYPES.find((t) => t.id === phase) ?? BLOCK_TYPES[0]!;
  const weeks = b.s.builderWeeks;
  const starts = nextBlockStart(b.blocks, b.todayKey);
  const curve = mesocycleCurve(phase, weeks);

  return (
    <DarkSheet open={open} onClose={onClose} eyebrow="New block" title="Add a block" gap={20}>
      <p style={{ margin: 0, fontSize: T.md, lineHeight: 1.45, color: onInk.body, ...num }}>
        <span style={{ display: 'block', fontWeight: W.button, color: onInk.text }}>
          New {type.label.toLowerCase()} block, {weeks} weeks plus a deload week. {type.sub}.
        </span>
        {b.blocks.length > 0
          ? `Starts ${fmtDayMonth(starts)}, after the current plan ends. Nothing already scheduled moves.`
          : `Starts ${fmtDayMonth(starts)}.`}
      </p>

      <Section title="Block type" titleColor={onInk.muted}>
        <div role="group" aria-label="Block type" style={{ display: 'flex', flexDirection: 'column' }}>
          {BLOCK_TYPES.map((option) => {
            const on = phase === option.id;
            return (
              <Btn
                key={option.id}
                onClick={() => b.patch({ builderPhase: option.id })}
                pressed={on}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '12px 1fr auto',
                  gap: 12,
                  alignItems: 'center',
                  minHeight: TOUCH,
                  padding: '12px 0',
                  borderTop: `1px solid ${onInk.line}`,
                  textAlign: 'left',
                }}
              >
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: R.swatch, background: PH[option.id] }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: T.title, fontWeight: W.button, color: onInk.text }}>{option.label}</span>
                  <span style={{ fontSize: T.caption, fontWeight: 600, color: onInk.muted, ...num }}>{option.sub}</span>
                </span>
                {/* A radio ring: filled white with an ink inner ring when picked. */}
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    border: `2px solid ${on ? onInk.text : onInk.control}`,
                    background: on ? onInk.text : 'transparent',
                    boxShadow: on ? `inset 0 0 0 3px ${C.ink}` : 'none',
                  }}
                />
              </Btn>
            );
          })}
        </div>
      </Section>

      <Section title="Length" titleColor={onInk.muted}>
        <div role="group" aria-label="Block length in weeks" style={{ display: 'flex', gap: 7, paddingTop: 2 }}>
          {[3, 4, 5, 6].map((length) => {
            const on = weeks === length;
            return (
              <Btn
                key={length}
                onClick={() => b.patch({ builderWeeks: length })}
                pressed={on}
                style={{
                  flex: 1,
                  height: 48,
                  borderRadius: R.pill,
                  fontSize: T.title,
                  fontWeight: W.button,
                  background: on ? C.white : onInk.raised,
                  color: on ? C.ink : onInk.text,
                  ...num,
                }}
              >
                {length}
              </Btn>
            );
          })}
        </div>
      </Section>

      <Section
        title="Generated curve"
        titleColor={onInk.muted}
        right={
          <span style={{ display: 'flex', gap: 10, fontSize: T.xs }}>
            <span style={{ color: PH_ON_INK[phase] }}>■ volume</span>
            <span style={{ color: onInk.body }}>■ intensity</span>
          </span>
        }
      >
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-end', height: 140, paddingTop: 4 }}>
          {curve.map((week) => (
            <div key={week.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
              <span style={{ fontSize: T.xs, fontWeight: W.label, color: onInk.muted, ...num }}>{Math.round(week.intensity * 100)}%</span>
              <div style={{ width: '100%', display: 'flex', gap: 2, alignItems: 'flex-end', height: `${Math.round(week.volume * 100)}%` }}>
                <span style={{ flex: 1, height: '100%', borderRadius: `${R.swatch}px ${R.swatch}px 0 0`, background: week.isDeload ? PH.deload : PH[phase] }} />
                {/* Light grey, not amber: amber is kept for things you can tap. */}
                <span style={{ flex: 1, height: `${Math.round(week.intensity * 100)}%`, borderRadius: `${R.swatch}px ${R.swatch}px 0 0`, background: onInk.body }} />
              </div>
              <span style={{ fontSize: T.xs, fontWeight: W.label, color: onInk.muted, ...num }}>{week.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <BlockWorkouts />

      <InkButton
        variant="amber"
        height={56}
        onClick={() => {
          b.addBlock();
          onClose();
        }}
        disabled={b.s.builderRotation?.length === 0}
      >
        Add block to calendar
      </InkButton>
    </DarkSheet>
  );
}

/**
 * Which of your workouts the new block cycles through, and in what order.
 * Starts on the plan's own list, so adding a block without touching this is
 * what it always was.
 */
function BlockWorkouts() {
  const b = useBompa();
  if (!b.plan || b.routines.length === 0) return null;

  const known = new Set(b.routines.map((r) => r.id));
  const chosen = b.s.builderRotation ?? b.plan.rotation.filter((id) => known.has(id));
  const set = (builderRotation: string[]) => b.patch({ builderRotation });
  const move = (from: number, to: number) => {
    const next = [...chosen];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id!);
    set(next);
  };
  // Chosen first, in the order they will run, then the rest to pick from.
  const ordered = [...chosen.map((id) => b.routineById(id)!), ...b.routines.filter((r) => !chosen.includes(r.id))];

  return (
    <Section title="Workouts" titleColor={onInk.muted} right={<span style={{ color: onInk.muted }}>{chosen.length} in the block</span>}>
      {ordered.map((routine) => {
        const at = chosen.indexOf(routine.id);
        const on = at >= 0;
        return (
          <Row
            key={routine.id}
            dark
            title={routine.name}
            lead={
              <span style={{ width: 24, flex: 'none', fontSize: T.caption, fontWeight: W.label, color: onInk.muted, ...num }}>{on ? at + 1 : ''}</span>
            }
            right={
              <span style={{ display: 'flex', gap: 6 }}>
                {on && (
                  <>
                    <OrderBtn label={`Move ${routine.name} earlier`} disabled={at === 0} onClick={() => move(at, at - 1)}>
                      <Icon name="arrow-up" size={16} />
                    </OrderBtn>
                    <OrderBtn label={`Move ${routine.name} later`} disabled={at === chosen.length - 1} onClick={() => move(at, at + 1)}>
                      <Icon name="arrow-down" size={16} />
                    </OrderBtn>
                  </>
                )}
                <Btn
                  label={`Use ${routine.name}`}
                  pressed={on}
                  onClick={() => set(on ? chosen.filter((id) => id !== routine.id) : [...chosen, routine.id])}
                  style={{
                    width: TOUCH,
                    height: TOUCH,
                    borderRadius: R.pill,
                    background: on ? C.white : onInk.raised,
                    color: on ? C.ink : onInk.body,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name={on ? 'check' : 'plus'} size={16} />
                </Btn>
              </span>
            }
          />
        );
      })}
      <DarkNote>
        {chosen.length === 0
          ? 'Pick at least one workout for the block.'
          : `The block starts on the first and works down the list, ${b.plan.sessionsPerWeek} sessions a week.`}
      </DarkNote>
    </Section>
  );
}

function OrderBtn({ children, label, disabled, onClick }: { children: ReactNode; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <Btn
      label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: TOUCH,
        height: TOUCH,
        borderRadius: R.pill,
        background: onInk.raised,
        color: onInk.body,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </Btn>
  );
}
