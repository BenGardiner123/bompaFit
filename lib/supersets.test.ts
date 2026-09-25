import { describe, expect, it } from 'vitest';
import {
  SUPERSET_REST_MAX_SEC,
  chipLayout,
  groupFor,
  groupLabel,
  nextInRound,
  normaliseRoutine,
  normaliseSlotOrder,
  restAfterSet,
  roundsCompleted,
  supersetGroups,
  workingSetCount,
} from './supersets';
import { fullRestSec } from './methods';
import type { LoggedSet, Routine, RoutineSlot, SetType } from './types';

const NOW = new Date(2026, 7, 19, 18, 0, 0).getTime();

function slot(exerciseId: string, order: number, group: string | null, sets = 3): RoutineSlot {
  return {
    exerciseId,
    order,
    sets,
    reps: 10,
    targetWeightKg: 40,
    targetPct1RM: null,
    targetRpe: 8,
    supersetGroup: group,
  };
}

/** Bench alone, then a Fly + Rope superset, then Curl alone. */
const ROUTINE: Routine = {
  id: 'push',
  name: 'Push',
  source: 'user',
  phase: 'strength',
  estMinutes: 50,
  slots: [
    slot('bench', 0, null, 4),
    slot('fly', 1, 'A', 3),
    slot('rope', 2, 'A', 3),
    slot('curl', 3, null, 3),
  ],
};

/** The same routine with a deliberate gap recorded against group A. */
function gapped(sec: number): Routine {
  return { ...ROUTINE, supersetRest: { A: sec } };
}

function logged(exerciseId: string, type: SetType = 'working'): LoggedSet {
  return {
    sessionId: 1,
    exerciseId,
    setNo: 1,
    type,
    weightKg: 40,
    reps: 10,
    rpe: 8,
    rpeEstimated: false,
    at: NOW,
  };
}

describe('supersetGroups', () => {
  it('collects members under their letter, in routine order', () => {
    const groups = supersetGroups(ROUTINE);
    expect([...groups.keys()]).toEqual(['A']);
    expect(groups.get('A')!.slots.map((s) => s.exerciseId)).toEqual(['fly', 'rope']);
  });

  it('ignores lifts trained on their own', () => {
    const groups = supersetGroups(ROUTINE);
    expect(groups.get('A')!.slots.some((s) => s.exerciseId === 'bench')).toBe(false);
  });

  it('takes the largest set count when members disagree', () => {
    // A hand-built routine can end up mismatched; the group should not be cut
    // short by whichever lift happens to have fewer sets.
    const mismatched: Routine = {
      ...ROUTINE,
      slots: [slot('fly', 0, 'A', 3), slot('rope', 1, 'A', 5)],
    };
    expect(supersetGroups(mismatched).get('A')!.targetRounds).toBe(5);
  });

  it('handles a routine with no groups at all', () => {
    expect(supersetGroups({ ...ROUTINE, slots: [slot('bench', 0, null)] }).size).toBe(0);
  });

  it('handles a missing routine', () => {
    expect(supersetGroups(null).size).toBe(0);
    expect(groupFor(null, 'fly')).toBeNull();
  });

  it('supports more than one group in a routine', () => {
    const two: Routine = {
      ...ROUTINE,
      slots: [slot('fly', 0, 'A'), slot('rope', 1, 'A'), slot('curl', 2, 'B'), slot('shrug', 3, 'B')],
    };
    expect([...supersetGroups(two).keys()]).toEqual(['A', 'B']);
  });
});

describe('groupFor', () => {
  it('finds the group a lift belongs to', () => {
    expect(groupFor(ROUTINE, 'fly')?.letter).toBe('A');
    expect(groupFor(ROUTINE, 'rope')?.letter).toBe('A');
  });

  it('returns null for a lift trained on its own', () => {
    expect(groupFor(ROUTINE, 'bench')).toBeNull();
  });

  it('returns null for a lift added mid-session that is not in the routine', () => {
    expect(groupFor(ROUTINE, 'unplanned-lift')).toBeNull();
  });
});

