import { describe, expect, it } from 'vitest';
import { C, onInk } from './tokens';
import {
  READY_LABEL,
  curveGeometry,
  historyPhrase,
  readinessBand,
  readinessTrend,
  readySentence,
  trendColour,
  trendPhrase,
  trendWords,
} from './today';

const DAY = 86_400_000;

describe('readinessBand', () => {
  it('splits at 75 and 45', () => {
    expect(readinessBand(100)).toBe('primed');
    expect(readinessBand(75)).toBe('primed');
    expect(readinessBand(74)).toBe('steady');
    expect(readinessBand(45)).toBe('steady');
    expect(readinessBand(44)).toBe('buried');
    expect(readinessBand(0)).toBe('buried');
  });

  it('labels each band with its arrow', () => {
    expect(READY_LABEL[readinessBand(80)]).toBe('↑ Primed');
    expect(READY_LABEL[readinessBand(50)]).toBe('→ Steady');
    expect(READY_LABEL[readinessBand(10)]).toBe('↓ Buried');
  });
});

describe('readySentence', () => {
  it('tells a buried lifter with very high fatigue to back off', () => {
    expect(readySentence(20, 85)).toMatch(/Back the volume off/);
  });

  it('is gentler when buried but fatigue is not extreme', () => {
    expect(readySentence(20, 60)).toMatch(/Keep it honest/);
  });

  it('ignores fatigue while readiness is high', () => {
    expect(readySentence(90, 95)).toBe(readySentence(90, 0));
  });
});

describe('historyPhrase', () => {
  it('never shows a zero or negative count of days', () => {
    expect(historyPhrase(-1)).toBe('under a day of history');
    expect(historyPhrase(0)).toBe('under a day of history');
  });

  it('counts whole days after that', () => {
    expect(historyPhrase(1)).toBe('1 day of history');
    expect(historyPhrase(9)).toBe('9 days of history');
  });
});

describe('curveGeometry', () => {
  const history = [
    { at: 0, fitness: 0, fatigue: 10 },
    { at: DAY, fitness: 5, fatigue: 20 },
    { at: 2 * DAY, fitness: 10, fatigue: 5 },
  ];

  it('draws nothing from fewer than two points', () => {
    expect(curveGeometry(history.slice(0, 1), null, 300, 70)).toEqual({ fitness: '', fatigue: '', peakX: null });
  });

  it('spans the full width when there is no peak', () => {
    const g = curveGeometry(history, null, 300, 70);
    const xs = g.fitness.split(' ').map((pair) => Number(pair.split(',')[0]));
    expect(xs).toEqual([0, 150, 300]);
    expect(g.peakX).toBeNull();
  });

  it('puts the highest value at the top and zero at the bottom, inside the box', () => {
    const g = curveGeometry(history, null, 300, 70);
    const fatigueYs = g.fatigue.split(' ').map((pair) => Number(pair.split(',')[1]));
    const fitnessYs = g.fitness.split(' ').map((pair) => Number(pair.split(',')[1]));
    // Fatigue 20 is the maximum of both series.
    expect(Math.min(...fatigueYs)).toBe(2);
    expect(fitnessYs[0]).toBe(68);
  });

  it('stretches the axis forward to a future peak and stops the lines at today', () => {
    // Two days of history, peak two days away: today lands halfway across.
    const g = curveGeometry(history, 2, 300, 70);
    const xs = g.fitness.split(' ').map((pair) => Number(pair.split(',')[0]));
    expect(xs[xs.length - 1]).toBe(150);
    expect(g.peakX).toBe(300);
  });

  it('draws a peak that is today at the right edge', () => {
    expect(curveGeometry(history, 0, 300, 70).peakX).toBe(300);
  });
});

describe('readinessTrend', () => {
  const T0 = Date.UTC(2026, 8, 1, 18);
  const HOUR = 3_600_000;
  const load = (at: number, amount = 100) => ({ at, dateKey: 'unused', load: amount });

  // Worked by hand. One load of 100 at T0, read one day later, just as the
  // second session starts:
  //   fitness  = 100·e^(−1/42) = 97.65
  //   fatigue  = 100·e^(−1/7)  = 86.69
  //   form     = 97.65 − 2 × 86.69 = −75.73
  // Across the window the lowest form is at T0 itself (100 − 200 = −100) and
  // the highest is 0, before anything was logged. So readiness then was
  // (−75.73 + 100) / 100 = 24.
  const twoSessions = [
    { startedAt: T0 - HOUR, finishedAt: T0 },
    { startedAt: T0 + DAY, finishedAt: T0 + DAY + HOUR },
  ];

  it('is readiness now minus readiness just before the last session started', () => {
    // The second session's own load is stamped at its last set, after it began,
    // and must not count toward the "before" figure.
    const loads = [load(T0), load(T0 + DAY + HOUR)];
    expect(readinessTrend(loads, twoSessions, 60)).toBe(36);
    expect(readinessTrend(loads, twoSessions, 10)).toBe(-14);
    expect(readinessTrend(loads, twoSessions, 24)).toBe(0);
  });

  it('has nothing to say with no finished session', () => {
    expect(readinessTrend([], [], 50)).toBeNull();
    expect(readinessTrend([load(T0)], [{ startedAt: T0 - HOUR }], 50)).toBeNull();
  });

  it('has nothing to say after a single session, because before it there was no history', () => {
    expect(readinessTrend([load(T0)], [twoSessions[0]!], 50)).toBeNull();
  });

  it('ignores a session still in progress and compares against the last finished one', () => {
    const open = { startedAt: T0 + 2 * DAY };
    const loads = [load(T0), load(T0 + DAY + HOUR)];
    expect(readinessTrend(loads, [...twoSessions, open], 60)).toBe(36);
  });

  it('never counts a load stamped at the very moment the reference session began', () => {
    // A session with no last-set time is stamped at its start instead.
    const sessions = [{ startedAt: T0, finishedAt: T0 + HOUR }];
    expect(readinessTrend([load(T0)], sessions, 50)).toBeNull();
  });
});

describe('trend wording', () => {
  it('says level at zero, and an arrow with the size of the change otherwise', () => {
    expect(trendPhrase(0)).toBe('level with last session');
    expect(trendPhrase(7)).toBe('↑ 7 since last session');
    expect(trendPhrase(-12)).toBe('↓ 12 since last session');
  });

  it('spells the direction out for a screen reader', () => {
    expect(trendWords(0)).toBe('Level with last session.');
    expect(trendWords(7)).toBe('Up 7 since last session.');
    expect(trendWords(-12)).toBe('Down 12 since last session.');
  });

  it('is green when fresher and never red when lower', () => {
    expect(trendColour(5)).toBe(C.greenLight);
    expect(trendColour(0)).toBe(onInk.body);
    expect(trendColour(-5)).toBe(onInk.body);
    expect(trendColour(-40)).not.toBe(C.redLight);
  });

  // The same WCAG sums as the token tests: every colour the line can take has
  // to read as small text on the ink hero.
  it.each([5, 0, -5])('reads as text on ink at a delta of %i', (delta) => {
    expect(contrast(trendColour(delta), C.ink)).toBeGreaterThanOrEqual(4.5);
  });
});

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}
