import { describe, expect, it } from 'vitest';
import type { Block } from '@/lib/types';
import { macrocycle, nextBlockStart } from './PlanMacrocycle';

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