describe('roundsCompleted', () => {
  const group = supersetGroups(ROUTINE).get('A')!;

  it('is zero before anything is logged', () => {
    expect(roundsCompleted(group, [])).toBe(0);
  });

  it('stays at zero until every member has been done', () => {
    // Half a round is not a round.
    expect(roundsCompleted(group, [logged('fly')])).toBe(0);
  });

  it('counts a round once every member has had its set', () => {
    expect(roundsCompleted(group, [logged('fly'), logged('rope')])).toBe(1);
  });

  it('ignores warm-ups', () => {
    expect(roundsCompleted(group, [logged('fly', 'warmup'), logged('rope', 'warmup')])).toBe(0);
  });

  it('counts back-off sets as real work', () => {
    expect(roundsCompleted(group, [logged('fly', 'backoff'), logged('rope', 'backoff')])).toBe(1);
  });
});

describe('nextInRound', () => {
  const group = supersetGroups(ROUTINE).get('A')!;

  it('moves to the next lift in the group', () => {
    expect(nextInRound(group, [logged('fly')], 'fly')?.exerciseId).toBe('rope');
  });

  it('returns null once the round is complete — that is the cue to rest', () => {
    expect(nextInRound(group, [logged('fly'), logged('rope')], 'rope')).toBeNull();
  });

  it('wraps back when the user jumps into the middle of a group', () => {
    // Started on rope; fly still owes this round.
    expect(nextInRound(group, [logged('rope')], 'rope')?.exerciseId).toBe('fly');
  });

  it('starts the next round from the first lift', () => {
    const done = [logged('fly'), logged('rope')];
    // A new round begins: fly is behind again once rope pulls ahead.
    expect(nextInRound(group, [...done, logged('rope')], 'rope')?.exerciseId).toBe('fly');
  });

  it('returns null for a lift that is not in the group', () => {
    expect(nextInRound(group, [], 'bench')).toBeNull();
  });

  describe('members planned for different numbers of sets', () => {
    // Bench 4, fly 3: the last round is bench alone.
    const uneven = supersetGroups({
      ...ROUTINE,
      slots: [slot('bench', 0, 'B', 4), slot('fly', 1, 'B', 3)],
    }).get('B')!;
    const rounds = (n: number) => Array.from({ length: n }, () => [logged('bench'), logged('fly')]).flat();

    it('does not hand on to a member that has done all its planned sets', () => {
      const rows = [...rounds(3), logged('bench')];
      expect(nextInRound(uneven, rows, 'bench')).toBeNull();
      // So the fourth bench ends the round with the full rest.
      expect(restAfterSet({ group: uneven, sessionSetsAfterLogging: rows, exerciseId: 'bench', fullRestSec: 150 })).toEqual({
        sec: 150,
        kind: 'full',
      });
    });

    it('still hands on while that member has sets left', () => {
      expect(nextInRound(uneven, [...rounds(2), logged('bench')], 'bench')?.exerciseId).toBe('fly');
    });

    it('takes the planned count it is given over the slot, since a trimmed lift owes fewer', () => {
      const rows = [...rounds(2), logged('bench')];
      expect(nextInRound(uneven, rows, 'bench', { bench: 4, fly: 2 })).toBeNull();
    });

    it('past the plan for every member, an extra round still runs through the group', () => {
      const rows = [...rounds(3), logged('bench'), logged('bench')];
      expect(nextInRound(uneven, rows, 'bench')?.exerciseId).toBe('fly');
    });
  });
});

