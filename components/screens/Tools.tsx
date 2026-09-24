'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { brzycki, epley, fmtClock, toDisplay, toKg } from '@/lib/calc';
import { BODYWEIGHT_MAX_KG } from '@/lib/bodyweight';
import { db, isPersisted } from '@/lib/db';
import { weightMax, weightPrecision } from '@/lib/numberEntry';
import { buildEnvelope, downloadEnvelope } from '@/lib/exchange';
import { C, HERO_SIZE, R, TOUCH, num, onInk } from '@/lib/tokens';
import type { Unit } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { AlertSettings } from '@/components/AlertSettings';
import { useIntervalAlerts } from '@/components/useTimerAlerts';
import { Btn, EditableNumber, Hero, HeroNumeral, HeroTabs, InkButton, InkChip, Row, Section, Segmented, Sheet } from '@/components/ui';
import { StartingMaxes } from '@/components/StartingMaxes';
import { ImportPreview, useImport } from '@/components/ImportPreview';
import { ContentProviders } from '@/components/ContentProviders';

export function Tools() {
  return (
    <div className="rise" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* The hero leads with the clock, not a title, so the screen's name is
          kept for screen readers that navigate by heading. */}
      <h1 className="sr-only">Tools</h1>
      <IntervalTimers />
      <Sheet gap={26}>
        <RestPresets />
        <AlertSettings />
        <OneRepMax />
        <StartingMaxes />
        <Settings />
        <ContentProviders />
        <Credit />
      </Sheet>
    </div>
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
    <Hero urgent={urgent} gap={14} style={{ paddingTop: 4 }}>
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
        <span aria-hidden style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: small, ...num }}>
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
              style={{ minWidth: 52, fontSize: 13 }}
            >
              {value}m
            </InkChip>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {/* White while running: amber is the invitation to start, so once the
            clock is going the button steps back to say "you can stop this". */}
        <InkButton onClick={toggle} variant={running ? 'white' : 'amber'} fontSize={16} style={{ flex: 1 }}>
          {running ? 'Pause' : elapsedMs > 0 ? 'Resume' : 'Start'}
        </InkButton>
        <InkButton onClick={reset} width={100} fontSize={14}>
          Reset
        </InkButton>
      </div>

      <span style={{ fontSize: 11.5, fontWeight: 600, color: small, textAlign: 'center' }}>
        Runs off the wall clock, so it keeps time with the phone locked.
      </span>
    </Hero>
  );
}

// ─────────────────────────────────────────────────────────────

function RestPresets() {
  const b = useBompa();
  return (
    <Section title="Rest timer" right="auto-starts on log">
      <div role="group" aria-label="Rest length" style={{ display: 'flex', gap: 7, paddingTop: 2 }}>
        {[60, 90, 150, 240].map((seconds) => {
          const on = b.s.restPresetSec === seconds;
          return (
            <Btn
              key={seconds}
              onClick={() => b.setRestPreset(seconds)}
              pressed={on}
              style={{
                flex: 1,
                height: 52,
                borderRadius: R.control,
                fontSize: 14,
                fontWeight: 800,
                background: on ? C.ink : 'transparent',
                border: `1px solid ${on ? C.ink : C.lineStrong}`,
                color: on ? C.white : C.ink60,
                ...num,
              }}
            >
              {fmtClock(seconds)}
            </Btn>
          );
        })}
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────

function OneRepMax() {
  const b = useBompa();
  const { s } = b;
  const step = s.unit === 'kg' ? 2.5 : 5;

  return (
    <Section title="1RM calculator">
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
            <ResultLabel color={C.amberDark}>Epley</ResultLabel>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
              <span style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.03em', ...num }}>
                {epley(s.calcWeight, s.calcReps).toFixed(1)}
              </span>
              <UnitLabel>{s.unit}</UnitLabel>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
            <ResultLabel color={C.tertiary}>Brzycki</ResultLabel>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: C.ink60, ...num }}>{brzycki(s.calcWeight, s.calcReps).toFixed(1)}</span>
              <UnitLabel>{s.unit}</UnitLabel>
            </div>
          </div>
        </div>

        <span style={{ fontSize: 12, lineHeight: 1.5, color: C.tertiary }}>
          Epley is the estimate Bompa uses everywhere else. Brzycki is here as a second opinion — it runs low at high reps and drifts badly past
          twelve, which is why reps stop there.
        </span>
      </div>
    </Section>
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
        −
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
          style={{ fontSize: 34, fontWeight: 800 }}
        />
        <span style={{ fontSize: 13, fontWeight: 800, color: C.tertiary }}>{unit}</span>
      </div>
      <RoundBtn onClick={onUp} label={`Increase ${label}`}>
        +
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
        fontSize: 22,
      }}
    >
      {children}
    </Btn>
  );
}

function ResultLabel({ children, color }: { children: ReactNode; color: string }) {
  // Typed in title case and upper-cased by CSS, so the text a screen reader
  // (and a test) finds is the word, not an acronym-looking shout.
  return <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color }}>{children}</span>;
}

function UnitLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 13, fontWeight: 700, color: C.tertiary }}>{children}</span>;
}

// ─────────────────────────────────────────────────────────────

