'use client';

// Views pushed over a tab: the interval timer and 1RM calculator from the
// Workouts tab's tools, and the settings too long for the Settings sheet
// (timer alerts, the default warm-up, where exercise instructions come from).
// Each has a plain light header with a way back, and keeps the tab bar lit on
// the tab it was opened from.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { brzycki, epley, fmtClock } from '@/lib/calc';
import { EXERCISE_SOURCES } from '@/lib/data';
import { weightMax, weightPrecision } from '@/lib/numberEntry';
import { C, HERO_SIZE, R, T, num, onInk } from '@/lib/tokens';
import { useBompa, type PushedView, type Tab } from '@/state/BompaContext';
import { AlertSettings } from '@/components/AlertSettings';
import { ContentProviders } from '@/components/ContentProviders';
import { DefaultWarmup } from '@/components/DefaultWarmup';
import { Icon } from '@/components/icons';
import { useIntervalAlerts } from '@/components/useTimerAlerts';
import { Btn, EditableNumber, Hero, HeroNumeral, HeroTabs, InkButton, InkChip, Row, Section, Tag } from '@/components/ui';

const TITLE: Record<PushedView, string> = {
  timer: 'Interval timer',
  calc: '1RM calculator',
  alerts: 'Alerts',
  warmup: 'Warm-up',
  content: 'Exercise instructions',
};

/** What the tab bar calls each tab, for the Back button's name. */
const TAB_NAME: Record<Tab, string> = { home: 'Today', log: 'Train', plan: 'Plan', stats: 'History', workouts: 'Workouts' };