describe('restAfterSet', () => {
  const group = supersetGroups(ROUTINE).get('A')!;
  const withGap = supersetGroups(gapped(15)).get('A')!;

  it('gives the full rest after a lift trained on its own', () => {
    expect(
      restAfterSet({ group: null, sessionSetsAfterLogging: [logged('bench')], exerciseId: 'bench', fullRestSec: 150 }),
    ).toEqual({ sec: 150, kind: 'full' });
  });

  it('gives no rest at all partway through an ordinary superset round', () => {
    // The whole point of the format: no rest between the parts.
    expect(
      restAfterSet({ group, sessionSetsAfterLogging: [logged('fly')], exerciseId: 'fly', fullRestSec: 150 }),
    ).toEqual({ sec: 0, kind: 'none' });
  });

  it('gives the full rest once the round is complete', () => {
    expect(
      restAfterSet({
        group,
        sessionSetsAfterLogging: [logged('fly'), logged('rope')],
        exerciseId: 'rope',
        fullRestSec: 150,
      }),
    ).toEqual({ sec: 150, kind: 'full' });
  });

  it('gives the group gap partway through a round when one is set', () => {
    expect(
      restAfterSet({ group: withGap, sessionSetsAfterLogging: [logged('fly')], exerciseId: 'fly', fullRestSec: 150 }),
    ).toEqual({ sec: 15, kind: 'transition' });
  });

  it('still gives the full rest at the end of a round that has a gap', () => {
    // The gap replaces the rest between the parts, never the one after them.
    expect(
      restAfterSet({
        group: withGap,
        sessionSetsAfterLogging: [logged('fly'), logged('rope')],
        exerciseId: 'rope',
        fullRestSec: 150,
      }),
    ).toEqual({ sec: 150, kind: 'full' });
  });

  it('never lets the gap exceed the full rest by accident', () => {
    // A 30s gap and a 20s preset is legal; the gap is the group's own number and
    // is not clamped to the preset, because they answer different questions.
    expect(
      restAfterSet({
        group: supersetGroups(gapped(30)).get('A')!,
        sessionSetsAfterLogging: [logged('fly')],
        exerciseId: 'fly',
        fullRestSec: 20,
      }),
    ).toEqual({ sec: 30, kind: 'transition' });
  });
});

describe('superset gaps', () => {
  it('defaults to no gap when the routine has never set one', () => {
    expect(supersetGroups(ROUTINE).get('A')!.restSec).toBe(0);
  });

  it('reads the gap for its own letter', () => {
    expect(supersetGroups(gapped(15)).get('A')!.restSec).toBe(15);
  });

  it('ignores a gap recorded against a different letter', () => {
    const other: Routine = { ...ROUTINE, supersetRest: { B: 30 } };
    expect(supersetGroups(other).get('A')!.restSec).toBe(0);
  });

  it.each([
    ['negative', -10, 0],
    ['above the maximum', 9999, SUPERSET_REST_MAX_SEC],
    ['fractional', 15.6, 16],
  ])('clamps a %s stored value', (_label, stored, expected) => {
    expect(supersetGroups(gapped(stored)).get('A')!.restSec).toBe(expected);
  });

  it.each([
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['a string', '20' as unknown as number],
  ])('treats %s as no gap rather than trusting it', (_label, stored) => {
    expect(supersetGroups(gapped(stored)).get('A')!.restSec).toBe(0);
  });
});

