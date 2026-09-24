import { describe, expect, it } from 'vitest';
import type { LoggedSet } from './types';
import { countsForDrift, countsForProgression, countsForRecords, METHOD_GUIDE_KEYS, type MethodGuideKey } from './methods';
import { GUIDE_LIMITS, METHOD_GUIDES } from './methodGuides';

// A logged row with only the fields the counting rules read.
type Row = Pick<LoggedSet, 'type' | 'segment' | 'repStyle' | 'amrap'>;
const SET: Row = { type: 'working' };

type Claim = { records: boolean; drift: boolean; progression: boolean };

/**
 * For each guide: a row that stands for what it describes, what the counting
 * rules must say about that row, and the words the guide must use to say it.
 * If a rule changes, the helper assertion fails here and points at the sheet
 * that is now telling the lifter something untrue.
 */
const CLAIMS: Partial<Record<MethodGuideKey, { row: Row; claim: Claim; says: RegExp[] }>> = {
  tempo: {
    row: SET,
    claim: { records: true, drift: true, progression: true },
    says: [/can set records/i, /are in your weekly effort check/i, /can set your next weight/i],
  },
  paused: {
    row: SET,
    claim: { records: true, drift: true, progression: true },
    says: [/can set records/i, /is in your weekly effort check/i, /can set your next weight/i],
  },
  'one-and-half': {
    row: { type: 'working', repStyle: 'one-and-half' },
    claim: { records: false, drift: true, progression: true },
    says: [/never set a record/i, /are in your weekly effort check/i, /can still set your next weight/i],
  },
  'twenty-ones': {
    row: { type: 'working', repStyle: 'twenty-ones' },
    claim: { records: false, drift: true, progression: true },
    says: [/never claims a rep record/i, /is in your weekly effort check/i, /can still set your next weight/i],
  },
  partial: {
    row: { type: 'working', repStyle: 'partial' },
    claim: { records: false, drift: true, progression: true },
    says: [/never set a record/i, /are in your weekly effort check/i, /can still set your next weight/i],
  },
  'eccentric-only': {
    row: { type: 'working', repStyle: 'eccentric-only' },
    claim: { records: false, drift: true, progression: false },
    says: [/never set your next weight/i, /never set a record/i, /are in your weekly effort check/i],
  },
  isometric: {
    row: { type: 'working', repStyle: 'isometric' },
    claim: { records: false, drift: true, progression: false },
    says: [/never set your next weight/i, /never set a record/i, /are in your weekly effort check/i],
  },
  drop: {
    row: { type: 'working', segment: 1 },
    claim: { records: true, drift: false, progression: false },
    says: [/only the first piece is in your weekly effort check and can set your next weight/i, /each can set a record/i],
  },
  'mechanical-drop': {
    row: { type: 'working', segment: 1 },
    claim: { records: true, drift: false, progression: false },
    says: [/only the first piece is in your weekly effort check and can set your next weight/i, /each can set a record/i],
  },
  cluster: {
    row: { type: 'working', segment: 2 },
    claim: { records: true, drift: false, progression: false },
    says: [/only the first piece is in your weekly effort check and can set your next weight/i, /can set a record/i],
  },
  'rest-pause': {
    row: { type: 'working', segment: 1 },
    claim: { records: true, drift: false, progression: false },
    says: [/only the first piece is in your weekly effort check and can set your next weight/i, /for records/i],
  },
  amrap: {
    row: { type: 'working', amrap: true },
    claim: { records: true, drift: false, progression: true },
    says: [/left out of your weekly effort check/i, /counts for records/i, /can set your next weight/i],
  },
  backoff: {
    row: { type: 'backoff' },
    claim: { records: true, drift: true, progression: false },
    says: [/can set a record/i, /is in your weekly effort check/i, /never sets your next weight/i],
  },
};

// Words that turn a counting sentence into a "does not count" sentence.
const DENIES = /\b(never|not|no longer|left out)\b/i;

function sentences(text: string): string[] {
  return text.split(/(?<=[.;:])\s+/);
}

