// The words behind every training-method explainer.
//
// Static and bundled on purpose: a guide is opened mid-set, often in a basement
// with no signal, so nothing here may depend on the network.
//
// Every guide has the same five parts so a lifter learns where to look once and
// finds it in the same place on every sheet. Each one is short enough to read in
// a rest period. "What Bompa counts" has to agree with the row judgements in
// lib/calc.ts (re-exported from lib/methods.ts) — the tests hold the two
// together, because a guide that promises a record the app will never award is
// worse than no guide.

import type { MethodGuideKey } from './methods';

export type MethodGuide = {
  /** The sheet's title, and the name the dialog is announced by. */
  title: string;
  /** What it is, in one sentence. */
  what: string;
  /** How to do it: two to four short steps, in order. */
  steps: readonly string[];
  /** What the lifter sees and taps in Bompa. */
  logs: string;
  /** What this does and does not count toward. */
  counts: string;
  /** The one thing that goes wrong. */
  caution: string;
};

/**
 * Upper bounds on each part, in characters. A guide that outgrows these has
 * stopped being something you can read between sets.
 */
export const GUIDE_LIMITS = {
  WHAT: 150,
  STEP: 120,
  STEPS_MIN: 2,
  STEPS_MAX: 4,
  LOGS: 260,
  COUNTS: 320,
  CAUTION: 150,
} as const;

// The three things a guide can say a set counts toward, always in the same
// words so the lifter can compare two sheets at a glance:
//   "records"            personal records and the estimated max
//   "weekly effort check" how your RPE compared with the target across the week
//   "next weight"        the set a progression step is added to

// The drop and mechanical drop guides say exactly the same thing about counting.
const PIECES_COUNT =
  'The drops are pieces of one set, so it is still one set on your count. Only the first piece is in your weekly effort check and can set your next weight; the drops never do. Every piece adds to session load, and each can set a record at its own weight.';

