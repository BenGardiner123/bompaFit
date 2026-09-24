// Every colour and dimension in the app. Transcribed from the design.
//
// The unrounded values (12.5px, 9.5px, letterSpacing '.16em') are deliberate.
// Don't normalise them to a 4px scale — the design is the source of truth for
// visuals and this file is how we keep a 1:1 mapping back to it.

import type { Phase } from './types';

/** Colours. */
export const C = {
  // Surfaces
  page: '#EDEBE6',
  screen: '#F7F6F3',
  card: '#FFFFFF',
  sunken: '#F2F0EB',
  sunkenAlt: '#EDEBE5',
  tagBg: '#F3F1EC',

  // Ink
  ink: '#141410',
  ink80: '#3D3D36',
  ink60: '#57574E',
  muted: '#8A8A80',
  /**
   * Tertiary text that still has to be readable. `faint` below measures 2.3:1
   * against white, which fails WCAG AA and is why it is restricted to
   * decoration. This is the same family at 5.1:1, for small labels that carry
   * information — units, day names, set numbers, empty states.
   */
  tertiary: '#6E6E64',
  /**
   * Decorative only on light surfaces — 2.3:1 on white. Never use it there for
   * text a reader needs. On `ink` it measures 7.3:1, which is why the dark
   * screens use it for secondary text (see `onInk` below).
   */
  faint: '#A3A399',

  // Lines
  line: '#E5E2DB',
  lineStrong: '#DAD6CD',
  lineSoft: '#EEEBE4',

  // Accent
  amber: '#F59E0B',
  amberLight: '#FBBF24',
  amberDark: '#B45309',
  amberBg: '#FFFBEB',
  amberBd: '#FDE68A',

  // Semantic
  green: '#10B981',
  /**
   * One step darker than the design's `#059669`, which measures 3.8:1 on white
   * and fails AA for the trend deltas and DONE tags it is used for. Same family,
   * 5.5:1. A deliberate departure from the design.
   */
  greenDark: '#047857',
  greenBg: '#ECFDF5',
  greenLight: '#34D399',

  red: '#EF4444',
  /**
   * One step darker than the design's `#DC2626`, which measures 4.4:1 on the red
   * tint it sits on in the rest timer and the overreach rows — just under AA.
   * Same family, 5.9:1 there and 6.5:1 on white. A deliberate departure from
   * the design.
   */
  redDark: '#C81E1E',
  redBg: '#FEF2F2',
  redBd: '#FECACA',
  /**
   * Red for text and marks on `ink`: the meet countdown, a timer in its last
   * seconds, a fatigue increase. `redDark` is built for light backgrounds and
   * is too dark to read on ink; this measures 6.7:1 there. On the lighter
   * `ink80` it drops to 4.0:1 — fine for a big countdown, too low for small text.
   */
  redLight: '#F87171',

  blue: '#3B82F6',
  blueDark: '#2563EB',
  blueBg: '#EFF6FF',
  /**
   * The hypertrophy colour for a number sitting on `ink`, matching how
   * `greenLight` and `amberLight` stand in for their phases there. 7.3:1 on ink.
   */
  blueLight: '#60A5FA',

  grey: '#9CA3AF',

  white: '#FFFFFF',
} as const;

/**
 * Colours for things drawn on an `ink` surface — the heroes, the Train screen
 * and every bottom sheet. They are the same values as above under names that
 * say what they are for, so a component reads `onInk.muted` rather than making
 * the reader remember that `faint` is only safe for text on dark.
 *
 * Nothing on ink uses `muted` or `tertiary`: both are tuned for light surfaces
 * and drop well below readable on dark.
 */
export const onInk = {
  /** Primary text. 18.5:1. */
  text: C.white,
  /**
   * Secondary text: labels, units, captions. 7.3:1 on ink, but only 4.3:1 on
   * `ink80`, so on an `ink80` card use `body` for anything small.
   */
  muted: C.faint,
  /** Body copy — sentences in a hero or a sheet. 12.7:1. */
  body: C.lineStrong,
  /** Hairlines, tracks and the raised fill of a card on ink. */
  line: C.ink80,
  /** Outline borders of controls, and the unselected dot. */
  control: C.ink60,
} as const;

/** Background dimming behind every bottom sheet. Deeper than a light scrim so the ink sheet still stands off the dark Train screen. */
export const SCRIM = 'rgba(0,0,0,.55)';

