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
  /**
   * The border of a done chip on a light surface. `greenBg` alone is too close
   * to the white card to read as a shape, and `green` as a border shouts; this
   * sits between them.
   */
  greenBd: '#A7E3CC',

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
  /** Blue for text and marks on `ink`. 7.3:1 there. */
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
  /**
   * A card one step up from ink that is not a control: the just-logged set on
   * the rest screen. Darker than `line`, so a hairline drawn in `line` still
   * shows round its edge.
   */
  raised: '#1F1F1A',
} as const;

/**
 * Marks drawn on an amber fill. The selected lift chip on Train is amber, and
 * its progress bar sits inside it: ink at 22% for the track, so the bar reads
 * as part of the chip rather than a stripe across it.
 */
export const onAmber = { track: 'rgba(20,20,16,.22)' } as const;

/** Background dimming behind every bottom sheet. Deeper than a light scrim so the ink sheet still stands off the dark Train screen. */
export const SCRIM = 'rgba(0,0,0,.55)';

/**
 * Training-phase colours: the macrocycle strip, block rows, the library's
 * phase squares.
 *
 * Muted, light, and deliberately none of the status colours. Phases used to be
 * blue, green, amber and red, which made a strength block the same green as a
 * finished set and a peak block look like an error. Status colours now mean
 * state only (done, danger, needs you), so a phase has to be told apart from
 * them at a glance. A test pins that none of these equals one.
 */
export const PH: Record<Phase, string> = {
  hypertrophy: '#C9BCE6', // muted lilac
  strength: '#9ED3CB', // muted teal
  power: '#E6BFA8', // clay
  peak: '#A9BDE8', // slate blue
  deload: '#D6D2C8', // warm grey
};

export const PHASE_LABEL: Record<Phase, string> = {
  hypertrophy: 'Hypertrophy',
  strength: 'Strength',
  power: 'Power',
  peak: 'Peak',
  deload: 'Deload',
};

/**
 * Text colour for a label sitting *on* a phase-coloured fill. Every phase fill
 * is light, so ink clears 9:1 on all of them and white fails on all of them.
 */
export const ON_PHASE = C.ink;

/**
 * A phase's colour for a number printed on `ink`. The phase fills are all light
 * enough to read as text on ink, so these are the same values. The name stays
 * so a component says which job the colour is doing.
 */
export const PH_ON_INK: Record<Phase, string> = { ...PH };

/** Short labels for the macrocycle strip, where space is 3 characters at most. */
export const PHASE_ABBR: Record<Phase, string> = {
  hypertrophy: 'HYP',
  strength: 'STR',
  power: 'PWR',
  peak: 'PK',
  deload: 'D',
};

/**
 * The type scale. Every step the app uses more than once lives here, and new
 * code reaches for one of these rather than a number. The hero numerals have
 * their own scale in `HERO_SIZE`.
 *
 * Some older screens still write these same values as literals. Moving them
 * over changes nothing on screen; it just has not been done everywhere yet.
 *
 * `xs` is a floor, not just the smallest step: nothing is set smaller than
 * 11px. Labels at 9 and 10px could not be read at arm's length on a bench,
 * which is where this app gets read. A test scans the components for anything
 * under it.
 */
export const T = {
  /** Eyebrows, tags, tab labels, units. The floor. */
  xs: 11,
  /** Small labels a touch above the floor, such as a tile's caption. */
  hint: 11.5,
  /** The line under a row title: a block's dates, a phase's detail, a footnote. */
  caption: 12,
  /** Captions, sub-lines, meta. */
  sm: 12.5,
  /** Explanatory sentences in a card, and small bold labels such as a unit. */
  note: 13,
  /** Sheet buttons and the body copy of an empty state. */
  copy: 13.5,
  /** Body text and most buttons. */
  md: 14,
  /** Row titles in lists and sheets: a block, a workout, a settings row. */
  title: 15,
  /** Row titles and emphasised values. */
  lg: 16,
  /** Section figures, such as a metric's value. */
  xl: 22,
  /** A count in a summary grid, such as the import preview's table totals. */
  count: 24,
  /** Screen and sheet titles. */
  xxl: 26,
  /** A number typed straight into a tool, such as the plate calculator's fields. */
  entry: 34,
  /** A result that is the point of its card but not the screen's hero, such as the one-rep-max estimate. */
  stat: 44,
  /** The large in-card figure, such as reps on Train. */
  figure: 48,
} as const;

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
  /** A small text tag, such as a workout's phase tag or a status tag. */
  tag: 6,
  /** A phase swatch, and the top corners of a bar in a chart. */
  swatch: 3,
  /** A thin progress bar, or a marker drawn on one. */
  bar: 2,
  pill: 999,
} as const;

/**
 * Hero numeral sizes. One big number leads every screen, and the size says how
 * much that number matters on its screen — readiness is the loudest thing in
 * the app, a step counter in setup the quietest.
 */
export const HERO_SIZE = {
  /** Today's readiness. */
  today: 120,
  /** Tomorrow's readiness on the finish summary. Smaller than Today's: it is a forecast, and the verdict above it leads. */
  summary: 96,
  /** Plan and History by session. */
  screen: 112,
  /** History by lift, the interval timer. */
  detail: 104,
  /** The Train weight. */
  step: 96,
  /** The rest screen's clock inside its ring. */
  restClock: 72,
  /**
   * The rest screen's last ten seconds, when the count fills the screen. The
   * loudest number in the app on purpose: it is read from across the room.
   */
  restFinal: 240,
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
  /**
   * A toast raised while the Settings sheet is open, so what export and restore
   * say is not drawn underneath the sheet that caused it.
   */
  toastOverSheet: 31,
} as const;

/**
 * The smallest thing a thumb can reliably hit. Every button, chip and tile is
 * at least this tall and wide, even where the design drew it smaller.
 */
export const TOUCH = 44;

/**
 * The drawn height of a compact list row, such as a week's slots on Plan. The
 * trailing 44px control already sets the height, so the row only adds 4px of
 * air above and below it rather than a full 12px of padding on top.
 */
export const ROW_COMPACT = 52;

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
