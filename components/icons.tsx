// Icons from Lucide, behind the app's own names.
//
// A glyph like ✕ or ⋯ renders at whatever size, weight and baseline the
// system font gives it, so the same "icon" sat differently on every phone and
// read as a letter to screen readers. Hand-drawn replacements fixed that but
// some read as the wrong thing (the gear looked like a sun), so the drawings
// come from Lucide, a maintained set made to be read at small sizes. They all
// share one grid (24 units), one stroke (2px, round ends) and take their
// colour from the text around them, so a button's `color` is all it takes to
// tint one. Screens ask for an icon by name here and never import Lucide
// directly, so swapping one drawing is a one-line change in this file.

import type { CSSProperties } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Calculator,
  Calendar,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleQuestionMark,
  ClipboardList,
  Download,
  Dumbbell,
  Ellipsis,
  House,
  Minus,
  Pencil,
  Plus,
  Settings,
  Timer,
  X,
  type LucideIcon,
} from 'lucide-react';

type Glyph = { draw: LucideIcon; strokeWidth?: number };

const GLYPHS = {
  more: { draw: Ellipsis },
  close: { draw: X },
  // Heavier than the rest: a tick is usually drawn small, inside a chip.
  check: { draw: Check, strokeWidth: 2.5 },
  'chevron-down': { draw: ChevronDown },
  'chevron-up': { draw: ChevronUp },
  'chevron-right': { draw: ChevronRight },
  'chevron-left': { draw: ChevronLeft },
  'arrow-up': { draw: ArrowUp },
  'arrow-down': { draw: ArrowDown },
  edit: { draw: Pencil },
  help: { draw: CircleQuestionMark },
  plus: { draw: Plus },
  minus: { draw: Minus },
  gear: { draw: Settings },
  bell: { draw: Bell },
  timer: { draw: Timer },
  calculator: { draw: Calculator },
  import: { draw: Download },

  // The tab bar's five, kept here so every icon in the app is in one place.
  home: { draw: House },
  train: { draw: Dumbbell },
  plan: { draw: Calendar },
  history: { draw: ChartColumn },
  workouts: { draw: ClipboardList },
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
  const Drawing = glyph.draw;
  return (
    <Drawing
      size={size}
      color="currentColor"
      strokeWidth={strokeWidth ?? glyph.strokeWidth ?? 2}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-icon={name}
      // Never shrinks inside a flex row, because a squashed icon is a different
      // icon. Inline-block and middle-aligned so a plain button, which centres
      // its content like text, centres the icon too without needing flexbox.
      style={{ flex: 'none', display: 'inline-block', verticalAlign: 'middle', ...style }}
    />
  );
}
