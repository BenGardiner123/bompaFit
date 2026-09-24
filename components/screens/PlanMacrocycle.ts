// The arithmetic behind the Plan calendar's hero: where today sits in the
// whole run of blocks, and what the macrocycle bar should draw. Kept apart
// from the component so it can be checked against plain dates without a DOM.

import { addDays, daysBetween } from '@/lib/calc';
import type { Block, Phase } from '@/lib/types';

/** One coloured stretch of the macrocycle bar: a block's working weeks, or its deload. */
export type MacroSegment = {
  key: string;
  phase: Phase;
  weeks: number;
  /** Every week of it is behind us, so the bar marks it with a ✓. */
  done: boolean;
};

/** Where today falls inside the block it belongs to. */
export type BlockWeek = {
  /** The block's own phase, even during its deload, so the label can say which block is resting. */
  phase: Phase;
  /** 1-based week within the block. */
  week: number;
  /** Working weeks in the block, not counting deload. */
  of: number;
  deload: boolean;
};

export type Macrocycle = {
  segments: MacroSegment[];
  totalWeeks: number;
  start: string;
  /** The last day of the last block. */
  end: string;
  /**
   * 1-based week of the whole plan. Below 1 before the plan starts and above
   * `totalWeeks` once it has finished; the caller decides what to say then.
   */
  week: number;
  /** How far along the bar today is, 0–1, or null when today is outside the plan. */
  todayAt: number | null;
  blockWeek: BlockWeek | null;
};

export function macrocycle(blocks: Block[], todayKey: string): Macrocycle | null {
  const ordered = [...blocks].sort((a, x) => (a.startDate < x.startDate ? -1 : 1));
  const first = ordered[0];
  if (!first) return null;

  const totalWeeks = ordered.reduce((sum, block) => sum + block.weeks + block.deloadWeeks, 0);
  const start = first.startDate;
  const end = addDays(start, totalWeeks * 7 - 1);
  const dayInPlan = daysBetween(start, todayKey);

  const segments: MacroSegment[] = [];
  let blockWeek: BlockWeek | null = null;

  for (const block of ordered) {
    // Date keys are ISO, so plain string comparison orders them correctly.
    // A stretch is done once the day after its last day has arrived.
    const workEnds = addDays(block.startDate, block.weeks * 7);
    const blockEnds = addDays(workEnds, block.deloadWeeks * 7);
    segments.push({ key: `${block.id ?? block.startDate}-work`, phase: block.phase, weeks: block.weeks, done: workEnds <= todayKey });
    if (block.deloadWeeks > 0) {
      segments.push({ key: `${block.id ?? block.startDate}-deload`, phase: 'deload', weeks: block.deloadWeeks, done: blockEnds <= todayKey });
    }

    if (block.startDate <= todayKey && todayKey < blockEnds) {
      const weekIn = Math.floor(daysBetween(block.startDate, todayKey) / 7) + 1;
      blockWeek = { phase: block.phase, week: weekIn, of: block.weeks, deload: weekIn > block.weeks };
    }
  }

  const inside = dayInPlan >= 0 && dayInPlan < totalWeeks * 7;
  return {
    segments,
    totalWeeks,
    start,
    end,
    week: Math.floor(dayInPlan / 7) + 1,
    // Half a day on, so the marker sits in the middle of today rather than at midnight.
    todayAt: inside ? (dayInPlan + 0.5) / (totalWeeks * 7) : null,
    blockWeek,
  };
}

/** Where the next block would start: the day after the last one ends, or today with nothing planned. */
export function nextBlockStart(blocks: Block[], todayKey: string): string {
  const last = [...blocks].sort((a, x) => (a.startDate < x.startDate ? -1 : 1)).pop();
  return last ? addDays(last.startDate, (last.weeks + last.deloadWeeks) * 7) : todayKey;
}
