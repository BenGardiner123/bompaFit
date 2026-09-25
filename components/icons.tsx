// Icons drawn as SVG rather than borrowed from the font.
//
// A glyph like ✕ or ⋯ renders at whatever size, weight and baseline the
// system font gives it, so the same "icon" sat differently on every phone and
// read as a letter to screen readers. These all share one grid (24 units),
// one stroke (2px, round ends) and take their colour from the text around
// them, so a button's `color` is all it takes to tint one.

import type { CSSProperties, ReactNode } from 'react';

type Glyph = { draw: ReactNode; strokeWidth?: number; filled?: boolean };

const GLYPHS = {
  // Filled rather than stroked: three dots drawn as rings disappear at 16px.
  more: {
    filled: true,
    draw: (
      <>
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </>
    ),
  },
  close: { draw: <path d="M6 6l12 12M18 6L6 18" /> },
  // Heavier than the rest: a tick is usually drawn small, inside a chip.
  check: { strokeWidth: 2.5, draw: <path d="M5 12.5l4.5 4.5L19 7.5" /> },
  'chevron-down': { draw: <path d="M6 9l6 6 6-6" /> },
  'chevron-up': { draw: <path d="M6 15l6-6 6 6" /> },
  'chevron-right': { draw: <path d="M9 6l6 6-6 6" /> },
  'chevron-left': { draw: <path d="M15 6l-6 6 6 6" /> },
  'arrow-up': { draw: <path d="M12 19V5M6 11l6-6 6 6" /> },
  'arrow-down': { draw: <path d="M12 5v14M6 13l6 6 6-6" /> },
  edit: { draw: <path d="M4 20h4L19 9l-4-4L4 16z" /> },
  help: {
    draw: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.5M12 17h.01" />
      </>
    ),
  },
  plus: { draw: <path d="M12 5v14M5 12h14" /> },
  minus: { draw: <path d="M5 12h14" /> },
  gear: {
    draw: (
      <>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
      </>
    ),
  },
  timer: {
    draw: (
      <>
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2.5 2M10 2h4" />
      </>
    ),
  },
  calculator: {
    draw: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2" />
      </>
    ),
  },
  import: { draw: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" /> },

  // The tab bar's five, kept here so every icon in the app is in one place.
  home: { draw: <path d="M4 11.5 12 4l8 7.5V20h-5v-6H9v6H4z" /> },
  train: { draw: <path d="M4 9h2v6H4zM18 9h2v6h-2zM6 12h12M8 7v10M16 7v10" /> },
  plan: { draw: <path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" /> },
  history: { draw: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /> },
  workouts: { draw: <path d="M6 3h12v18H6zM9.5 8h5M9.5 12h5M9.5 16h3" /> },
} satisfies Record<string, Glyph>;

export type IconName = keyof typeof GLYPHS;

/** Every icon's name, for tests that want to render the lot. */
export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];

/**
 * One icon, tinted by the surrounding text colour.
 *
 * Hidden from screen readers by default, because an icon almost always sits
 * inside a button that already has a name — reading "close, image" after
 * "Close" is noise. Pass `label` for the rare icon that stands alone.
 */
export function Icon({
  name,
  size = 20,
  strokeWidth,
  label,
  style,
}: {
  name: IconName;
  size?: number;
  /** Overrides the icon's own stroke, e.g. a heavier close at 16px. */
  strokeWidth?: number;
  label?: string;
  style?: CSSProperties;
}) {
  const glyph: Glyph = GLYPHS[name];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={glyph.filled ? 'currentColor' : 'none'}
      stroke={glyph.filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth ?? glyph.strokeWidth ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-icon={name}
      // Never shrinks inside a flex row, because a squashed icon is a different
      // icon. Inline-block and middle-aligned so a plain button, which centres
      // its content like text, centres the icon too without needing flexbox.
      style={{ flex: 'none', display: 'inline-block', verticalAlign: 'middle', ...style }}
    >
      {glyph.draw}
    </svg>
  );
}
