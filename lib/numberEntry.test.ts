import { describe, expect, it } from 'vitest';
import { REPS_MAX, parseEntry, roundTo, weightMax, weightPrecision } from './numberEntry';

const WIDE = { min: 0, max: 1000 };

describe('parseEntry', () => {
  it('reads a whole number and a decimal', () => {
    expect(parseEntry('120', WIDE)).toBe(120);
    expect(parseEntry('82.5', WIDE)).toBe(82.5);
  });

  it('reads a comma as a decimal point, as a European keypad types it', () => {
    expect(parseEntry('82,5', WIDE)).toBe(82.5);
  });

  it('ignores spaces around and inside the number', () => {
    expect(parseEntry('  80 ', WIDE)).toBe(80);
    expect(parseEntry('1 000', WIDE)).toBe(1000);
  });

  it('accepts a leading or trailing point', () => {
    expect(parseEntry('.5', WIDE)).toBe(0.5);
    expect(parseEntry('82.', WIDE)).toBe(82);
  });

  it('returns null for an empty box, so nothing is written', () => {
    expect(parseEntry('', WIDE)).toBeNull();
    expect(parseEntry('   ', WIDE)).toBeNull();
  });

  it('returns null for anything that is not a plain number', () => {
    for (const text of ['abc', '80kg', '8e2', '1.2.3', '.', ',', 'NaN', 'Infinity', '0x10', '82,5,0']) {
      expect(parseEntry(text, WIDE), text).toBeNull();
    }
  });

  it('rejects a negative number rather than flipping it or clamping it to zero', () => {
    expect(parseEntry('-5', WIDE)).toBeNull();
    expect(parseEntry('−5', WIDE)).toBeNull();
  });

  it('clamps to the bounds', () => {
    expect(parseEntry('0', { min: 1, max: 100 })).toBe(1);
    expect(parseEntry('250', { min: 1, max: 100 })).toBe(100);
  });

  it('rounds to the precision', () => {
    expect(parseEntry('82.4', { ...WIDE, precision: 0.25 })).toBe(82.5);
    expect(parseEntry('82.1', { ...WIDE, precision: 0.25 })).toBe(82);
    expect(parseEntry('7.6', { min: 1, max: 100, precision: 1 })).toBe(8);
  });

  it('keeps a bound that is off the rounding grid', () => {
    // A 2.5 minimum with whole-number rounding: 1 rounds to 1, then clamps up.
    expect(parseEntry('1', { min: 2.5, max: 100, precision: 1 })).toBe(2.5);
  });

  it('never rounds a tiny positive weight down to below the minimum', () => {
    expect(parseEntry('0.1', { min: 1, max: 100, precision: 1 })).toBe(1);
  });
});

describe('roundTo', () => {
  it('leaves no float noise behind', () => {
    expect(roundTo(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(roundTo(102.37, 0.25)).toBe(102.25);
  });
});

describe('weight rules', () => {
  it('keep a quarter kilo and half a pound', () => {
    expect(weightPrecision('kg')).toBe(0.25);
    expect(weightPrecision('lb')).toBe(0.5);
  });

  it('cap the same weight in either unit, near enough', () => {
    // 1000 kg is about 2205 lb, so the two caps describe the same bar.
    expect(Math.abs(weightMax('kg') * 2.2046 - weightMax('lb'))).toBeLessThan(10);
  });

  it('allow every rep count a real set has', () => {
    expect(REPS_MAX).toBeGreaterThanOrEqual(50);
  });
});