describe('normaliseRoutine', () => {
  it('tidies slot order the same way normaliseSlotOrder does', () => {
    const scattered: Routine = {
      ...ROUTINE,
      slots: [slot('fly', 0, 'A'), slot('bench', 1, null), slot('rope', 2, 'A')],
    };
    expect(normaliseRoutine(scattered).slots.map((s) => s.exerciseId)).toEqual(['fly', 'rope', 'bench']);
  });

  it('keeps the gap for a letter that is still in use', () => {
    expect(normaliseRoutine(gapped(15)).supersetRest).toEqual({ A: 15 });
  });

  it('drops the gap for a letter nothing is tagged with any more', () => {
    // Ungroup the last lift tagged B and the stored gap must go with it, or the
    // next pair tagged B silently inherits a gap nobody set for them.
    const stale: Routine = { ...ROUTINE, supersetRest: { A: 15, B: 30 } };
    expect(normaliseRoutine(stale).supersetRest).toEqual({ A: 15 });
  });

  it('stores no key at all for a gap of zero', () => {
    expect(normaliseRoutine(gapped(0)).supersetRest).toEqual({});
  });

  it('clamps on the way in, so what is stored is what will be read', () => {
    expect(normaliseRoutine(gapped(9999)).supersetRest).toEqual({ A: SUPERSET_REST_MAX_SEC });
  });

  it('leaves a routine with no groups holding an empty map', () => {
    const solo: Routine = { ...ROUTINE, slots: [slot('bench', 0, null)], supersetRest: { A: 15 } };
    expect(normaliseRoutine(solo).supersetRest).toEqual({});
  });
});

describe('groupLabel', () => {
  const group = supersetGroups(ROUTINE).get('A')!;

  it('names the round you are on, not the one you finished', () => {
    expect(groupLabel(group, [])).toBe('Superset A · round 1 of 3');
    expect(groupLabel(group, [logged('fly'), logged('rope')])).toBe('Superset A · round 2 of 3');
  });

  it('does not run past the programmed round count', () => {
    const done = Array.from({ length: 4 }, () => [logged('fly'), logged('rope')]).flat();
    expect(groupLabel(group, done)).toBe('Superset A · round 3 of 3');
  });
});

describe('chipLayout', () => {
  it('marks where a group starts and ends', () => {
    const layout = chipLayout(['bench', 'fly', 'rope', 'curl'], ROUTINE);
    expect(layout.map((c) => c.letter)).toEqual([null, 'A', 'A', null]);
    expect(layout.map((c) => c.startsGroup)).toEqual([false, true, false, false]);
    expect(layout.map((c) => c.endsGroup)).toEqual([false, false, true, false]);
  });

  it('treats a single-member group as both start and end', () => {
    const solo: Routine = { ...ROUTINE, slots: [slot('fly', 0, 'A')] };
    const [entry] = chipLayout(['fly'], solo);
    expect(entry).toMatchObject({ letter: 'A', startsGroup: true, endsGroup: true });
  });

  it('leaves lifts alone when there is no routine to group by', () => {
    // A session whose routine has since been deleted still logs fine; it just
    // has no grouping to draw.
    const layout = chipLayout(['bench', 'fly'], null);
    expect(layout.every((c) => c.letter === null)).toBe(true);
  });

  it('keeps unplanned lifts ungrouped', () => {
    const layout = chipLayout(['fly', 'rope', 'added-later'], ROUTINE);
    expect(layout[2]).toMatchObject({ letter: null, startsGroup: false });
  });
});

describe('workingSetCount', () => {
  it('counts only working and back-off sets', () => {
    const sets = [logged('fly'), logged('fly', 'warmup'), logged('fly', 'backoff')];
    expect(workingSetCount(sets, 'fly')).toBe(2);
  });
});

