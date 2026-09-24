import { describe, expect, it } from 'vitest';
import { isBodyweightLift, weightShort, weightSpoken, weightText } from './bodyweight';

describe('isBodyweightLift', () => {
  it('knows a lift from the library done with no load', () => {
    expect(isBodyweightLift({ equipment: 'Bodyweight' })).toBe(true);
    expect(isBodyweightLift({ equipment: 'Barbell' })).toBe(false);
    expect(isBodyweightLift(undefined)).toBe(false);
  });
});

describe('weightText', () => {
  it('says Bodyweight at zero, whatever the lift', () => {
    expect(weightText(0, 'kg')).toBe('Bodyweight');
    expect(weightText(0, 'lb', true)).toBe('Bodyweight');
  });

  it('puts added weight on top of bodyweight', () => {
    expect(weightText(10, 'kg', true)).toBe('BW + 10 kg');
    expect(weightText(2.5, 'lb', true)).toBe('BW + 2.5 lb');
  });

  it('is a plain weight on a loaded lift', () => {
    expect(weightText(80, 'kg')).toBe('80 kg');
  });
});

describe('weightShort', () => {
  it('fits a crowded line', () => {
    expect(weightShort(0, 'kg')).toBe('BW');
    expect(weightShort(10, 'kg', true)).toBe('+10 kg');
    expect(weightShort(80, 'lb')).toBe('80 lb');
  });
});

describe('weightSpoken', () => {
  it('never reads zero as a weight', () => {
    expect(weightSpoken(0, 'kg')).toBe('Bodyweight');
  });

  it('spells out the unit', () => {
    expect(weightSpoken(10, 'kg', true)).toBe('Bodyweight plus 10 kilograms');
    expect(weightSpoken(135, 'lb')).toBe('135 pounds');
  });
});
