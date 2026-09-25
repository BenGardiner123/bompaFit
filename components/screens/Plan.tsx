'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { dateKey, daysBetween, fmtDayMonth } from '@/lib/calc';
import { blockContaining, blockRotation, blocksUsing, mesocycleCurve } from '@/lib/plan';
import { weekIsUserModified } from '@/lib/schedule';
import { daysToMeet } from '@/lib/today';
import { C, HERO_SIZE, ON_PHASE, PH, PHASE_ABBR, PHASE_LABEL, PH_ON_INK, R, T, TOUCH, num, onInk } from '@/lib/tokens';
import type { Phase, PlannedSession, Routine } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { Btn, DarkSheet, Hero, HeroEyebrow, HeroNumeral, HeroText, InkButton, Row, Scroller, Section, Segmented, Sheet, Tag } from '@/components/ui';
import { macrocycle, nextBlockStart } from './PlanMacrocycle';
import { Icon } from '@/components/icons';

/**
 * One scrolling view: where you are in the macrocycle, this week, what I
 * changed, the meet, then the blocks. It used to be three tabs, and the meet
 * and the block builder each hid the other two thirds of the plan while you
 * were in them. Building a block and editing the meet are occasional jobs, so
 * they open as sheets over the plan rather than replacing it.
 */
export function Plan() {
  const [building, setBuilding] = useState(false);
  const [editingMeet, setEditingMeet] = useState(false);

  return (
    <div className="rise" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* The hero leads with a number rather than a title, so the screen's name
          is still announced for anyone navigating by heading. */}
      <h1 className="sr-only">Plan</h1>
      <Hero gap={12}>
        <MacrocycleHero />
      </Hero>
      <Sheet gap={20}>
        <ThisWeek />
        <AdjustmentLog />
        <Meet onEdit={() => setEditingMeet(true)} />
        <PlanBlocks />
        <Btn onClick={() => setBuilding(true)} style={inkButton(52, R.block, 15)}>
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
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

// ─────────────────────────────────────────────────────────────
// The macrocycle
// ─────────────────────────────────────────────────────────────

function MacrocycleHero() {
  const b = useBompa();
  const macro = macrocycle(b.blocks, b.todayKey);

  if (!macro) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <HeroEyebrow>Macrocycle</HeroEyebrow>
        <HeroText>No blocks yet. Add one below.</HeroText>
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
    sub = `${PHASE_LABEL[blockWeek.phase]} · week ${blockWeek.week} of ${blockWeek.of}`;
    subColor = PH_ON_INK[blockWeek.phase];
  }

  return (
    <>
      <HeroEyebrow>Plan · {totalWeeks}-week macrocycle</HeroEyebrow>
      <HeroNumeral
        value={week}
        size={HERO_SIZE.screen}
        // White: amber is kept for things you can tap.
        color={onInk.text}
        label={`of ${totalWeeks} weeks`}
        labelSize={T.lg}
        sub={sub}
        subColor={subColor}
        ariaLabel={`Week ${week} of ${totalWeeks}. ${sub}.`}
      />

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
                  borderRadius: `${first ? R.tag : 0}px ${last ? R.tag : 0}px ${last ? R.tag : 0}px ${first ? R.tag : 0}px`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: T.xs,
                  fontWeight: 800,
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

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: T.xs, fontWeight: 700, color: onInk.muted, ...num }}>
        <span>{fmtDayMonth(macro.start)}</span>
        {macro.todayAt !== null && <span style={{ color: onInk.text }}>today · {fmtDayMonth(b.todayKey)}</span>}
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
            compact
            title={<span style={{ color: routine ? C.ink : C.tertiary }}>{routine?.name ?? 'Deleted workout'}</span>}
            sub={detailFor(slot, routine)}
            lead={
              // Position in the week, not a weekday. Ink when next, so the
              // list agrees with the NEXT tag without borrowing amber for it.
              <span style={{ width: 18, flex: 'none', fontSize: T.sm, fontWeight: 800, color: isNext ? C.ink : C.tertiary, ...num }}>
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
                      onClick={() => {
                        setOpen(isOpen ? null : slot.id!);
                        setScope('week');
                      }}
                      label={isOpen ? 'Close options' : `Options for ${routine?.name ?? 'this slot'}`}
                      style={{
                        width: TOUCH,
                        height: TOUCH,
                        borderRadius: R.chip,
                        border: `1px solid ${isOpen ? C.ink : C.lineStrong}`,
                        background: 'transparent',
                        color: C.ink60,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon name={isOpen ? 'close' : 'more'} size={16} />
                    </Btn>
                  )}
                </span>
              </>
            }
          >
            {isOpen && (
              <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 0 14px 28px' }}>
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
                            padding: '0 12px',
                            borderRadius: R.small,
                            border: `1px solid ${C.lineStrong}`,
                            background: 'transparent',
                            color: C.ink60,
                            fontSize: T.xs,
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
      <span style={{ fontSize: T.caption, lineHeight: 1.5, color: C.tertiary, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
        Train these whenever the week suits you. Dropping one lowers what the week expects; it isn&apos;t a miss, and you can undo it.
      </span>
    </Section>
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
          borderRadius: R.chip,
          border: `1px dashed ${open ? C.ink : C.lineStrong}`,
          background: 'transparent',
          color: C.ink60,
          fontSize: T.note,
          fontWeight: 800,
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
        borderRadius: R.chip,
        border: `1px solid ${danger ? C.redBd : C.lineStrong}`,
        background: danger ? C.redBg : C.card,
        color: danger ? C.redDark : C.ink80,
        fontSize: T.caption,
        fontWeight: 800,
      }}
    >
      {children}
    </Btn>
  );
}

