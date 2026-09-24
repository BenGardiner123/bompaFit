import { describe, expect, it } from 'vitest';
import { CueSchedule, POLL_MS, intervalDeadline, nextBoundary, restNotificationBody, type Cue } from './alerts';

/** Look every POLL_MS from `from` to `to`, following `deadline`, and record what played when. */
function run(schedule: CueSchedule, deadline: (now: number) => number | null, from: number, to: number, ticks?: number[]) {
  const heard: { at: number; cue: Cue }[] = [];
  for (let now = from; now <= to; now += POLL_MS) {
    const cue = schedule.step(deadline(now), now, ticks);
    if (cue) heard.push({ at: now, cue });
  }
  return heard;
}

describe('CueSchedule', () => {
  it('plays 3, 2, 1 and the end tone once each, on the beat', () => {
    const schedule = new CueSchedule();
    const heard = run(schedule, () => 60_000, 0, 70_000);
    expect(heard).toEqual([
      { at: 57_000, cue: 'tick' },
      { at: 58_000, cue: 'tick' },
      { at: 59_000, cue: 'tick' },
      { at: 60_000, cue: 'zero' },
    ]);
  });

  it('plays only the end tone when asked for no countdown', () => {
    const heard = run(new CueSchedule(), () => 10_000, 0, 12_000, []);
    expect(heard).toEqual([{ at: 10_000, cue: 'zero' }]);
  });

  it('never plays anything twice when the page looks many times a second', () => {
    const schedule = new CueSchedule();
    const heard: Cue[] = [];
    for (let now = 0; now <= 12_000; now += 7) {
      const cue = schedule.step(10_000, now);
      if (cue) heard.push(cue);
    }
    expect(heard).toEqual(['tick', 'tick', 'tick', 'zero']);
  });

  it('plays only the latest cue when one look finds several behind it', () => {
    const schedule = new CueSchedule();
    expect(schedule.step(10_000, 0)).toBeNull();
    // Throttled: the next look is 1.5 s after "3" was due, so "3" is dropped
    // and only "2" plays.
    expect(schedule.step(10_000, 8_500)).toBe('tick');
    expect(schedule.step(10_000, 8_700)).toBeNull();
    expect(schedule.step(10_000, 9_000)).toBe('tick');
  });

  it('skips stale ticks on a late wake-up but still plays a recent end tone', () => {
    const schedule = new CueSchedule();
    schedule.step(60_000, 0);
    expect(schedule.step(60_000, 62_000)).toBe('zero');
    expect(schedule.step(60_000, 62_200)).toBeNull();
  });

  it('plays nothing when the page wakes long after the end', () => {
    const schedule = new CueSchedule();
    schedule.step(60_000, 0);
    expect(schedule.step(60_000, 90_000)).toBeNull();
    expect(schedule.step(null, 90_200)).toBeNull();
  });

  it('plays nothing for a rest that was skipped', () => {
    const schedule = new CueSchedule();
    const heard = run(schedule, (now) => (now < 30_000 ? 60_000 : null), 0, 70_000);
    expect(heard).toEqual([]);
  });

  it('plays nothing more once skipped mid-countdown', () => {
    const schedule = new CueSchedule();
    const heard = run(schedule, (now) => (now < 58_500 ? 60_000 : null), 0, 70_000);
    expect(heard.map((h) => h.at)).toEqual([57_000, 58_000]);
  });

  it('still plays the end tone when the deadline is cleared right as it runs out', () => {
    // The context clears an expired rest on its own one-second tick, which can
    // land before this schedule's own look. The end was reached, so it is owed.
    const schedule = new CueSchedule();
    schedule.step(60_000, 59_900);
    expect(schedule.step(null, 60_400)).toBe('zero');
  });

  it('re-arms the whole countdown when +30 lands late in the rest', () => {
    const schedule = new CueSchedule();
    const heard = run(schedule, (now) => (now < 58_500 ? 60_000 : 90_000), 0, 95_000);
    expect(heard).toEqual([
      { at: 57_000, cue: 'tick' },
      { at: 58_000, cue: 'tick' },
      { at: 87_000, cue: 'tick' },
      { at: 88_000, cue: 'tick' },
      { at: 89_000, cue: 'tick' },
      { at: 90_000, cue: 'zero' },
    ]);
  });

  it('does not replay a tick that a −30 has already put behind the rest', () => {
    const schedule = new CueSchedule();
    schedule.step(60_000, 0);
    // −30 at 31 s left, floored to one second remaining.
    expect(schedule.step(1_000 + 29_000 + 1_000, 29_000)).toBeNull();
    const heard = run(schedule, () => 31_000, 29_200, 32_000);
    expect(heard).toEqual([
      { at: 30_000, cue: 'tick' },
      { at: 31_000, cue: 'zero' },
    ]);
  });

  it('arms nothing for a deadline already in the past', () => {
    const schedule = new CueSchedule();
    expect(schedule.step(1_000, 5_000)).toBeNull();
    expect(schedule.step(1_000, 5_200)).toBeNull();
  });
});

describe('EMOM and AMRAP deadlines', () => {
  it('finds the next boundary strictly after now', () => {
    expect(nextBoundary(0, 60_000, 0)).toBe(60_000);
    expect(nextBoundary(0, 60_000, 59_999)).toBe(60_000);
    expect(nextBoundary(0, 60_000, 60_000)).toBe(120_000);
    expect(nextBoundary(1_000, 60_000, 61_500)).toBe(121_000);
  });

  it('plays the countdown and the end tone at every interval boundary', () => {
    const clock = { mode: 'emom' as const, startedAt: 0, accumulatedMs: 0, capMs: 0, intervalMs: 60_000 };
    const heard = run(new CueSchedule(), (now) => intervalDeadline(clock, now), 0, 185_000);
    const zeros = heard.filter((h) => h.cue === 'zero').map((h) => h.at);
    expect(zeros).toEqual([60_000, 120_000, 180_000]);
    expect(heard.filter((h) => h.cue === 'tick')).toHaveLength(9);
  });

  it('counts an EMOM from where a pause left it', () => {
    // 20 s banked, resumed at t = 100 s: the minute turns over at 140 s.
    const clock = { mode: 'emom' as const, startedAt: 100_000, accumulatedMs: 20_000, capMs: 0, intervalMs: 60_000 };
    expect(intervalDeadline(clock, 100_000)).toBe(140_000);
  });

  it('ends an AMRAP at its cap, once', () => {
    const clock = { mode: 'amrap' as const, startedAt: 0, accumulatedMs: 0, capMs: 480_000, intervalMs: 60_000 };
    const heard = run(new CueSchedule(), (now) => intervalDeadline(clock, now), 0, 500_000);
    expect(heard.filter((h) => h.cue === 'zero')).toEqual([{ at: 480_000, cue: 'zero' }]);
  });

  it('gives a stopwatch, and anything paused, no deadline', () => {
    expect(intervalDeadline({ mode: 'stopwatch', startedAt: 0, accumulatedMs: 0, capMs: 0, intervalMs: 60_000 }, 5)).toBeNull();
    expect(intervalDeadline({ mode: 'amrap', startedAt: null, accumulatedMs: 9, capMs: 60_000, intervalMs: 0 }, 5)).toBeNull();
  });
});

describe('restNotificationBody', () => {
  it('names the lift and the set that comes next', () => {
    expect(restNotificationBody('Bench Press', 3)).toBe("Rest's up · Bench Press, set 3");
    expect(restNotificationBody('Bench Press', null)).toBe("Rest's up · Bench Press");
    expect(restNotificationBody(null, 3)).toBe("Rest's up");
  });
});
