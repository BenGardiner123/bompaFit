'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { dateKey, daysBetween, fmtDayMonth } from '@/lib/calc';
import { blockContaining, mesocycleCurve } from '@/lib/plan';
import { weekIsUserModified } from '@/lib/schedule';
import { C, HERO_SIZE, ON_PHASE, PH, PHASE_ABBR, PHASE_LABEL, PH_ON_INK, R, TOUCH, num, onInk } from '@/lib/tokens';
import type { Phase, PlannedSession } from '@/lib/types';
import { useBompa, type PlanTab } from '@/state/BompaContext';
import { Btn, Hero, HeroEyebrow, HeroNumeral, HeroTabs, HeroText, Row, Scroller, Section, Sheet, Tag } from '@/components/ui';
import { macrocycle, nextBlockStart } from './PlanMacrocycle';

const PLAN_TABS: { value: PlanTab; label: string }[] = [
  { value: 'cal', label: 'Calendar' },
  { value: 'meso', label: 'Mesocycle' },
  { value: 'peak', label: 'Peak mode' },
];

export function Plan() {
  const b = useBompa();
  const tab = b.s.planTab;
  return (
    <div className="rise" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* The hero leads with a number rather than a title, so the screen's name
          is still announced for anyone navigating by heading. */}
      <h1 className="sr-only">Plan</h1>
      <Hero gap={14} style={{ paddingTop: 4 }}>
        <HeroTabs label="Plan view" value={tab} options={PLAN_TABS} onChange={(planTab) => b.patch({ planTab })} />
        {tab === 'cal' && <CalendarHero />}
        {tab === 'meso' && <MesocycleHero />}
        {tab === 'peak' && <PeakHero />}
      </Hero>
      <Sheet>
        {tab === 'cal' && <Calendar />}
        {tab === 'meso' && <Mesocycle />}
        {tab === 'peak' && <Peak />}
      </Sheet>
    </div>
  );
}

/** A plain sentence on the light sheet where a list would otherwise be empty. */
function Note({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 13, lineHeight: 1.5, color: C.tertiary, padding: '12px 0', borderTop: `1px solid ${C.line}` }}>{children}</span>;
}

/** The ink call to action on the light sheet. */
function inkButton(height: number, radius: number, fontSize: number): CSSProperties {
  return { height, borderRadius: radius, background: C.ink, color: C.white, fontSize, fontWeight: 800 };
}

// ─────────────────────────────────────────────────────────────
// Calendar
// ─────────────────────────────────────────────────────────────

function CalendarHero() {
  const b = useBompa();
  const macro = macrocycle(b.blocks, b.todayKey);

  if (!macro) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <HeroEyebrow>Macrocycle</HeroEyebrow>
        <HeroText>No blocks yet. Build one on the Mesocycle tab.</HeroText>
      </div>
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
    sub = `${PHASE_LABEL[blockWeek.phase]} · wk ${blockWeek.week} of ${blockWeek.of}`;
    subColor = PH_ON_INK[blockWeek.phase];
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <HeroEyebrow>Macrocycle · {totalWeeks} weeks</HeroEyebrow>
        <HeroNumeral
          value={week}
          size={HERO_SIZE.screen}
          label={`of ${totalWeeks} weeks`}
          sub={sub}
          subColor={subColor}
          ariaLabel={`Week ${week} of ${totalWeeks}. ${sub}.`}
        />
      </div>

      {/* The top padding is the room the today marker's dot pokes up into. */}
      <div style={{ position: 'relative', paddingTop: 10 }}>
        <div
          role="img"
          aria-label={macro.segments
            .map((seg) => `${PHASE_LABEL[seg.phase]} ${seg.weeks} ${seg.weeks === 1 ? 'week' : 'weeks'}${seg.done ? ', done' : ''}`)
            .join('; ')}
          style={{ display: 'flex', gap: 3, height: 38 }}
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
                  borderRadius: `${first ? 6 : 0}px ${last ? 6 : 0}px ${last ? 6 : 0}px ${first ? 6 : 0}px`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 800,
                  whiteSpace: 'nowrap',
                  // Finished blocks are marked with a tick, never faded: fading
                  // the fill takes the ink label on it below a readable contrast.
                  color: ON_PHASE,
                }}
              >
                {PHASE_ABBR[seg.phase]}
                {seg.done ? ' ✓' : ''}
              </span>
            );
          })}
        </div>
        {macro.todayAt !== null && (
          <>
            <span
              aria-hidden
              style={{ position: 'absolute', top: 0, bottom: -6, left: `${macro.todayAt * 100}%`, width: 2, marginLeft: -1, background: onInk.text, borderRadius: 1 }}
            />
            <span
              aria-hidden
              style={{ position: 'absolute', top: -2, left: `${macro.todayAt * 100}%`, width: 10, height: 10, marginLeft: -5, borderRadius: '50%', background: onInk.text }}
            />
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, fontWeight: 700, color: onInk.muted, ...num }}>
        <span>{fmtDayMonth(macro.start)}</span>
        {macro.todayAt !== null && <span style={{ color: onInk.text }}>today · {fmtDayMonth(b.todayKey)}</span>}
        <span>{fmtDayMonth(macro.end)}</span>
      </div>
    </div>
  );
}

