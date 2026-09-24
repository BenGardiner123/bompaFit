'use client';

// Shared primitives. Everything visual comes from lib/tokens — no hex values
// and no dimensions live in a component.

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { C, FONT, R, SCRIM, SHADOW, TOUCH, Z, num, onInk } from '@/lib/tokens';

export function Card({
  children,
  style,
  radius = R.card,
  padded = true,
}: {
  children: ReactNode;
  style?: CSSProperties;
  radius?: number;
  padded?: boolean;
}) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.line}`,
        borderRadius: radius,
        padding: padded ? 16 : 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        boxShadow: SHADOW.card,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The 9px all-caps label used above every metric in the design. */
export function Eyebrow({ children, color = C.muted, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.16em', color, textTransform: 'uppercase', ...style }}>
      {children}
    </span>
  );
}

export function ScreenTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>{children}</h1>
      {right}
    </div>
  );
}

export function Tag({ children, bg, fg }: { children: ReactNode; bg: string; fg: string }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: '.08em',
        padding: '4px 7px',
        borderRadius: 6,
        background: bg,
        color: fg,
        flex: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

type ButtonProps = {
  onClick?: () => void;
  children: ReactNode;
  style?: CSSProperties;
  label?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
  /**
   * For toggles and one-of-many pickers. Announces "pressed" / "not pressed"
   * without changing the button's role, so it is still found as a button.
   */
  pressed?: boolean;
};

/** Base button. Resets the browser's styling and inherits the app font. */
export function Btn({ onClick, children, style, label, disabled, type = 'button', pressed }: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      style={{
        fontFamily: FONT,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        border: 'none',
        background: 'transparent',
        padding: 0,
        color: 'inherit',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** A selectable chip. `on` drives the dark-fill treatment from the design. */
export function Pill({
  on,
  onClick,
  children,
  label,
  style,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  label?: string;
  style?: CSSProperties;
}) {
  return (
    <Btn
      onClick={onClick}
      label={label}
      style={{
        flex: 'none',
        height: 38,
        padding: '0 14px',
        borderRadius: R.chip,
        fontSize: 12.5,
        fontWeight: 800,
        background: on ? C.ink : C.card,
        border: `1px solid ${on ? C.ink : C.lineStrong}`,
        color: on ? C.white : C.ink60,
        ...style,
      }}
    >
      {children}
    </Btn>
  );
}

/**
 * The light segmented control, for settings on the light sheet (units, week start).
 *
 * A labelled group of pressed/unpressed buttons rather than tabs: choosing an
 * option changes a setting, it does not swap a panel, so tab semantics would
 * promise a screen reader something that never happens. Same shape as the dark
 * InkSegmented.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  itemWidth,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Names the group for a screen reader, e.g. "Units". */
  label: string;
  itemWidth?: number;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: 'flex', gap: 4, background: C.sunkenAlt, borderRadius: R.small, padding: 3 }}
    >
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <Btn
            key={opt.value}
            onClick={() => onChange(opt.value)}
            pressed={on}
            style={{
              width: itemWidth,
              flex: itemWidth ? 'none' : 1,
              height: TOUCH,
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 800,
              background: on ? C.card : 'transparent',
              // ink60, not muted or tertiary: those read at 2.9:1 and 4.3:1 on
              // this grey track, under the 4.5:1 that 12.5px text needs.
              color: on ? C.ink : C.ink60,
              boxShadow: on ? SHADOW.segment : 'none',
            }}
          >
            {opt.label}
          </Btn>
        );
      })}
    </div>
  );
}

/** A big number with its unit, used across Today, History and Tools. */
export function Metric({
  label,
  value,
  unit,
  sub,
  color = C.ink,
  subColor = C.muted,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  color?: string;
  subColor?: string;
}) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.line}`,
        borderRadius: R.control,
        padding: '12px 11px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        minWidth: 0,
      }}
    >
      <Eyebrow style={{ letterSpacing: '.12em' }}>{label}</Eyebrow>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
        <span style={{ fontSize: 25, fontWeight: 800, lineHeight: 1.05, color, ...num }}>{value}</span>
        {unit && <span style={{ fontSize: 11, fontWeight: 700, color: C.tertiary }}>{unit}</span>}
      </div>
      <span style={{ fontSize: 10, fontWeight: 600, color: subColor }}>{sub ?? ' '}</span>
    </div>
  );
}