function Settings() {
  const b = useBompa();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void isPersisted().then(setPersisted);
  }, []);

  const exportJson = async () => {
    try {
      const envelope = await buildEnvelope(new Date().toISOString());
      downloadEnvelope(envelope, `bompa-${new Date().toISOString().slice(0, 10)}.json`);
      b.say('Exported. That file is a complete backup.');
    } catch {
      b.say("Couldn't read the database to export it.");
    }
  };

  // Same flow as the workout library: the file is read and shown first, and
  // nothing is written until "Import it". A backup restore is the import most
  // worth a second look.
  const importer = useImport();

  const outline = {
    flex: 1,
    borderRadius: R.control,
    border: `1px solid ${C.lineStrong}`,
    background: 'transparent',
    color: C.ink,
    fontSize: 13,
    fontWeight: 800,
  } as const;

  return (
    <Section title="Settings">
      <Row
        title="Units"
        titleSize={14}
        right={
          <Segmented
            value={b.s.unit}
            label="Units"
            itemWidth={52}
            options={[
              { value: 'kg' as Unit, label: 'KG' },
              { value: 'lb' as Unit, label: 'LB' },
            ]}
            onChange={b.setUnit}
          />
        }
      />

      <Row
        title="Week starts"
        titleSize={14}
        right={
          <Segmented
            value={b.s.weekStart}
            label="Week starts"
            itemWidth={70}
            options={[
              { value: 'Mon' as const, label: 'Monday' },
              { value: 'Sun' as const, label: 'Sunday' },
            ]}
            onChange={b.setWeekStart}
          />
        }
      />

      <Bodyweight />

      <Row
        title="On-device data"
        titleSize={14}
        sub={`${b.sessions.length} sessions · ${b.sets.length} sets · ${
          persisted === null ? 'checking storage' : persisted ? 'protected from eviction' : 'not protected'
        }`}
        right={
          <span
            role="img"
            aria-label={b.s.storageOk ? 'Saving to this device' : 'Not saving to this device'}
            style={{ width: 8, height: 8, borderRadius: R.pill, background: b.s.storageOk ? C.green : C.red, flex: 'none' }}
          />
        }
      />

      <div style={{ display: 'flex', gap: 7, padding: '12px 0', borderTop: `1px solid ${C.line}` }}>
        <Btn onClick={exportJson} style={{ ...outline, height: 48 }}>
          Export JSON
        </Btn>
        <Btn onClick={() => fileInput.current?.click()} style={{ ...outline, height: 48 }}>
          Import JSON
        </Btn>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Bompa backup file"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importer.choose(file);
            event.target.value = '';
          }}
        />
      </div>
      {importer.preview && (
        <div style={{ paddingBottom: 12 }}>
          <ImportPreview preview={importer.preview} onCommit={importer.commit} onCancel={importer.cancel} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, paddingBottom: 10 }}>
        <Btn onClick={b.restartSetup} style={{ ...outline, height: TOUCH }}>
          Run setup again
        </Btn>
        <Btn
          onClick={async () => {
            if (!window.confirm('Delete every session, set and plan on this device? This cannot be undone.')) return;
            await db.delete();
            window.location.reload();
          }}
          style={{ ...outline, height: TOUCH, border: `1px solid ${C.redBd}`, background: C.redBg, color: C.redDark }}
        >
          Erase everything
        </Btn>
      </div>
      <span style={{ fontSize: 12, lineHeight: 1.5, color: C.tertiary }}>
        Running setup again replaces your plan. Workouts, logged sets and history all stay.
      </span>
    </Section>
  );
}

/**
 * One number, not a tracker: no history and no graph, because tracking
 * bodyweight is not what Bompa is for. It exists so pull-ups and dips cost
 * something in the fatigue model. Typed in the display unit and converted to
 * kilograms once, on the way in.
 */
function Bodyweight() {
  const b = useBompa();
  const { unit } = b.s;
  const kg = b.bodyweightKg;
  return (
    <Row
      title="Your bodyweight"
      titleSize={14}
      sub="Counts pull-ups, dips, push-ups and other bodyweight lifts toward fatigue and readiness. Type 0 to clear it."
      right={
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, flex: 'none' }}>
          <EditableNumber
            label="Your bodyweight"
            unit={unit}
            value={kg === null ? 0 : toDisplay(kg, unit)}
            min={0}
            max={toDisplay(BODYWEIGHT_MAX_KG, unit)}
            precision={weightPrecision(unit)}
            onCommit={(next) => b.setBodyweightKg(next > 0 ? toKg(next, unit) : null)}
            {...(kg === null ? { display: '—', spoken: 'Your bodyweight not set', openEmpty: true } : {})}
            style={{ minWidth: 50, fontSize: 15, fontWeight: 800 }}
          />
          <UnitLabel>{unit}</UnitLabel>
        </div>
      }
    />
  );
}

function Credit() {
  const b = useBompa();
  return (
    <span style={{ fontSize: 11.5, lineHeight: 1.5, color: C.tertiary, textAlign: 'center' }}>
      Movement library from{' '}
      <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener noreferrer">
        Free Exercise DB
      </a>. Everything you log stays on this device — {b.s.storageOk ? 'no account, no server' : 'storage is unavailable, running from memory'}.
    </span>
  );
}
