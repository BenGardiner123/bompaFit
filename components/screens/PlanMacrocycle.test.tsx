import { describe, expect, it } from 'vitest';
import type { Block } from '@/lib/types';
import { browsableWeeks, macrocycle, nextBlockStart, weekAt, weekPosition } from './PlanMacrocycle';

// A 5 + 1 hypertrophy block, a 5 + 1 strength block and a 4-week peak with no
// deload: sixteen weeks from Monday 27 July.
const BLOCKS: Block[] = [
  // Deliberately out of order: the bar must follow the calendar, not the array.
  { id: 2, planId: 1, phase: 'strength', weeks: 5, deloadWeeks: 1, startDate: '2026-09-07' },
  { id: 1, planId: 1, phase: 'hypertrophy', weeks: 5, deloadWeeks: 1, startDate: '2026-07-27' },
  { id: 3, planId: 1, phase: 'peak', weeks: 4, deloadWeeks: 0, startDate: '2026-10-19' },
];

describe('macrocycle', () => {
  it('is null with nothing planned', () => {
    expect(macrocycle([], '2026-09-24')).toBeNull();
  });

  it('lays the blocks out in date order, with a deload stretch only where there is one', () => {
    const macro = macrocycle(BLOCKS, '2026-09-24')!;
    expect(macro.totalWeeks).toBe(16);
    expect(macro.start).toBe('2026-07-27');
    expect(macro.end).toBe('2026-11-15');
    expect(macro.segments.map((s) => [s.phase, s.weeks])).toEqual([
      ['hypertrophy', 5],
      ['deload', 1],
      ['strength', 5],
      ['deload', 1],
      ['peak', 4],
    ]);
  });

  it('marks only the stretches that are fully behind us as done', () => {
    const macro = macrocycle(BLOCKS, '2026-09-24')!;
    expect(macro.segments.map((s) => s.done)).toEqual([true, true, false, false, false]);
  });

  it('counts the week of the plan and the week of the current block', () => {
    const macro = macrocycle(BLOCKS, '2026-09-24')!;
    // 59 days in: week 9 of 16, and the third week of strength.
    expect(macro.week).toBe(9);
    expect(macro.blockWeek).toEqual({ phase: 'strength', week: 3, of: 5, deload: false });
    expect(macro.todayAt).toBeGreaterThan(0.5);
    expect(macro.todayAt).toBeLessThan(0.6);
  });

  it('says when this week is a block’s deload', () => {
    const macro = macrocycle(BLOCKS, '2026-09-02')!;
    expect(macro.blockWeek).toEqual({ phase: 'hypertrophy', week: 6, of: 5, deload: true });
  });

  it('puts no marker on the bar outside the plan', () => {
    const early = macrocycle(BLOCKS, '2026-07-20')!;
    expect(early.week).toBeLessThan(1);
    expect(early.todayAt).toBeNull();
    expect(early.blockWeek).toBeNull();

    const late = macrocycle(BLOCKS, '2026-11-16')!;
    expect(late.week).toBeGreaterThan(16);
    expect(late.todayAt).toBeNull();
    expect(late.segments.every((s) => s.done)).toBe(true);
  });

  it('keeps whole weeks across the October clock change', () => {
    // Local midnights would lose an hour on 25 October and land a day short.
    const macro = macrocycle(BLOCKS, '2026-10-26')!;
    expect(macro.blockWeek).toEqual({ phase: 'peak', week: 2, of: 4, deload: false });
  });
});

describe('nextBlockStart', () => {
  it('is the day after the last block ends', () => {
    expect(nextBlockStart(BLOCKS, '2026-09-24')).toBe('2026-11-16');
  });

  it('is today with nothing planned', () => {
    expect(nextBlockStart([], '2026-09-24')).toBe('2026-09-24');
  });
});

describe('weekPosition', () => {
  it('names the block and the week of it, deload included', () => {
    expect(weekPosition(BLOCKS, '2026-07-27')).toEqual({ phase: 'hypertrophy', week: 1, of: 5, deload: false });
    // The sixth week of a 5 + 1 block is its deload, still named for the block it rests.
    expect(weekPosition(BLOCKS, '2026-08-31')).toEqual({ phase: 'hypertrophy', week: 6, of: 5, deload: true });
    expect(weekPosition(BLOCKS, '2026-11-09')).toEqual({ phase: 'peak', week: 4, of: 4, deload: false });
  });

  it('is null before the plan starts and after it ends', () => {
    expect(weekPosition(BLOCKS, '2026-07-20')).toBeNull();
    expect(weekPosition(BLOCKS, '2026-11-16')).toBeNull();
  });
});

describe('weekAt', () => {
  const macro = macrocycle(BLOCKS, '2026-09-24')!;

  it('turns a point along the bar into the Monday of the week drawn there', () => {
    expect(weekAt(macro, 0)).toBe('2026-07-27');
    // Just past halfway through sixteen weeks is the ninth week.
    expect(weekAt(macro, 0.51)).toBe('2026-09-21');
    expect(weekAt(macro, 0.999)).toBe('2026-11-09');
  });

  it('lands on the first or last week for a tap at or past either end', () => {
    expect(weekAt(macro, -0.2)).toBe('2026-07-27');
    expect(weekAt(macro, 1)).toBe('2026-11-09');
    expect(weekAt(macro, 1.3)).toBe('2026-11-09');
  });
});

describe('browsableWeeks', () => {
  const macro = macrocycle(BLOCKS, '2026-09-24')!;

  it('runs from the first week of the plan to the last', () => {
    expect(browsableWeeks(macro, '2026-09-21')).toEqual({ first: '2026-07-27', last: '2026-11-09' });
  });

  it('stretches to take in this week when today is outside the plan', () => {
    expect(browsableWeeks(macro, '2026-12-07')).toEqual({ first: '2026-07-27', last: '2026-12-07' });
    expect(browsableWeeks(macro, '2026-07-06')).toEqual({ first: '2026-07-06', last: '2026-11-09' });
  });

  it('is only this week with no plan', () => {
    expect(browsableWeeks(null, '2026-09-21')).toEqual({ first: '2026-09-21', last: '2026-09-21' });
  });
});