describe('method guides', () => {
  it('has a guide for every method the app can open one for', () => {
    expect(Object.keys(METHOD_GUIDES).sort()).toEqual([...METHOD_GUIDE_KEYS].sort());
  });

  it.each(METHOD_GUIDE_KEYS)('%s has all five parts, each short enough to read between sets', (key) => {
    const guide = METHOD_GUIDES[key];
    expect(guide.title.trim()).not.toBe('');

    expect(guide.what.trim()).not.toBe('');
    expect(guide.what.length).toBeLessThanOrEqual(GUIDE_LIMITS.WHAT);

    expect(guide.steps.length).toBeGreaterThanOrEqual(GUIDE_LIMITS.STEPS_MIN);
    expect(guide.steps.length).toBeLessThanOrEqual(GUIDE_LIMITS.STEPS_MAX);
    for (const step of guide.steps) {
      expect(step.trim()).not.toBe('');
      expect(step.length).toBeLessThanOrEqual(GUIDE_LIMITS.STEP);
    }

    expect(guide.logs.trim()).not.toBe('');
    expect(guide.logs.length).toBeLessThanOrEqual(GUIDE_LIMITS.LOGS);
    expect(guide.counts.trim()).not.toBe('');
    expect(guide.counts.length).toBeLessThanOrEqual(GUIDE_LIMITS.COUNTS);
    expect(guide.caution.trim()).not.toBe('');
    expect(guide.caution.length).toBeLessThanOrEqual(GUIDE_LIMITS.CAUTION);
  });

  it('gives every guide its own title', () => {
    const titles = METHOD_GUIDE_KEYS.map((key) => METHOD_GUIDES[key].title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('reads the tempo digits in order, with the worked example', () => {
    const tempo = METHOD_GUIDES.tempo.steps.join(' ');
    expect(tempo).toMatch(/lowering, pause at the bottom, lifting, pause at the top/);
    expect(tempo).toMatch(/X means/);
    expect(tempo).toMatch(/2110 is two seconds down, a one-second hold, one second up, and no pause at the top/);
  });

  it('warns that lowering-only work needs a spotter or safeties', () => {
    expect(METHOD_GUIDES['eccentric-only'].caution).toMatch(/spotter/i);
    expect(METHOD_GUIDES['eccentric-only'].caution).toMatch(/safeties/i);
  });

  it('says back-offs count in full where warm-ups are discounted', () => {
    expect(METHOD_GUIDES.backoff.counts).toMatch(/warm-up, which only counts at a discount/i);
  });

  describe('what each guide says it counts matches the counting rules', () => {
    it.each(Object.entries(CLAIMS))('%s', (key, entry) => {
      const { row, claim, says } = entry!;
      // The rule itself: if this fails, the guide's promise is out of date.
      expect(countsForRecords(row)).toBe(claim.records);
      expect(countsForDrift(row)).toBe(claim.drift);
      expect(countsForProgression(row)).toBe(claim.progression);

      const counts = METHOD_GUIDES[key as MethodGuideKey].counts;
      for (const phrase of says) expect(counts).toMatch(phrase);
    });

    it.each(Object.entries(CLAIMS).filter(([, entry]) => entry!.claim.records))(
      '%s never denies a record the rules would award',
      (key) => {
        for (const sentence of sentences(METHOD_GUIDES[key as MethodGuideKey].counts)) {
          if (/record/i.test(sentence)) expect(sentence).not.toMatch(DENIES);
        }
      },
    );

    it.each(Object.entries(CLAIMS).filter(([, entry]) => !entry!.claim.records))(
      '%s never promises a record the rules would refuse',
      (key) => {
        const counts = METHOD_GUIDES[key as MethodGuideKey].counts;
        expect(counts).not.toMatch(/can set (a )?records?/i);
        expect(counts).not.toMatch(/counts? for records/i);
      },
    );

    it.each(Object.entries(CLAIMS).filter(([, entry]) => !entry!.claim.progression && !entry!.row.segment))(
      '%s never promises to set the next weight',
      (key) => {
        expect(METHOD_GUIDES[key as MethodGuideKey].counts).not.toMatch(/can (still )?set your next weight/i);
      },
    );
  });

  it('the first piece of a drop set is still a set, rated and progressed like any other', () => {
    // The drop guides lean on this: "only the first piece" must be true of the first piece.
    const first: Row = { type: 'working' };
    expect(countsForDrift(first)).toBe(true);
    expect(countsForProgression(first)).toBe(true);
  });
});