export const METHOD_GUIDES: Record<MethodGuideKey, MethodGuide> = {
  tempo: {
    title: 'Tempo',
    what: 'Four digits that set how long each part of a rep takes, so the same weight keeps your muscles working for longer.',
    steps: [
      'Read the digits in order: lowering, pause at the bottom, lifting, pause at the top. Each one is seconds.',
      'X means move as fast as you can while staying in control. 0 means no pause.',
      'So 2110 is two seconds down, a one-second hold, one second up, and no pause at the top.',
    ],
    logs: 'The tempo sits on its own line under the target, spaced out so you can read it at arm’s length. Log weight and reps as normal; the tempo is saved with the set.',
    counts: 'Tempo reps are full reps, so they count like any other set. They can set records and move your estimated max, they are in your weekly effort check, and they can set your next weight.',
    caution: 'A slow tempo makes a weight feel much heavier. Start lighter than you would for the same reps at your usual speed.',
  },

  paused: {
    title: 'Paused reps',
    what: 'A normal rep with a dead stop held in the hardest position, usually the bottom, so you cannot bounce out of it.',
    steps: ['Lower under control to the bottom.', 'Hold still for the count, staying tight.', 'Lift from a standstill.'],
    logs: 'A pause is written as a tempo, such as 3310 for a three-second hold at the bottom, and shows on the tempo line. Log weight and reps as normal.',
    counts: 'A paused rep is a full rep, so it counts in full. It can set records and move your estimated max, it is in your weekly effort check, and it can set your next weight.',
    caution: 'Stay braced through the pause. Relaxing at the bottom of a squat or a bench press is where people get hurt.',
  },

  'one-and-half': {
    title: '1½ reps',
    what: 'One full rep plus a half rep at the hardest end, counted together as a single rep.',
    steps: [
      'Lower all the way down.',
      'Come halfway up, then go back down to the bottom.',
      'Lift all the way up. That whole cycle is one rep.',
    ],
    logs: 'The badge reads 1½ reps. Count complete cycles on the reps stepper: eight cycles is 8, not 16.',
    counts: 'These never set a record or move your estimated max, because they are not normal reps. They are in your weekly effort check and can still set your next weight. Each rep is worth one and a half normal reps in session load.',
    caution: 'The extra half adds up fast. Pick a weight well under what you would use for the same count of normal reps.',
  },

  'twenty-ones': {
    title: '21s',
    what: 'One set of 21 reps in three parts of seven: the bottom half, the top half, then the full range.',
    steps: [
      'Seven reps from the bottom to halfway.',
      'Seven reps from halfway to the top.',
      'Seven full reps, with no rest between the parts.',
    ],
    logs: 'Reps are fixed at 21 and shown as 21 (7 + 7 + 7). Tap the label to log fewer if you ran out.',
    counts: 'A set of 21s never claims a rep record or moves your estimated max, because only seven of the reps were full range. It is in your weekly effort check and can still set your next weight. In session load, the 21 count as 14 normal reps.',
    caution: 'Best on small lifts such as curls. Go light: the last seven are much harder than they look.',
  },

  partial: {
    title: 'Partial reps',
    what: 'Reps through only part of the movement on purpose, usually to work one section of it hard.',
    steps: [
      'Set safeties or pins at the depth where you will stop.',
      'Move through the chosen range only, the same on every rep.',
    ],
    logs: 'Log weight and reps as normal. The badge says the reps are partials, and that is saved with each set.',
    counts: 'Partials never set a record or move your estimated max, because a shorter rep lets you handle more weight. They are in your weekly effort check and can still set your next weight. Each rep counts as half a normal rep in session load.',
    caution: 'Partials often mean heavier weights than you are used to. Use safeties, and keep the range the same on every rep.',
  },

  'eccentric-only': {
    title: 'Lowering only',
    what: 'You lower a weight heavier than you can lift, slowly, and someone or something else does the lifting part.',
    steps: [
      'Have a spotter help the weight up, or use your other arm or leg to get it there.',
      'Lower it slowly, over three to five seconds.',
      'Let the help take it back up, then repeat.',
    ],
    logs: 'The badge reads Lowering only. The weight stepper lets you go above your estimated max without a warning, because that is the point.',
    counts: 'These never set your next weight, and never set a record or move your estimated max: weight above your max would push both somewhere dangerous. They are in your weekly effort check, and each rep counts as 0.6 of a normal rep in session load.',
    caution: 'Never do this alone. Every rep needs a spotter, or safeties set just below the bottom of the movement.',
  },

  isometric: {
    title: 'Holds',
    what: 'Holding a weight still in one position for a set time, instead of moving it.',
    steps: ['Get into position and hold still.', 'Keep breathing and stay tight for the whole count.', 'Rest, then hold again.'],
    logs: 'The reps stepper becomes holds, and a second stepper sets the seconds for each one. Use the interval timer if you want a countdown.',
    counts: 'Holds never set your next weight, and never set a record or move your estimated max, because a held weight is not comparable with a moving one. They are in your weekly effort check. In session load, every three seconds held counts as one rep.',
    caution: 'Do not hold your breath. Breathe out slowly through the hold, especially with a heavy weight.',
  },

  drop: {
    title: 'Drop set',
    what: 'One set that keeps going: when you run out of reps, take weight off and carry on straight away.',
    steps: [
      'Do your reps at the starting weight.',
      'Take weight off straight away, about a fifth.',
      'Do as many good reps as you can. Repeat for each drop.',
    ],
    logs: 'Log the first piece as normal. No rest starts: the card shows the drop with the lighter weight ready, and you tap Log drop. End set finishes early. You can also add a drop from the rest screen.',
    counts: PIECES_COUNT,
    caution: 'Drop sets are hard to recover from. Save them for the last set of a lift, not every set.',
  },

  'mechanical-drop': {
    title: 'Mechanical drop set',
    what: 'A drop set where the weight stays the same and you switch to an easier version of the exercise instead.',
    steps: [
      'Start with the hardest version, such as an incline press, until you run out.',
      'Switch straight to an easier version, such as a flat press, with the same weight.',
      'Keep going until the last version is done.',
    ],
    logs: 'Just like a drop set: log the first piece, then each switch is logged as a piece of the same set. The weight stays put and the card names the next version.',
    counts: PIECES_COUNT,
    caution: 'Set up every version before you start, so each switch takes seconds rather than a minute.',
  },

  cluster: {
    title: 'Cluster set',
    what: 'One set split into small pieces with short breaks, so you can do more reps with a heavy weight.',
    steps: [
      'Do the first piece, often a single or a few reps.',
      'Rest 10 to 20 seconds, staying at the bar.',
      'Do the next piece. Repeat until the planned pieces are done.',
    ],
    logs: 'Log each piece as you go. A short countdown runs on the entry card and you can go early. The full rest starts after the last piece.',
    counts: 'Still one set on your count. Only the first piece is in your weekly effort check and can set your next weight. Each piece is judged alone on its own weight and reps, so a heavy single can set a record. Pieces are never added together.',
    caution: 'Heavy clusters need clean form on every rep. End the set if a single slows down badly.',
  },

  'rest-pause': {
    title: 'Rest-pause',
    what: 'A set taken close to failure, then carried on in short bursts after a brief rest, for a set number of pieces or a total rep target.',
    steps: [
      'Do a set close to failure.',
      'Rest 10 to 20 seconds.',
      'Do as many more reps as you can. Repeat for the planned pieces, or until you reach the total.',
    ],
    logs: 'Log each piece as you go, with a short countdown on the entry card between them. With a total target, the card shows your running total, such as 13 of 50, and ends the set when you get there.',
    counts: 'Still one set on your count, however many pieces. Only the first piece is in your weekly effort check and can set your next weight. Each piece is judged alone on its own weight and reps for records. Pieces are never added together.',
    caution: 'Pick lifts you can stop safely, such as machines or dumbbells. Not heavy squats without safeties.',
  },

  amrap: {
    title: 'As many reps as possible',
    what: 'A set with a minimum to hit, where you keep going while your form holds.',
    steps: [
      'Hit the minimum shown, such as 5+.',
      'Keep going until one more good rep would be a grind.',
      'Log the reps you got.',
    ],
    logs: 'The reps stepper starts at the minimum and says as many as you can. Step it up to what you did. You do not need to give an RPE.',
    counts: 'An AMRAP set is left out of your weekly effort check, because it is all-out by design. It still counts for records and your estimated max, often as the best evidence you give, and it can set your next weight.',
    caution: 'Stop at the last good rep, not the first failed one. A missed rep with nobody spotting you is a risk, not a win.',
  },

  wave: {
    title: 'Wave loading',
    what: 'Sets that get heavier as the reps come down, then start again slightly heavier, such as 7, 5, 3 and then 7, 5, 3.',
    steps: [
      'Do the first wave, adding weight as the reps drop.',
      'Start the second wave a little heavier than the first.',
      'Rest fully between sets.',
    ],
    logs: 'The target line shows this set only, such as Set 3 of 6, with a strip of the whole wave under it. After each set the steppers load the next target.',
    counts: 'Every set counts as a normal set and can set a record. Each is in your weekly effort check unless it is marked as many as possible. Your next weight comes from the heaviest set, and the whole wave moves with it.',
    caution: 'Only go heavier in the second wave if the first felt good. If it did not, repeat the first wave’s weights.',
  },

  pyramid: {
    title: 'Pyramid',
    what: 'Sets that change weight in steps: heavier with fewer reps, lighter with more, or up and back down again.',
    steps: [
      'Start at the first weight and reps shown.',
      'Change the weight for each set as the target says.',
      'Rest fully between sets.',
    ],
    logs: 'The target line shows this set only, with a strip of the whole pyramid under it. After each set the steppers load the next target.',
    counts: 'Every set counts as a normal set, can set a record and is in your weekly effort check. Your next weight comes from the heaviest set, and the whole pyramid moves with it.',
    caution: 'Do not spend everything on the way up. The heaviest set should still be clean.',
  },

  'descending-rest': {
    title: 'Descending rest',
    what: 'The rest between sets gets shorter each time, such as 90, 60, 45 and then 30 seconds, so the same work gets harder.',
    steps: [
      'Take the full rest after the first set.',
      'Take the shorter rest shown after each set after that.',
      'Keep the weight the same unless your reps fall away badly.',
    ],
    logs: 'Nothing extra to tap. The rest timer uses each set’s own rest, so the countdown gets shorter by itself.',
    counts: 'Nothing changes: every set counts as a normal set for records, your weekly effort check and your next weight. Only the rest is different.',
    caution: 'Short rests make heavy lifts risky. Use this on lighter or machine work.',
  },

  backoff: {
    title: 'Back-off sets',
    what: 'Lighter sets after your heavy work, usually for more reps, to add volume without another heavy set.',
    steps: [
      'Finish your heavy working sets.',
      'Take some weight off, often 10 to 20 percent.',
      'Do the back-off sets with good speed and form.',
    ],
    logs: 'When the programme marks a set as a back-off, the set type switches to back-off by itself. You can change it from the set’s type dot.',
    counts: 'Unlike a warm-up, which only counts at a discount, a back-off counts in full for session load. It can set a record and is in your weekly effort check. It never sets your next weight, because back-offs are light on purpose.',
    caution: 'Keep them lighter. A back-off that ends up heavy is really another working set.',
  },

  groups: {
    title: 'Trisets and giant sets',
    what: 'Three lifts done back to back is a triset, and four or more is a giant set: a superset with more lifts in it.',
    steps: [
      'Do one set of the first lift.',
      'Move straight to the next, taking only the short gap shown.',
      'After the last lift, take the full rest, then start the next round.',
    ],
    logs: 'The lifts share a group letter, and the label says Triset or Giant set. After each set Bompa moves you to the next lift, and each lift can have its own gap.',
    counts: 'Each set counts as a normal set of its own lift for records, your weekly effort check and your next weight. A round only ends when every lift has a set, so a drop on one lift will not move you on early.',
    caution: 'Choose lifts that do not all tire the same muscle, and set everything up before you start.',
  },
};

export function methodGuide(key: MethodGuideKey): MethodGuide {
  return METHOD_GUIDES[key];
}