function Calendar() {
  const b = useBompa();
  // Which slot has its options expanded.
  const [open, setOpen] = useState<number | null>(null);
  const slots = b.thisWeekSlots;
  const done = slots.filter((slot) => slot.status === 'done').length;

  return (
    <>
      <Section
        title={`This week · ${done} of ${slots.length} done`}
        // Says which of you rearranged this week. `adjustedByBompa` on a row is
        // Bompa doing it and tags ADJ; this is the user doing it, and staying
        // silent would let Bompa take credit for someone else's decision.
        right={weekIsUserModified(slots, b.currentWeek) ? 'You rearranged this week' : undefined}
      >
        {slots.length === 0 && <Note>Nothing scheduled this week.</Note>}
        {slots.map((slot, index) => {
          const routine = b.routineById(slot.routineId);
          const isNext = b.nextSlot?.id === slot.id;
          const tag = statusTag(slot, isNext);
          // Done work is history; rearranging it would rewrite what happened.
          // A negative id is a slot just added whose write has not landed yet;
          // moving or dropping it before then would act on a row that is not
          // stored, and it would come back on reload.
          const editable = slot.id !== undefined && slot.id > 0 && slot.status !== 'done';
          const isOpen = open === slot.id;

          return (
            <Row
              key={slot.id ?? index}
              title={<span style={{ color: routine ? C.ink : C.tertiary }}>{routine?.name ?? 'Deleted workout'}</span>}
              sub={detailFor(slot, routine?.slots.length ?? 0)}
              lead={
                // Position in the week, not a weekday.
                <span style={{ width: 24, flex: 'none', fontSize: 12, fontWeight: 800, color: isNext ? C.amberDark : C.tertiary, ...num }}>
                  {index + 1}
                </span>
              }
              right={
                <>
                  <Tag bg={tag.bg} fg={tag.fg}>
                    {tag.label}
                  </Tag>
                  {/* The column is kept even when empty so every tag lines up. */}
                  <span style={{ width: TOUCH, flex: 'none', display: 'flex' }}>
                    {editable && (
                      <Btn
                        onClick={() => setOpen(isOpen ? null : slot.id!)}
                        label={isOpen ? 'Close options' : `Options for ${routine?.name ?? 'this slot'}`}
                        style={{
                          width: TOUCH,
                          height: TOUCH,
                          borderRadius: R.chip,
                          border: `1px solid ${isOpen ? C.ink : C.lineStrong}`,
                          background: 'transparent',
                          color: C.ink60,
                          fontSize: 14,
                          fontWeight: 800,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {isOpen ? '✕' : '⋯'}
                      </Btn>
                    )}
                  </span>
                </>
              }
            >
              {isOpen && (
                <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 0 14px 34px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <SlotBtn onClick={() => void b.moveSession(slot.id!, index - 1)} disabled={index === 0}>
                      ↑ Earlier
                    </SlotBtn>
                    <SlotBtn onClick={() => void b.moveSession(slot.id!, index + 1)} disabled={index === slots.length - 1}>
                      ↓ Later
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
                  {b.routines.length > 1 && (
                    <Scroller style={{ gap: 6 }}>
                      {b.routines
                        .filter((r) => r.id !== slot.routineId)
                        .map((r) => (
                          <Btn
                            key={r.id}
                            onClick={() => {
                              void b.swapSlotRoutine(slot.id!, r.id);
                              setOpen(null);
                            }}
                            style={{
                              flex: 'none',
                              height: TOUCH,
                              padding: '0 12px',
                              borderRadius: R.small,
                              border: `1px solid ${C.lineStrong}`,
                              background: 'transparent',
                              color: C.ink60,
                              fontSize: 11.5,
                              fontWeight: 800,
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
        <span style={{ fontSize: 12, lineHeight: 1.5, color: C.tertiary, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
          Order is a suggestion, not a schedule — train these whenever the week suits you. Dropping one lowers what the week expects; it isn&apos;t a
          miss.
        </span>
      </Section>

      <AdjustmentLog />
    </>
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
  if (!b.plan) return <Note>No plan yet, so there is no week to add a workout to. Build a block on the Mesocycle tab.</Note>;
  if (!blockContaining(b.blocks, b.currentWeek)) {
    return <Note>No block covers this week, so there is nowhere to add a workout. Add a block on the Mesocycle tab.</Note>;
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
          borderRadius: R.chip,
          border: `1px dashed ${open ? C.ink : C.lineStrong}`,
          background: 'transparent',
          color: C.ink60,
          fontSize: 13,
          fontWeight: 800,
        }}
      >
        + Add a workout
      </Btn>

      {open && b.routines.length === 0 && (
        <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: C.tertiary }}>
            You have no workouts of your own yet. Build one, or copy a template, in the library.
          </span>
          {/* In a row so the button's flex: 1 fills the width. In a column,
              flex: 1 would act on its height instead. */}
          <div style={{ display: 'flex' }}>
            <SlotBtn onClick={() => b.patch({ library: true })}>Open the library</SlotBtn>
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
                  <span aria-hidden style={{ fontSize: 14, fontWeight: 800, color: isPicked ? C.ink : C.tertiary }}>
                    {isPicked ? '✕' : '+'}
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
                    <span style={{ fontSize: 12, lineHeight: 1.5, color: C.tertiary }}>
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
        borderRadius: R.chip,
        border: `1px solid ${danger ? C.redBd : C.lineStrong}`,
        background: danger ? C.redBg : C.card,
        color: danger ? C.redDark : C.ink80,
        fontSize: 12,
        fontWeight: 800,
      }}
    >
      {children}
    </Btn>
  );
}

function statusTag(slot: PlannedSession, isNext: boolean): { label: string; bg: string; fg: string } {
  if (slot.status === 'done') return { label: 'DONE', bg: C.greenBg, fg: C.greenDark };
  if (slot.status === 'skip') return { label: 'SKIPPED', bg: C.tagBg, fg: C.tertiary };
  // ADJ reads the flag that always meant it, rather than a status that
  // duplicated the flag.
  if (slot.adjustedByBompa) return { label: 'ADJ', bg: C.blueBg, fg: C.blueDark };
  if (isNext) return { label: 'NEXT', bg: C.amberBg, fg: C.amberDark };
  return { label: 'PLAN', bg: C.tagBg, fg: C.tertiary };
}

function detailFor(slot: PlannedSession, lifts: number): string {
  if (slot.status === 'done') return slot.date ? `Logged ${fmtDayMonth(slot.date)}` : 'Logged';
  if (slot.status === 'skip') return 'Week rolled over before this one happened';
  const pct = Math.round(slot.volumeFactor * 100);
  return `${lifts} lifts · ${pct}% volume${slot.adjustedByBompa ? ' · adjusted by Bompa' : ''}`;
}

function AdjustmentLog() {
  const b = useBompa();
  const live = b.adjustments.filter((a) => !a.revertedAt).slice(0, 6);

  return (
    <Section title="What Bompa changed">
      {live.length === 0 && <Note>Nothing live. The plan is exactly as you built it.</Note>}
      {live.map((adjustment) => (
        <div
          key={adjustment.id ?? adjustment.at}
          style={{ display: 'grid', gridTemplateColumns: '10px 1fr auto', gap: 10, alignItems: 'flex-start', padding: '12px 0', borderTop: `1px solid ${C.line}` }}
        >
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: C.amber, marginTop: 6 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 13.5, lineHeight: 1.45, color: C.ink80 }}>{adjustment.narrative}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.tertiary, ...num }}>{fmtDayMonth(dateKey(adjustment.at))}</span>
          </div>
          <Btn
            onClick={() => b.undoAdjustment(adjustment)}
            // Drawn as bare text, but sized so a thumb can hit it. The negative
            // margin keeps the text level with the first line of the narrative.
            style={{ height: TOUCH, minWidth: TOUCH, marginTop: -10, fontSize: 12.5, fontWeight: 800, color: C.amberDark }}
          >
            Undo
          </Btn>
        </div>
      ))}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────
// Mesocycle
// ─────────────────────────────────────────────────────────────

const BLOCK_TYPES: { id: Phase; label: string; sub: string }[] = [
  { id: 'hypertrophy', label: 'Hypertrophy', sub: 'High volume · RPE 7' },
  { id: 'strength', label: 'Strength', sub: '80–90% · RPE 8' },
  { id: 'power', label: 'Power', sub: 'Speed · RPE 7' },
  { id: 'peak', label: 'Peak', sub: 'Taper to test' },
];

/**
 * A phase's colour dark enough to read as small text on the light sheet. The
 * fills in `PH` are mid-tones and fall short as text there.
 */
const PH_TEXT: Record<Phase, string> = {
  hypertrophy: C.blueDark,
  strength: C.greenDark,
  power: C.amberDark,
  peak: C.redDark,
  deload: C.tertiary,
};

function MesocycleHero() {
  const b = useBompa();
  const phase = b.s.builderPhase;
  const type = BLOCK_TYPES.find((t) => t.id === phase) ?? BLOCK_TYPES[0]!;
  const weeks = b.s.builderWeeks;
  const starts = nextBlockStart(b.blocks, b.todayKey);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <HeroEyebrow>New block</HeroEyebrow>
      <HeroNumeral
        value={weeks}
        size={HERO_SIZE.screen}
        color={PH_ON_INK[phase]}
        label="weeks + deload"
        sub={`${type.label} · ${type.sub}`}
        ariaLabel={`New ${type.label.toLowerCase()} block, ${weeks} weeks plus a deload week. ${type.sub}.`}
      />
      <HeroText>
        {b.blocks.length > 0
          ? `Starts ${fmtDayMonth(starts)}, after the current plan ends. Nothing already scheduled moves.`
          : `Starts ${fmtDayMonth(starts)}.`}
      </HeroText>
    </div>
  );
}

function Mesocycle() {
  const b = useBompa();
  const curve = mesocycleCurve(b.s.builderPhase, b.s.builderWeeks);
  const colour = PH[b.s.builderPhase];

  return (
    <>
      <Section title="Block type">
        <div role="group" aria-label="Block type" style={{ display: 'flex', flexDirection: 'column' }}>
          {BLOCK_TYPES.map((type) => {
            const on = b.s.builderPhase === type.id;
            return (
              <Btn
                key={type.id}
                onClick={() => b.patch({ builderPhase: type.id })}
                pressed={on}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '12px 1fr auto',
                  gap: 12,
                  alignItems: 'center',
                  minHeight: TOUCH,
                  padding: '13px 0',
                  borderTop: `1px solid ${C.line}`,
                  textAlign: 'left',
                }}
              >
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: PH[type.id] }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>{type.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.tertiary, ...num }}>{type.sub}</span>
                </span>
                {/* A radio ring: filled ink with a screen-coloured inner ring when picked. */}
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    border: `2px solid ${on ? C.ink : C.lineStrong}`,
                    background: on ? C.ink : 'transparent',
                    boxShadow: on ? `inset 0 0 0 3px ${C.screen}` : 'none',
                  }}
                />
              </Btn>
            );
          })}
        </div>
      </Section>

      <Section title="Length">
        <div role="group" aria-label="Block length in weeks" style={{ display: 'flex', gap: 7, paddingTop: 2 }}>
          {[3, 4, 5, 6].map((weeks) => {
            const on = b.s.builderWeeks === weeks;
            return (
              <Btn
                key={weeks}
                onClick={() => b.patch({ builderWeeks: weeks })}
                pressed={on}
                style={{
                  flex: 1,
                  height: 48,
                  borderRadius: R.control,
                  fontSize: 15,
                  fontWeight: 800,
                  background: on ? C.ink : C.card,
                  border: `1px solid ${on ? C.ink : C.lineStrong}`,
                  color: on ? C.white : C.ink,
                  ...num,
                }}
              >
                {weeks}
              </Btn>
            );
          })}
        </div>
      </Section>

      <Section
        title="Generated curve"
        right={
          <span style={{ display: 'flex', gap: 10, fontSize: 11 }}>
            <span style={{ color: PH_TEXT[b.s.builderPhase] }}>■ volume</span>
            <span style={{ color: C.amberDark }}>■ intensity</span>
          </span>
        }
      >
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-end', height: 140, paddingTop: 4 }}>
          {curve.map((week) => (
            <div key={week.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: C.tertiary, ...num }}>{Math.round(week.intensity * 100)}%</span>
              <div style={{ width: '100%', display: 'flex', gap: 2, alignItems: 'flex-end', height: `${Math.round(week.volume * 100)}%` }}>
                <span style={{ flex: 1, height: '100%', borderRadius: '3px 3px 0 0', background: week.isDeload ? PH.deload : colour }} />
                <span style={{ flex: 1, height: `${Math.round(week.intensity * 100)}%`, borderRadius: '3px 3px 0 0', background: C.amber }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 800, color: C.tertiary, ...num }}>{week.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Btn onClick={b.addBlock} style={inkButton(56, R.block, 15)}>
        Add block to calendar
      </Btn>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Peak mode
// ─────────────────────────────────────────────────────────────

function PeakHero() {
  const b = useBompa();
  const meet = b.competition;

  if (!meet) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <HeroEyebrow color={C.redLight}>Competition</HeroEyebrow>
        <HeroText>Give me a date and I’ll work the whole build backwards from it.</HeroText>
      </div>
    );
  }

  // A meet in the past reads as zero rather than a negative count.
  const daysOut = Math.max(0, daysBetween(b.todayKey, meet.date));
  const line = [meet.name, fmtDayMonth(meet.date), meet.location].filter(Boolean).join(' · ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <HeroEyebrow color={C.redLight}>Competition</HeroEyebrow>
      <HeroNumeral
        value={daysOut}
        size={HERO_SIZE.screen}
        color={C.redLight}
        label={daysOut === 1 ? 'day out' : 'days out'}
        // The side column never wraps on its own; a long meet name has to, or
        // it pushes the whole screen sideways.
        sub={<span style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{line}</span>}
        ariaLabel={`${daysOut} ${daysOut === 1 ? 'day' : 'days'} until ${line}.`}
      />
      <HeroText>The whole build is worked backwards from this date.</HeroText>
    </div>
  );
}

function Peak() {
  const b = useBompa();
  const [name, setName] = useState(b.competition?.name ?? '');
  const [date, setDate] = useState(b.competition?.date ?? '');
  const [place, setPlace] = useState(b.competition?.location ?? '');

  return (
    <>
      <Section title="Meet">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label="Name" value={name} onChange={setName} placeholder="Autumn Open" />
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label="Date" value={date} onChange={setDate} type="date" />
            <Field label="Where" value={place} onChange={setPlace} placeholder="Bristol" />
          </div>
          <Btn onClick={() => name && date && b.saveCompetition(name, date, place)} disabled={!name || !date} style={inkButton(50, R.control, 14)}>
            {b.competition ? 'Update meet' : 'Set meet day'}
          </Btn>
        </div>
      </Section>

      {b.taper && (
        <Section title="Reverse taper">
          {b.taper.phases.length === 0 && <Note>{b.taper.warning}</Note>}
          {b.taper.phases.map((phase) => (
            <div
              key={phase.name}
              style={{ display: 'grid', gridTemplateColumns: '12px 1fr auto', gap: 12, alignItems: 'flex-start', padding: '12px 0', borderTop: `1px solid ${C.line}` }}
            >
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: PH[phase.phase], marginTop: 5 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 800 }}>{phase.name}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.tertiary, ...num }}>{phase.detail}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.ink80, textAlign: 'right', ...num }}>
                {fmtDayMonth(phase.startDate)}–{fmtDayMonth(phase.endDate)}
              </span>
            </div>
          ))}
          {b.taper.phases.length > 0 && b.taper.warning && <DotLine tone="amber">{b.taper.warning}</DotLine>}
          {b.taper.phases.length > 0 && <PeakAlignment />}
        </Section>
      )}
    </>
  );
}

/** Says whether the projected peak actually lands on meet day. */
function PeakAlignment() {
  const b = useBompa();
  if (!b.competition || !b.peakWindow) return null;

  const drift = daysBetween(b.peakWindow.endDate, b.competition.date);
  // Three days either side still puts the peak on the platform.
  const aligned = Math.abs(drift) <= 3;
  const range = `${fmtDayMonth(b.peakWindow.startDate)}–${fmtDayMonth(b.peakWindow.endDate)}`;

  return (
    <DotLine tone={aligned ? 'green' : 'amber'}>
      {aligned
        ? `Your peak window lands ${range}, right on meet day.`
        : `Your peak window lands ${range} — ${Math.abs(drift)} days ${drift > 0 ? 'early' : 'late'}. Stretch or shorten the strength block to move it onto meet day.`}
    </DotLine>
  );
}

/** A sentence led by a coloured dot: green when things line up, amber when they need a look. */
function DotLine({ tone, children }: { tone: 'green' | 'amber'; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 0 0', borderTop: `1px solid ${C.line}` }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: tone === 'green' ? C.green : C.amber, marginTop: 6, flex: 'none' }} />
      <span style={{ fontSize: 13.5, lineHeight: 1.45, fontWeight: 600, color: tone === 'green' ? C.greenDark : C.amberDark, ...num }}>{children}</span>
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
      <span style={{ fontSize: 11, fontWeight: 700, color: C.tertiary }}>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        style={{
          height: 48,
          borderRadius: R.chip,
          border: `1px solid ${C.lineStrong}`,
          background: C.card,
          padding: type === 'date' ? '0 11px' : '0 13px',
          fontSize: type === 'date' ? 14 : 15,
          fontWeight: 700,
          color: C.ink,
          fontFamily: 'inherit',
          width: '100%',
          minWidth: 0,
          ...num,
        }}
      />
    </label>
  );
}