/** Training-phase colours, used consistently across calendar, library and charts. */
export const PH: Record<Phase, string> = {
  hypertrophy: C.blue,
  strength: C.green,
  power: C.amber,
  peak: C.red,
  deload: C.grey,
};

export const PHASE_LABEL: Record<Phase, string> = {
  hypertrophy: 'Hypertrophy',
  strength: 'Strength',
  power: 'Power',
  peak: 'Peak',
  deload: 'Deload',
};

/**
 * Text colour for a label sitting *on* a phase-coloured fill.
 *
 * The design puts white on these bars, which measures 2.1:1 on the amber and
 * 2.6:1 on the green — unreadable at the 9.5px the strip uses. Dark ink clears
 * 4.9:1 on every one of them. A deliberate departure from the design.
 */
export const ON_PHASE = C.ink;

/**
 * A phase's colour for a number printed on `ink`. The base phase colours are
 * mid-tones picked for fills; as text on dark, blue and red fall short, so each
 * phase gets its lighter sibling here.
 */
export const PH_ON_INK: Record<Phase, string> = {
  hypertrophy: C.blueLight,
  strength: C.greenLight,
  power: C.amberLight,
  peak: C.redLight,
  deload: C.lineStrong,
};

/** Short labels for the macrocycle strip, where space is 3 characters. */
export const PHASE_ABBR: Record<Phase, string> = {
  hypertrophy: 'HYP',
  strength: 'STR',
  power: 'PWR',
  peak: 'PEAK',
  deload: 'D',
};

export const FONT = 'var(--font-geist-sans), Geist, system-ui, sans-serif';

/**
 * Spread into any element containing a figure. A rest timer whose digits change
 * width as it counts down is unreadable at a glance, which is the only way
 * anyone reads it mid-set.
 */
export const num = { fontVariantNumeric: 'tabular-nums' } as const;

/** Corner radii, from the design's card hierarchy. */
export const R = {
  hero: 22,
  card: 20,
  panel: 18,
  block: 16,
  control: 14,
  chip: 12,
  small: 10,
  tiny: 7,
  pill: 999,
} as const;

/**
 * Hero numeral sizes. One big number leads every screen, and the size says how
 * much that number matters on its screen — readiness is the loudest thing in
 * the app, a step counter in setup the quietest.
 */
export const HERO_SIZE = {
  /** Today's readiness. */
  today: 132,
  /** The finished-session tonnage. */
  summary: 120,
  /** Plan, History by session, the workout library. */
  screen: 112,
  /** History by lift, the Tools interval clock. */
  detail: 104,
  /** Setup's step number and the Train weight. */
  step: 96,
} as const;

/**
 * Stacking order for everything that floats over a screen. Kept in one place
 * so the full-screen rest, the session summary and the bottom sheets agree on
 * who covers whom: a sheet opened from the rest screen must land on top of it.
 */
export const Z = {
  tabBar: 10,
  toast: 20,
  rest: 25,
  summary: 28,
  sheet: 30,
} as const;

/**
 * The smallest thing a thumb can reliably hit. Every button, chip and tile is
 * at least this tall and wide, even where the design drew it smaller.
 */
export const TOUCH = 44;

/** The device viewport the design was drawn against. */
export const DEVICE = { width: 412, height: 892 } as const;

/**
 * Below this width the phone frame is hidden and the app runs full-bleed.
 * Phones get the app, not a picture of a phone.
 */
export const FRAME_BREAKPOINT = 492;

/** Shared shadows. */
export const SHADOW = {
  card: '0 1px 2px rgba(20,20,16,.04)',
  raised: '0 4px 16px rgba(20,20,16,.07)',
  cta: '0 6px 18px rgba(245,158,11,.3)',
  toast: '0 10px 30px rgba(20,20,16,.25)',
  segment: '0 1px 2px rgba(20,20,16,.1)',
} as const;

/** Ring geometry, kept here because the dash arrays depend on the radii. */
export const RING = {
  /** Readiness dial: r=52 in a 120 viewBox. 2 * PI * 52. */
  readinessCircumference: 326.7,
  readinessSize: 126,
  /** Rest timer: r=34 in an 80 viewBox. 2 * PI * 34. */
  restCircumference: 213.6,
  restSize: 76,
} as const;