/**
 * The tag at the end of a slot's row. Status colours only for state: green
 * for done. NEXT is ink rather than amber, because amber means something to
 * tap, and ADJUSTED is neutral rather than blue, because blue was a fourth
 * colour for the eye to learn with nothing to act on.
 */
function statusTag(slot: PlannedSession, isNext: boolean): { label: string; bg: string; fg: string } {
  if (slot.status === 'done') return { label: 'DONE', bg: C.greenBg, fg: C.greenDark };
  if (slot.status === 'skip') return { label: 'SKIPPED', bg: C.tagBg, fg: C.tertiary };
  if (isNext) return { label: 'NEXT', bg: C.ink, fg: C.white };
  // ADJUSTED reads the flag that always meant it, rather than a status that
  // duplicated the flag.
  if (slot.adjustedByBompa) return { label: 'ADJUSTED', bg: C.tagBg, fg: C.ink80 };
  return { label: 'PLANNED', bg: C.tagBg, fg: C.ink60 };
}

/** The line under a slot's name. When I changed it, it says what and says it was me. */
function detailFor(slot: PlannedSession, routine: Routine | undefined): string {
  if (slot.status === 'done') return slot.date ? `Logged ${fmtDayMonth(slot.date)}` : 'Logged';
  if (slot.status === 'skip') return 'Week rolled over before this one happened';
  const count = routine?.slots.length ?? 0;
  const lifts = `${count} ${count === 1 ? 'lift' : 'lifts'}`;
  const pct = Math.round(slot.volumeFactor * 100);
  if (slot.adjustedByBompa) {
    const verb = pct < 100 ? 'I trimmed it' : pct > 100 ? 'I added to it' : 'I changed it';
    return `${lifts} · ${pct}% volume, ${verb}`;
  }
  if (pct !== 100) return `${lifts} · ${pct}% volume`;
  return routine ? `${lifts} · ~${routine.estMinutes} min` : lifts;
}

// ─────────────────────────────────────────────────────────────
// What I changed
// ─────────────────────────────────────────────────────────────