/** Rows of the design's "no data yet" treatment, rather than a blank space. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: `1px dashed ${C.lineStrong}`,
        borderRadius: R.chip,
        padding: 18,
        textAlign: 'center',
        fontSize: 12.5,
        color: C.tertiary,
        fontWeight: 700,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

export function Divider() {
  return <div style={{ height: 1, background: C.lineSoft }} />;
}

/** Horizontal scroller that hides its scrollbar — used by every chip row. */
export function Scroller({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="no-scrollbar" style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2, ...style }}>
      {children}
    </div>
  );
}

/** A ring gauge. Used by the readiness dial and the rest timer. */
export function Ring({
  size,
  viewBox,
  radius,
  stroke,
  circumference,
  progress,
  color,
  track,
  children,
}: {
  size: number;
  viewBox: number;
  radius: number;
  stroke: number;
  circumference: number;
  /** 0 → 1. */
  progress: number;
  color: string;
  track: string;
  children?: ReactNode;
}) {
  const clamped = Math.max(0, Math.min(1, progress));
  const centre = viewBox / 2;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg viewBox={`0 0 ${viewBox} ${viewBox}`} style={{ width: size, height: size, transform: 'rotate(-90deg)' }} aria-hidden>
        <circle cx={centre} cy={centre} r={radius} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={(circumference * (1 - clamped)).toFixed(1)}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ink hero and light sheet
//
// Every screen opens the same way: a dark block leading with one big number,
// then a light sheet that slides up over its bottom edge and holds the detail.
// ─────────────────────────────────────────────────────────────

/**
 * The dark header block. The 46px bottom padding is not wasted space: the
 * `Sheet` below pulls itself up 24px into it, so the hero's last content must
 * stop short of that overlap.
 */
export function Hero({
  children,
  urgent = false,
  gap = 6,
  style,
}: {
  children: ReactNode;
  /** The last seconds of a timer. Lifts the background so the change reads from across the room. */
  urgent?: boolean;
  gap?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: urgent ? C.ink80 : C.ink,
        color: onInk.text,
        padding: '14px 22px 46px',
        display: 'flex',
        flexDirection: 'column',
        gap,
        transition: 'background .2s ease',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The label row at the top of a hero: what the number is, and optional context on the right. */
export function HeroEyebrow({
  children,
  right,
  color = onInk.muted,
}: {
  children: ReactNode;
  /** Plain text is styled for you; a button (an `InkButton`) renders as it is. */
  right?: ReactNode;
  color?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color }}>{children}</span>
      {right !== undefined && (
        <span style={{ fontSize: 11.5, fontWeight: 700, color: onInk.muted, whiteSpace: 'nowrap', ...num }}>{right}</span>
      )}
    </div>
  );
}

/**
 * The one big number, with a two-line label beside it.
 *
 * The figure alone means nothing to a screen reader ("78" of what?), so the
 * visible block is hidden from assistive technology and `ariaLabel` is read
 * instead. It has to say the number *and* what it means.
 */
export function HeroNumeral({
  value,
  size,
  color = C.amber,
  label,
  labelColor = onInk.text,
  sub,
  subColor = onInk.muted,
  ariaLabel,
}: {
  value: ReactNode;
  /** From `HERO_SIZE`. */
  size: number;
  color?: string;
  /** Line one beside the number: 17px, white unless `labelColor` says otherwise. */
  label?: ReactNode;
  labelColor?: string;
  /** Line two, smaller: context such as "fatigue 41" or "↑ 9% on last week". */
  sub?: ReactNode;
  subColor?: string;
  /** Required. The whole thing as a sentence, e.g. "Readiness 78 out of 100, primed". */
  ariaLabel: string;
}) {
  const big = size >= 120;
  return (
    <div>
      <span className="sr-only">{ariaLabel}</span>
      <div aria-hidden style={{ display: 'flex', alignItems: 'flex-end', gap: big ? 12 : 10 }}>
        <span style={{ fontSize: size, fontWeight: 800, lineHeight: 0.82, letterSpacing: '-0.05em', color, ...num }}>{value}</span>
        {(label !== undefined || sub !== undefined) && (
          // The bottom padding lines the label up with the numeral's baseline
          // rather than the bottom of its box, which the tight line-height leaves lower.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingBottom: big ? 8 : 6, whiteSpace: 'nowrap' }}>
            {label !== undefined && <span style={{ fontSize: 17, fontWeight: 800, color: labelColor, ...num }}>{label}</span>}
            {sub !== undefined && <span style={{ fontSize: 12.5, fontWeight: 700, color: subColor, ...num }}>{sub}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** A sentence of body copy inside a hero. */
export function HeroText({ children, maxWidth }: { children: ReactNode; maxWidth?: number }) {
  return <p style={{ margin: 0, paddingTop: 8, fontSize: 14, lineHeight: 1.45, color: onInk.body, maxWidth }}>{children}</p>;
}

/**
 * Sub-navigation inside a hero: plain labels with an amber underline.
 *
 * Buttons with `aria-pressed` rather than ARIA tabs, matching how the app's
 * other pickers behave: each one is still found and announced as a button,
 * and says whether it is the one showing.
 */
export function HeroTabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Names the group for a screen reader, e.g. "Plan view". */
  label: string;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', gap: 22 }}>
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <Btn
            key={opt.value}
            onClick={() => onChange(opt.value)}
            pressed={on}
            style={{
              height: TOUCH,
              fontSize: 13.5,
              fontWeight: 800,
              color: on ? onInk.text : onInk.muted,
              // An inset shadow rather than a bottom border, so the underline
              // never fights the `border: none` reset on the base button.
              boxShadow: on ? `inset 0 -2.5px 0 ${C.amber}` : 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {opt.label}
          </Btn>
        );
      })}
    </div>
  );
}

/**
 * The light body under a hero. Pulls itself 24px up into the hero's bottom
 * padding so its rounded corners sit on the dark block.
 */
export function Sheet({ children, gap = 22, style }: { children: ReactNode; gap?: number; style?: CSSProperties }) {
  return (
    <div
      style={{
        // Positioned so it paints above the hero it overlaps. Without it, any
        // positioned marker inside the hero would draw on top of the sheet.
        position: 'relative',
        marginTop: -24,
        background: C.screen,
        color: C.ink,
        borderRadius: `${R.hero}px ${R.hero}px 0 0`,
        padding: '22px 18px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap,
        flex: 1,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * A titled group of rows on the light sheet. The title is a real heading
 * styled as an eyebrow, so a screen reader can jump from section to section.
 */
export function Section({
  title,
  right,
  titleColor = C.tertiary,
  children,
}: {
  title: ReactNode;
  /** Small text at the right of the title line, e.g. "You rearranged this week". */
  right?: ReactNode;
  titleColor?: string;
  children: ReactNode;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, paddingBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: titleColor, ...num }}>
          {title}
        </h2>
        {right !== undefined && <span style={{ fontSize: 11.5, fontWeight: 700, color: C.tertiary }}>{right}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * One line of a list: a hairline above it, no card around it.
 *
 * With `onClick` the main line becomes a button. Its accessible name is its
 * visible text, or `label` when that text would make a poor name (a line of
 * bare numbers, say). Because it is a button, `lead` and `right` must not hold
 * anything clickable; put extra controls in `children`, which render under
 * the line and outside the button.
 *
 * `dark` swaps the hairline and text colours for use inside an ink sheet.
 */
export function Row({
  title,
  sub,
  lead,
  right,
  onClick,
  label,
  dark = false,
  titleSize = 15,
  children,
  style,
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** Something before the title: an index number, a phase dot. */
  lead?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  label?: string;
  dark?: boolean;
  titleSize?: number;
  /** Rendered under the main line, e.g. the inline actions a row expands into. */
  children?: ReactNode;
  style?: CSSProperties;
}) {
  const line: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    minHeight: TOUCH,
    padding: '12px 0',
    textAlign: 'left',
    color: dark ? onInk.text : C.ink,
  };
  const body = (
    <>
      {lead}
      {/* minWidth 0 lets a long title shrink and wrap; a flex child otherwise refuses to go narrower than its text. */}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: titleSize, fontWeight: 800 }}>{title}</span>
        {sub !== undefined && <span style={{ fontSize: 12, fontWeight: 600, color: dark ? onInk.muted : C.tertiary, ...num }}>{sub}</span>}
      </span>
      {right}
    </>
  );

  return (
    <div style={{ borderTop: `1px solid ${dark ? onInk.line : C.line}`, display: 'flex', flexDirection: 'column', ...style }}>
      {onClick ? (
        <Btn onClick={onClick} label={label} style={line}>
          {body}
        </Btn>
      ) : (
        <div style={line}>{body}</div>
      )}
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Controls on ink
//
// Train and every bottom sheet are dark. These are the light controls
// re-coloured, so nothing on ink uses a grey that was tuned for white.
// ─────────────────────────────────────────────────────────────

export type InkButtonVariant = 'outline' | 'amber' | 'white' | 'ghost';

const INK_BUTTON: Record<InkButtonVariant, CSSProperties> = {
  outline: { background: 'transparent', border: `1px solid ${onInk.control}`, color: onInk.text },
  amber: { background: C.amber, border: 'none', color: C.ink },
  white: { background: C.white, border: 'none', color: C.ink },
  ghost: { background: 'transparent', border: 'none', color: C.amberLight },
};

/**
 * A button for dark surfaces.
 *
 * - `outline`, the default: a thin border and white text.
 * - `amber`: the one main action on a screen. Ink text, because white on amber
 *   can't be read.
 * - `white`: the strongest second action, e.g. "Skip rest".
 * - `ghost`: text only, amber-light by default. Pass `color` for a quieter one
 *   such as "Cancel".
 *
 * A `height` under 44 is raised to 44, so a small pill stays easy to hit.
 */
export function InkButton({
  children,
  onClick,
  variant = 'outline',
  height = 56,
  width,
  shape = 'rounded',
  color,
  fontSize,
  label,
  disabled,
  pressed,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: InkButtonVariant;
  /** The design uses 44, 56, 58, 60 and 64. */
  height?: number;
  width?: number | string;
  /** `pill` for header actions like "Finish" and "Minimise"; `circle` for a lone icon such as ✕. */
  shape?: 'rounded' | 'pill' | 'circle';
  /** Override the text colour, e.g. `C.redLight` for "Delete". */
  color?: string;
  fontSize?: number;
  label?: string;
  disabled?: boolean;
  pressed?: boolean;
  style?: CSSProperties;
}) {
  const h = Math.max(TOUCH, height);
  const radius = shape === 'rounded' ? (h >= 56 ? R.block : R.chip) : R.pill;
  return (
    <Btn
      onClick={onClick}
      label={label}
      disabled={disabled}
      pressed={pressed}
      style={{
        ...INK_BUTTON[variant],
        ...(color ? { color } : {}),
        height: h,
        width: shape === 'circle' ? h : width,
        minWidth: TOUCH,
        flex: 'none',
        padding: shape === 'circle' || variant === 'ghost' ? '0 4px' : '0 16px',
        borderRadius: radius,
        fontSize: fontSize ?? (h >= 58 ? 16 : h >= 50 ? 15 : 13),
        fontWeight: 800,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        whiteSpace: 'nowrap',
        ...num,
        ...style,
      }}
    >
      {children}
    </Btn>
  );
}

/**
 * A selectable chip on ink: lift chips, dark filter rows, RPE values.
 *
 * Selected is amber with ink text unless `selectedBg` / `selectedFg` say
 * otherwise; the RPE grid fills with the colour for that effort level.
 * `dashed` is the "+" add chip at the end of a row.
 */
export function InkChip({
  on,
  onClick,
  children,
  meta,
  label,
  dashed = false,
  selectedBg = C.amber,
  selectedFg = C.ink,
  height = TOUCH,
  style,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  /** A small trailing figure, e.g. "2/4" sets done on a lift chip. */
  meta?: ReactNode;
  label?: string;
  dashed?: boolean;
  selectedBg?: string;
  selectedFg?: string;
  height?: number;
  style?: CSSProperties;
}) {
  return (
    <Btn
      onClick={onClick}
      label={label}
      pressed={on}
      style={{
        flex: 'none',
        height: Math.max(TOUCH, height),
        minWidth: TOUCH,
        padding: '0 13px',
        borderRadius: R.chip,
        fontSize: 12.5,
        fontWeight: 800,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        whiteSpace: 'nowrap',
        background: on ? selectedBg : 'transparent',
        border: `1px ${dashed ? 'dashed' : 'solid'} ${on ? selectedBg : onInk.control}`,
        color: on ? selectedFg : onInk.body,
        ...num,
        ...style,
      }}
    >
      {children}
      {meta !== undefined && <span style={{ fontSize: 10.5, opacity: 0.7, ...num }}>{meta}</span>}
    </Btn>
  );
}

/** The segmented control on ink: set type, and anywhere else one of a few options is picked. */
export function InkSegmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Names the group for a screen reader, e.g. "Set type". */
  label: string;
}) {
  return (
    <div role="group" aria-label={label} style={{ flex: 1, display: 'flex', gap: 3, background: onInk.line, borderRadius: R.chip, padding: 3 }}>
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <Btn
            key={opt.value}
            onClick={() => onChange(opt.value)}
            pressed={on}
            style={{
              flex: 1,
              height: TOUCH,
              borderRadius: 9,
              fontSize: 12.5,
              fontWeight: 800,
              background: on ? C.white : 'transparent',
              color: on ? C.ink : onInk.body,
            }}
          >
            {opt.label}
          </Btn>
        );
      })}
    </div>
  );
}