export function PushedScreen() {
  const b = useBompa();
  const pushed = b.s.pushed;
  if (!pushed) return null;
  const back = pushed.from === 'settings' ? 'Settings' : TAB_NAME[b.s.tab];

  return (
    <div className="rise" style={{ flex: 1, display: 'flex', flexDirection: 'column', background: C.screen }}>
      <header style={{ padding: '4px 18px 10px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
        {/* Says where it goes, not just "Back": from Settings it reopens the
            sheet, which a bare arrow would not tell you. */}
        <Btn
          onClick={b.closeView}
          label={`Back to ${back}`}
          style={{
            height: 44,
            marginLeft: -8,
            padding: '0 8px 0 0',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            fontSize: T.md,
            fontWeight: 800,
            color: C.ink60,
          }}
        >
          <Icon name="chevron-left" size={20} />
          {back}
        </Btn>
        <h1 style={{ margin: 0, fontSize: T.xxl, fontWeight: 800, letterSpacing: '-0.02em' }}>{TITLE[pushed.view]}</h1>
      </header>
      {pushed.view === 'timer' ? <IntervalTimers /> : <Body view={pushed.view} />}
    </div>
  );
}

function Body({ view }: { view: Exclude<PushedView, 'timer'> }) {
  return (
    <div style={{ padding: '6px 18px 24px', display: 'flex', flexDirection: 'column', gap: 26 }}>
      {view === 'calc' && <OneRepMax />}
      {view === 'alerts' && <AlertSettings />}
      {view === 'warmup' && <DefaultWarmup />}
      {view === 'content' && (
        <>
          <InstructionSources />
          <ContentProviders />
        </>
      )}
    </div>
  );
}

/** What ships with the app, so it is clear the How-to cues need no service at all. */
function InstructionSources() {
  return (
    <Section title="Exercise instruction library">
      {EXERCISE_SOURCES.map((source) => {
        const bundled = source.status === 'BUNDLED';
        return (
          <Row
            key={source.name}
            title={source.name}
            titleSize={14}
            sub={source.detail}
            right={
              <Tag bg={bundled ? C.greenBg : C.tagBg} fg={bundled ? C.greenDark : C.ink60}>
                {source.status}
              </Tag>
            }
          />
        );
      })}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────

type TimerMode = 'stopwatch' | 'amrap' | 'emom';

const TIMER_MODES: { value: TimerMode; label: string }[] = [
  { value: 'stopwatch', label: 'Stopwatch' },
  { value: 'amrap', label: 'AMRAP' },
  { value: 'emom', label: 'EMOM' },
];

/**
 * All three modes run off a single wall-clock anchor rather than a counter, for
 * the same reason the rest timer does: a backgrounded tab stops ticking, and a
 * timer that quietly loses thirty seconds is worse than no timer.
 */
function IntervalTimers() {
  const [mode, setMode] = useState<TimerMode>('stopwatch');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [accumulated, setAccumulated] = useState(0);
  const [capMinutes, setCapMinutes] = useState(12);
  const [intervalMinutes, setIntervalMinutes] = useState(1);
  const [, force] = useState(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  // The interval only asks for a re-render; the time shown is always
  // recomputed from Date.now(), so a throttled or skipped tick costs nothing.
  useEffect(() => {
    if (startedAt === null) return;
    tick.current = setInterval(() => force((n) => n + 1), 250);
    return () => {
      if (tick.current) clearInterval(tick.current);
    };
  }, [startedAt]);

  const elapsedMs = accumulated + (startedAt === null ? 0 : Date.now() - startedAt);
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const running = startedAt !== null;

  const capSec = capMinutes * 60;
  const remaining = Math.max(0, capSec - elapsedSec);
  const round = Math.floor(elapsedSec / (intervalMinutes * 60)) + 1;
  const intoRound = elapsedSec % (intervalMinutes * 60);
  const roundRemaining = intervalMinutes * 60 - intoRound;

  const clock = mode === 'stopwatch' ? fmtClock(elapsedSec) : mode === 'amrap' ? fmtClock(remaining) : fmtClock(roundRemaining);
  const caption =
    mode === 'stopwatch'
      ? 'counting up'
      : mode === 'amrap'
        ? remaining === 0
          ? 'time'
          : `of ${capMinutes} min`
        : `round ${round} · every ${intervalMinutes} min`;
  const spoken =
    mode === 'stopwatch'
      ? `Stopwatch ${clock}`
      : mode === 'amrap'
        ? remaining === 0
          ? `Time is up on the ${capMinutes} minute cap`
          : `${clock} left of ${capMinutes} minutes`
        : `${clock} left in round ${round}, every ${intervalMinutes} minutes`;

  useIntervalAlerts({ mode, startedAt, accumulatedMs: accumulated, capMs: capMinutes * 60_000, intervalMs: intervalMinutes * 60_000 });

  const urgent = (mode === 'amrap' && remaining <= 10 && running) || (mode === 'emom' && roundRemaining <= 3 && running);

  // Urgent lifts the hero to ink80, where the usual grey caption drops below
  // readable. Small text switches to the brighter body colour; only the big
  // clock is allowed the red.
  const small = urgent ? onInk.body : onInk.muted;
  const clockColor = urgent ? C.redLight : running ? C.amber : onInk.text;

  const toggle = () => {
    if (running) {
      setAccumulated(elapsedMs);
      setStartedAt(null);
    } else {
      setStartedAt(Date.now());
    }
  };

  const reset = () => {
    setStartedAt(null);
    setAccumulated(0);
  };

  const options = mode === 'amrap' ? [8, 12, 15, 20] : [1, 2, 3, 5];

  return (
    // A dark card under the light header rather than a full-width hero: the
    // clock still reads from across the room, and the header above it says
    // which screen this is.
    <Hero urgent={urgent} gap={14} style={{ margin: '4px 18px 24px', padding: '16px 18px 20px', borderRadius: R.card }}>
      <HeroTabs
        value={mode}
        options={TIMER_MODES}
        label="Timer mode"
        onChange={(next) => {
          setMode(next);
          reset();
        }}
      />

      <div role="timer" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 0 4px' }}>
        <span aria-hidden style={{ fontSize: T.xs, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: small, ...num }}>
          {caption}
        </span>
        <HeroNumeral value={clock} size={HERO_SIZE.detail} color={clockColor} ariaLabel={spoken} />
      </div>

      {mode !== 'stopwatch' && (
        <div role="group" aria-label={mode === 'amrap' ? 'Time cap' : 'Interval length'} style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
          {options.map((value) => (
            <InkChip
              key={value}
              on={mode === 'amrap' ? capMinutes === value : intervalMinutes === value}
              onClick={() => {
                if (mode === 'amrap') setCapMinutes(value);
                else setIntervalMinutes(value);
                reset();
              }}
              style={{ minWidth: 52, fontSize: T.note }}
            >
              {value}m
            </InkChip>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {/* White while running: amber is the invitation to start, so once the
            clock is going the button steps back to say "you can stop this". */}
        <InkButton onClick={toggle} variant={running ? 'white' : 'amber'} fontSize={T.lg} style={{ flex: 1 }}>
          {running ? 'Pause' : elapsedMs > 0 ? 'Resume' : 'Start'}
        </InkButton>
        <InkButton onClick={reset} width={100} fontSize={T.md}>
          Reset
        </InkButton>
      </div>

      <span style={{ fontSize: T.hint, fontWeight: 600, color: small, textAlign: 'center' }}>
        Runs off the wall clock, so it keeps time with the phone locked.
      </span>
    </Hero>
  );
}


// ─────────────────────────────────────────────────────────────

function OneRepMax() {
  const b = useBompa();
  const { s } = b;
  const step = s.unit === 'kg' ? 2.5 : 5;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 2 }}>
      <CalcStepper
        label="Weight"
        value={s.calcWeight}
        unit={s.unit}
        min={step}
        max={weightMax(s.unit)}
        precision={weightPrecision(s.unit)}
        onSet={(calcWeight) => b.patch({ calcWeight })}
        onDown={() => b.patch({ calcWeight: Math.max(step, s.calcWeight - step) })}
        onUp={() => b.patch({ calcWeight: s.calcWeight + step })}
      />
      <CalcStepper
        label="Reps"
        value={s.calcReps}
        unit="reps"
        min={1}
        max={CALC_REPS_MAX}
        precision={1}
        onSet={(calcReps) => b.patch({ calcReps })}
        onDown={() => b.patch({ calcReps: Math.max(1, s.calcReps - 1) })}
        onUp={() => b.patch({ calcReps: Math.min(CALC_REPS_MAX, s.calcReps + 1) })}
      />

      {/* Epley is drawn twice the size because it is the number the rest of
          the app uses; Brzycki sits small on the right as a cross-check. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 10,
          paddingTop: 12,
          borderTop: `1px solid ${C.line}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <ResultLabel color={C.ink}>Epley</ResultLabel>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span style={{ fontSize: T.stat, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.03em', ...num }}>
              {epley(s.calcWeight, s.calcReps).toFixed(1)}
            </span>
            <UnitLabel>{s.unit}</UnitLabel>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
          <ResultLabel color={C.tertiary}>Brzycki</ResultLabel>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span style={{ fontSize: T.xl, fontWeight: 800, color: C.ink60, ...num }}>{brzycki(s.calcWeight, s.calcReps).toFixed(1)}</span>
            <UnitLabel>{s.unit}</UnitLabel>
          </div>
        </div>
      </div>

      <span style={{ fontSize: T.caption, lineHeight: 1.5, color: C.tertiary }}>
        Epley is the estimate Bompa uses everywhere else. Brzycki is here as a second opinion — it runs low at high reps and drifts badly past
        twelve, which is why reps stop there.
      </span>
    </div>
  );
}

/** Past twelve reps both estimators drift too far to be worth showing. */
const CALC_REPS_MAX = 12;

function CalcStepper({
  label,
  value,
  unit,
  min,
  max,
  precision,
  onSet,
  onUp,
  onDown,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  precision: number;
  /** A typed value, already rounded and clamped. */
  onSet: (value: number) => void;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <RoundBtn onClick={onDown} label={`Decrease ${label}`}>
        <Icon name="minus" />
      </RoundBtn>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <EditableNumber
          label={label}
          unit={unit}
          value={value}
          min={min}
          max={max}
          precision={precision}
          onCommit={onSet}
          style={{ fontSize: T.entry, fontWeight: 800 }}
        />
        <span style={{ fontSize: T.note, fontWeight: 800, color: C.tertiary }}>{unit}</span>
      </div>
      <RoundBtn onClick={onUp} label={`Increase ${label}`}>
        <Icon name="plus" />
      </RoundBtn>
    </div>
  );
}

function RoundBtn({ children, onClick, label }: { children: ReactNode; onClick: () => void; label: string }) {
  return (
    <Btn
      onClick={onClick}
      label={label}
      style={{
        width: 48,
        height: 48,
        flex: 'none',
        borderRadius: R.pill,
        border: `1px solid ${C.lineStrong}`,
        background: C.card,
        color: C.ink,
        fontSize: T.xl,
      }}
    >
      {children}
    </Btn>
  );
}

function ResultLabel({ children, color }: { children: ReactNode; color: string }) {
  // Typed in title case and upper-cased by CSS, so the text a screen reader
  // (and a test) finds is the word, not an acronym-looking shout.
  return <span style={{ fontSize: T.xs, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color }}>{children}</span>;
}

function UnitLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: T.note, fontWeight: 700, color: C.tertiary }}>{children}</span>;
}