describe('normaliseSlotOrder', () => {
  it('leaves an already-tidy routine alone', () => {
    const tidy = [slot('bench', 0, null), slot('fly', 1, 'A'), slot('rope', 2, 'A')];
    expect(normaliseSlotOrder(tidy).map((s) => s.exerciseId)).toEqual(['bench', 'fly', 'rope']);
  });

  it('pulls scattered group members together at the first one', () => {
    // Tagging lifts 0 and 2 as a superset with an unrelated lift between them
    // describes a group that cannot be performed as written.
    const scattered = [slot('fly', 0, 'A'), slot('bench', 1, null), slot('rope', 2, 'A')];
    expect(normaliseSlotOrder(scattered).map((s) => s.exerciseId)).toEqual(['fly', 'rope', 'bench']);
  });

  it('renumbers order to be dense', () => {
    const scattered = [slot('fly', 0, 'A'), slot('bench', 1, null), slot('rope', 2, 'A')];
    expect(normaliseSlotOrder(scattered).map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it('keeps two groups separate and in first-appearance order', () => {
    const mixed = [
      slot('curl', 0, 'B'),
      slot('fly', 1, 'A'),
      slot('shrug', 2, 'B'),
      slot('rope', 3, 'A'),
    ];
    expect(normaliseSlotOrder(mixed).map((s) => s.exerciseId)).toEqual(['curl', 'shrug', 'fly', 'rope']);
  });

  it('preserves the order of ungrouped lifts', () => {
    const singles = [slot('a', 0, null), slot('b', 1, null), slot('c', 2, null)];
    expect(normaliseSlotOrder(singles).map((s) => s.exerciseId)).toEqual(['a', 'b', 'c']);
  });

  it('produces a layout with exactly one group per letter', () => {
    const scattered = [slot('fly', 0, 'A'), slot('bench', 1, null), slot('rope', 2, 'A')];
    const layout = chipLayout(
      normaliseSlotOrder(scattered).map((s) => s.exerciseId),
      { ...ROUTINE, slots: normaliseSlotOrder(scattered) },
    );
    expect(layout.filter((c) => c.startsGroup)).toHaveLength(1);
    expect(layout.filter((c) => c.endsGroup)).toHaveLength(1);
  });

  it('handles an empty routine', () => {
    expect(normaliseSlotOrder([])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// Trisets, giant sets and sets made of pieces
// ─────────────────────────────────────────────────────────────

describe('trisets, giant sets and pieces', () => {
  function logged(exerciseId: string, over: Partial<LoggedSet> = {}): LoggedSet {
    return {
      sessionId: 1,
      exerciseId,
      setNo: 1,
      type: 'working',
      weightKg: 40,
      reps: 10,
      rpe: 8,
      rpeEstimated: false,
      at: NOW,
      ...over,
    };
  }

  const TRI: Routine = {
    id: 'tri',
    name: 'Tri',
    source: 'user',
    phase: 'hypertrophy',
    estMinutes: 30,
    slots: [slot('a', 0, 'B'), slot('b', 1, 'B'), slot('c', 2, 'B')],
  };
  const GIANT: Routine = { ...TRI, id: 'giant', slots: [...TRI.slots, slot('d', 3, 'B')] };

  it('a set with two drops counts as one set, and as one set toward a round', () => {
    const pair = supersetGroups(ROUTINE).get('A')!;
    const rows = [
      logged('fly'),
      logged('fly', { segment: 1, segmentStyle: 'drop', weightKg: 32 }),
      logged('fly', { segment: 2, segmentStyle: 'drop', weightKg: 25 }),
    ];
    expect(workingSetCount(rows, 'fly')).toBe(1);
    expect(roundsCompleted(pair, rows)).toBe(0);
    // The drops must not send the lifter on as though the round were level.
    expect(nextInRound(pair, rows, 'fly')?.exerciseId).toBe('rope');
  });

  for (const [name, routine, ids] of [
    ['three', TRI, ['a', 'b', 'c']],
    ['four', GIANT, ['a', 'b', 'c', 'd']],
  ] as const) {
    it(`a ${name}-member group completes a round only when every member has a set`, () => {
      const group = supersetGroups(routine).get('B')!;
      expect(group.slots.map((s) => s.exerciseId)).toEqual(ids);
      const rows: LoggedSet[] = [];
      for (const [i, id] of ids.entries()) {
        expect(roundsCompleted(group, rows)).toBe(0);
        rows.push(logged(id));
        const next = nextInRound(group, rows, id);
        if (i < ids.length - 1) expect(next?.exerciseId).toBe(ids[i + 1]);
        else expect(next).toBeNull();
      }
      expect(roundsCompleted(group, rows)).toBe(1);
    });

    it(`a ${name}-member group entered partway wraps back to the members it skipped`, () => {
      const group = supersetGroups(routine).get('B')!;
      // Start on the second member, go to the end, then wrap to the first.
      const rows: LoggedSet[] = [];
      const order = [...ids.slice(1), ids[0]];
      for (const [i, id] of order.entries()) {
        rows.push(logged(id));
        const next = nextInRound(group, rows, id);
        if (i < order.length - 1) expect(next?.exerciseId).toBe(order[i + 1]);
        else expect(next).toBeNull();
      }
      expect(roundsCompleted(group, rows)).toBe(1);
    });
  }

  it('names the group by its size', () => {
    expect(groupLabel(supersetGroups(ROUTINE).get('A')!, [])).toBe('Superset A · round 1 of 3');
    expect(groupLabel(supersetGroups(TRI).get('B')!, [])).toBe('Triset B · round 1 of 3');
    expect(groupLabel(supersetGroups(GIANT).get('B')!, [])).toBe('Giant set B · round 1 of 3');
  });

  it('a triset with member gaps of 10 and 10 and a full rest of 180 runs 10 s, 10 s, then 180 s', () => {
    const gapped: Routine = {
      ...TRI,
      supersetRest: { B: 30 },
      slots: [
        { ...slot('a', 0, 'B'), gapAfterSec: 10 },
        { ...slot('b', 1, 'B'), gapAfterSec: 10 },
        { ...slot('c', 2, 'B'), restSec: 180 },
      ],
    };
    const group = supersetGroups(gapped).get('B')!;
    const rows: LoggedSet[] = [];
    const plans = gapped.slots.map((member) => {
      rows.push(logged(member.exerciseId));
      return restAfterSet({
        group,
        sessionSetsAfterLogging: [...rows],
        exerciseId: member.exerciseId,
        fullRestSec: fullRestSec(member, 0, 150),
      });
    });
    expect(plans).toEqual([
      { sec: 10, kind: 'transition' },
      { sec: 10, kind: 'transition' },
      { sec: 180, kind: 'full' },
    ]);
  });

  it("a member without its own gap takes the group's", () => {
    const withGroupGap: Routine = { ...TRI, supersetRest: { B: 20 }, slots: [{ ...slot('a', 0, 'B'), gapAfterSec: 5 }, slot('b', 1, 'B'), slot('c', 2, 'B')] };
    const group = supersetGroups(withGroupGap).get('B')!;
    const afterA = [logged('a')];
    const afterB = [...afterA, logged('b')];
    expect(restAfterSet({ group, sessionSetsAfterLogging: afterA, exerciseId: 'a', fullRestSec: 150 })).toEqual({ sec: 5, kind: 'transition' });
    expect(restAfterSet({ group, sessionSetsAfterLogging: afterB, exerciseId: 'b', fullRestSec: 150 })).toEqual({ sec: 20, kind: 'transition' });
  });

  it('a piece with more to come gets only its pause, as an intra rest', () => {
    const args = { group: null, sessionSetsAfterLogging: [logged('bench')], exerciseId: 'bench', fullRestSec: 150 };
    expect(restAfterSet({ ...args, midSet: { intraRestSec: 15 } })).toEqual({ sec: 15, kind: 'intra' });
    expect(restAfterSet({ ...args, midSet: { intraRestSec: 0 } })).toEqual({ sec: 0, kind: 'none' });
    expect(restAfterSet(args)).toEqual({ sec: 150, kind: 'full' });
  });

  it("a member with a scheme sets the group's rounds by the scheme's length", () => {
    const schemed: Routine = { ...TRI, slots: [{ ...slot('a', 0, 'B', 3), scheme: [{ reps: 8 }, { reps: 6 }, { reps: 4 }, { reps: 2 }, { reps: 1 }] }, slot('b', 1, 'B', 3)] };
    expect(supersetGroups(schemed).get('B')!.targetRounds).toBe(5);
  });
});