function AdjustmentLog() {
  const b = useBompa();
  const live = b.adjustments.filter((a) => !a.revertedAt).slice(0, 6);

  return (
    <Section title="What I changed">
      {live.length === 0 && <Note>Nothing live. The plan is exactly as you built it.</Note>}
      {live.map((adjustment) => (
        <div
          key={adjustment.id ?? adjustment.at}
          style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: `1px solid ${C.line}` }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: T.copy, lineHeight: 1.4, color: C.ink80 }}>
              {adjustment.narrative} <span style={{ color: C.tertiary, ...num }}>· {fmtDayMonth(dateKey(adjustment.at))}</span>
            </span>
          </div>
          <Btn
            onClick={() => b.undoAdjustment(adjustment)}
            // Drawn as bare text, but sized so a thumb can hit it.
            style={{ flex: 'none', height: TOUCH, minWidth: TOUCH, fontSize: T.sm, fontWeight: 800, color: C.amberDark }}
          >
            Undo
          </Btn>
        </div>
      ))}
    </Section>
  );
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

  return (
    <Section title="Meet">
      <Row
        title={meet && days !== null ? `${meet.name} · ${days} ${days === 1 ? 'day' : 'days'}` : 'No meet set'}
        sub={sub}
        right={
          <Btn
            onClick={onEdit}
            label={meet ? 'Edit meet' : 'Set a meet'}
            style={{
              flex: 'none',
              height: TOUCH,
              padding: '0 14px',
              borderRadius: R.chip,
              border: `1px solid ${C.lineStrong}`,
              color: C.ink,
              fontSize: T.sm,
              fontWeight: 800,
            }}
          >
            {meet ? 'Edit' : 'Set'}
          </Btn>
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
                <span style={{ fontSize: T.title, fontWeight: 800 }}>{phase.name}</span>
                <span style={{ fontSize: T.caption, fontWeight: 600, color: onInk.muted, ...num }}>{phase.detail}</span>
              </div>
              <span style={{ fontSize: T.caption, fontWeight: 800, color: onInk.body, textAlign: 'right', ...num }}>
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

/** Every block in the plan and the workouts it cycles through, so a block with its own versions says so. */
function PlanBlocks() {
  const b = useBompa();
  if (b.blocks.length === 0) return null;
  const blocks = [...b.blocks].sort((x, y) => (x.startDate < y.startDate ? -1 : 1));

  return (
    <Section title="Blocks in your plan">
      <div role="list" aria-label="Blocks in your plan" style={{ display: 'flex', flexDirection: 'column' }}>
        {blocks.map((block) => {
          const names = blockRotation(block, b.plan).map((id) => b.routineById(id)?.name ?? 'Deleted workout');
          return (
            <div
              key={block.id ?? block.startDate}
              role="listitem"
              style={{ display: 'grid', gridTemplateColumns: '12px 1fr auto', gap: 12, alignItems: 'flex-start', padding: '12px 0', borderTop: `1px solid ${C.line}` }}
            >
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: R.swatch, background: PH[block.phase], marginTop: 5 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: T.title, fontWeight: 800 }}>{PHASE_LABEL[block.phase]} block</span>
                <span style={{ fontSize: T.caption, fontWeight: 600, color: C.tertiary }}>
                  {block.rotation ? 'Its own workouts: ' : ''}
                  {names.join(', ')}
                </span>
              </div>
              <span style={{ fontSize: T.caption, fontWeight: 800, color: C.ink80, ...num }}>{fmtDayMonth(block.startDate)}</span>
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
        <span style={{ display: 'block', fontWeight: 800, color: onInk.text }}>
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
                  <span style={{ fontSize: T.title, fontWeight: 800, color: onInk.text }}>{option.label}</span>
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
                  borderRadius: R.control,
                  fontSize: T.title,
                  fontWeight: 800,
                  background: on ? C.white : 'transparent',
                  border: `1px solid ${on ? C.white : onInk.control}`,
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
              <span style={{ fontSize: T.xs, fontWeight: 800, color: onInk.muted, ...num }}>{Math.round(week.intensity * 100)}%</span>
              <div style={{ width: '100%', display: 'flex', gap: 2, alignItems: 'flex-end', height: `${Math.round(week.volume * 100)}%` }}>
                <span style={{ flex: 1, height: '100%', borderRadius: `${R.swatch}px ${R.swatch}px 0 0`, background: week.isDeload ? PH.deload : PH[phase] }} />
                {/* Light grey, not amber: amber is kept for things you can tap. */}
                <span style={{ flex: 1, height: `${Math.round(week.intensity * 100)}%`, borderRadius: `${R.swatch}px ${R.swatch}px 0 0`, background: onInk.body }} />
              </div>
              <span style={{ fontSize: T.xs, fontWeight: 800, color: onInk.muted, ...num }}>{week.label}</span>
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
              <span style={{ width: 24, flex: 'none', fontSize: T.caption, fontWeight: 800, color: onInk.muted, ...num }}>{on ? at + 1 : ''}</span>
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
                    borderRadius: R.chip,
                    border: `1px solid ${on ? C.white : onInk.control}`,
                    background: on ? C.white : 'transparent',
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
        borderRadius: R.chip,
        border: `1px solid ${onInk.control}`,
        background: 'transparent',
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