/**
 * The big − / + tile either side of a figure on ink. `label` is required
 * because "−" on its own doesn't tell a screen reader what goes down.
 */
export function StepperTile({
  onClick,
  label,
  children,
  width = 64,
  height = 56,
  disabled,
}: {
  onClick: () => void;
  /** e.g. "Decrease weight". */
  label: string;
  /** Usually "−" or "+". */
  children: ReactNode;
  /** A number of pixels, or 'flex' to share a row equally with its neighbours. */
  width?: number | 'flex';
  height?: number;
  disabled?: boolean;
}) {
  return (
    <Btn
      onClick={onClick}
      label={label}
      disabled={disabled}
      style={{
        flex: width === 'flex' ? 1 : 'none',
        width: width === 'flex' ? undefined : Math.max(TOUCH, width),
        height: Math.max(TOUCH, height),
        borderRadius: R.block,
        border: `1px solid ${onInk.control}`,
        background: 'transparent',
        color: onInk.text,
        fontSize: 26,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </Btn>
  );
}

// ─────────────────────────────────────────────────────────────
// Dark bottom sheet
// ─────────────────────────────────────────────────────────────

/**
 * Calls `onClose` when Escape is pressed, only while `open` is true. Every
 * overlay closes this way, so this is the one copy of it to reach for.
 */
export function useEscapeKey(open: boolean, onClose: () => void) {
  // Kept in a ref so a caller passing a new arrow function every render
  // doesn't re-attach the listener on every tick of the rest timer.
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

/**
 * The shell for every bottom sheet: dimmed background, ink panel, grab handle,
 * header and close control. Renders nothing while `open` is false.
 *
 * Closes on Escape and on a tap on the dimmed area; a tap inside the panel
 * doesn't reach the dimmed area. Focus moves into the panel when it opens, so a
 * keyboard user starts inside the sheet rather than behind it, and goes back
 * to whatever opened it when it closes.
 *
 * The close control is a round ✕ unless `closeText` is given, which makes it a
 * text action instead: "Cancel" on a sheet holding unsaved changes, where a ✕
 * wouldn't say the changes are thrown away.
 */
export function DarkSheet({
  open,
  onClose,
  title,
  eyebrow,
  sub,
  label,
  titleSize = 26,
  closeText,
  gap = 18,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: ReactNode;
  /** A line under the title, e.g. the muscles a lift works. */
  sub?: ReactNode;
  /** The dialog's accessible name, when the title alone wouldn't say what the sheet is. Defaults to `title`. */
  label?: string;
  titleSize?: number;
  closeText?: string;
  gap?: number;
  children: ReactNode;
}) {
  useEscapeKey(open, onClose);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    return () => before?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label ?? title}
      onClick={onClose}
      style={{ position: 'absolute', inset: 0, zIndex: Z.sheet, background: SCRIM, display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="sheet"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxHeight: 'calc(100% - 44px)',
          overflowY: 'auto',
          background: C.ink,
          color: onInk.text,
          borderTop: `1px solid ${onInk.line}`,
          borderRadius: `${R.hero}px ${R.hero}px 0 0`,
          padding: '10px 18px 26px',
          display: 'flex',
          flexDirection: 'column',
          gap,
          // The panel only takes focus so keyboard users start inside it; a
          // focus ring round the whole sheet would just be noise.
          outline: 'none',
        }}
      >
        <span aria-hidden style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, background: onInk.control, flex: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            {eyebrow !== undefined && (
              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: onInk.muted, ...num }}>
                {eyebrow}
              </span>
            )}
            <h2 style={{ margin: 0, fontSize: titleSize, fontWeight: 800, letterSpacing: '-0.02em' }}>{title}</h2>
            {sub !== undefined && <span style={{ fontSize: 12.5, fontWeight: 600, color: onInk.muted }}>{sub}</span>}
          </div>
          {closeText ? (
            <InkButton variant="ghost" height={TOUCH} color={onInk.muted} fontSize={14} onClick={onClose}>
              {closeText}
            </InkButton>
          ) : (
            <InkButton shape="circle" height={TOUCH} fontSize={15} label="Close" onClick={onClose}>
              ✕
            </InkButton>
          )}
        </div>

        {children}
      </div>
    </div>
  );
}
