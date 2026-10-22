'use client';

import { useState, type ReactNode } from 'react';
import { fmtDate, toDisplay } from '@/lib/calc';
import {
  bestSet,
  fmtShortDay,
  fmtVolume,
  liftSparkline,
  liftTrend,
  liftVolume,
  loggedLifts,
  monthTicks,
  personalRecords,
  recentLiftDays,
  volumeUnit,
} from '@/lib/history';
import { C, HERO_SIZE, R, T, W, num, onInk } from '@/lib/tokens';
import type { Unit } from '@/lib/types';
import { weightShort } from '@/lib/bodyweight';
import { useBompa } from '@/state/BompaContext';
import { ChipTrack, Empty, Hero, HeroEyebrow, HeroNumeral, InkSegmented, Row, Section, Sheet } from '@/components/ui';
import { SessionHistory } from '@/components/screens/SessionHistory';
import { StartingMaxes } from '@/components/StartingMaxes';

type View = 'session' | 'lift';

export function History() {
  // Two axes on the same data. By session answers "what did I do on
  // Tuesday"; by lift answers "how is my squat going". Slicing by lift alone
  // made the first question unanswerable, because one session's lifts
  // scatter across as many chips as it had exercises.
  const [view, setView] = useState<View>('session');

  // The title and the switch between the two views share the hero's first line.
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: W.title, letterSpacing: '-0.03em' }}>History</h1>
      <InkSegmented
        label="History view"
        value={view}
        fit
        options={[
          { value: 'session', label: 'By session' },
          { value: 'lift', label: 'By lift' },
        ]}
        onChange={setView}
      />
    </div>
  );

  return (
    <div className="rise" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {view === 'session' ? <SessionHistory header={header} /> : <LiftHistory header={header} />}
    </div>
  );
}

/** The By lift view: estimated max and its twelve-week curve, then records and recent days. */
function LiftHistory({ header }: { header: ReactNode }) {
  const b = useBompa();
  const { s } = b;

  // Only lifts you have actually trained get a chip; the catalogue has
  // hundreds, and a chip for a lift never done leads to an empty page. If
  // the remembered lift has no history yet, show the most recent one that
  // does rather than opening on nothing.
  const logged = loggedLifts(b.sets);
  const liftId = logged.includes(s.statsLift) || logged.length === 0 ? s.statsLift : logged[0]!;
  const rows = b.setsByExercise.get(liftId) ?? [];
  const name = b.exerciseById.get(liftId)?.name ?? liftId;

  const e1rm = b.e1rmByExercise[liftId] ?? 0;
  const { points: spark, from: sparkFrom } = liftSparkline(rows, b.now);
  const ticks = monthTicks(sparkFrom, b.now);
  const trend = liftTrend(rows, b.now);
  const best = bestSet(rows);
  const records = personalRecords(rows);
  const recent = recentLiftDays(rows);
  const nothingLogged = records.length === 0;

  const figure = String(toDisplay(e1rm, s.unit));
  let sub = 'no trend yet';
  let subColor: string = onInk.muted;
  if (nothingLogged) sub = e1rm > 0 ? 'your starting max' : 'nothing logged yet';
  // The estimate only looks back 90 days, so older history alone leaves it empty.
  else if (e1rm === 0) sub = 'nothing in the last 90 days';
  if (trend !== null) {
    sub = `${trend >= 0 ? '↑' : '↓'} ${toDisplay(Math.abs(trend), s.unit)} in 12 wks`;
    subColor = trend >= 0 ? C.greenLight : C.redLight;
  }

  return (
    <>
      <Hero gap={14} style={{ paddingTop: 4 }}>
        {header}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {logged.length > 0 && (
            // The same track as Train's lifts: one way of picking a lift across the app.
            <ChipTrack
              label="Lifts"
              value={liftId}
              onChange={(id) => b.setStatsLift(id)}
              items={logged.map((id) => ({ value: id, label: b.exerciseById.get(id)?.name ?? id }))}
            />
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 }}>
            <HeroEyebrow>Estimated 1RM</HeroEyebrow>
            {e1rm > 0 ? (
              <HeroNumeral
                value={figure}
                size={HERO_SIZE.detail}
                color={onInk.text}
                label={s.unit}
                labelSize={T.title}
                labelWeight={W.button}
                sub={sub}
                subColor={subColor}
                ariaLabel={`${name}: estimated one-rep max ${figure} ${s.unit}, ${sub}`}
              />
            ) : (
              // Words, not a placeholder figure: a dash at hero size draws as a
              // solid white bar and reads as something broken.
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
                <span style={{ fontSize: T.xxl, fontWeight: W.title, letterSpacing: '-0.02em', color: onInk.text }}>No estimate yet</span>
                <span style={{ fontSize: T.sm, fontWeight: W.label, color: subColor }}>{sub}</span>
              </div>
            )}
          </div>

          {spark.length > 1 ? (
            <div>
              {/* A non-scaling stroke, so stretching the box to the screen does not fatten the line. */}
              <svg viewBox="0 0 300 82" preserveAspectRatio="none" style={{ width: '100%', height: 52, display: 'block' }} aria-hidden>
                <polyline points={spark.join(' ')} fill="none" stroke={onInk.text} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </svg>
              {/* Each label sits where its month begins, nudged left by its own
                  width in proportion, so the first hugs the left edge and none
                  hang off the right. */}
              <div aria-hidden style={{ position: 'relative', height: 16, marginTop: 4 }}>
                {ticks.map((t) => (
                  <span
                    key={t.label}
                    style={{
                      position: 'absolute',
                      left: `${t.x * 100}%`,
                      transform: `translateX(-${t.x * 100}%)`,
                      fontSize: T.xs,
                      fontWeight: W.label,
                      color: onInk.muted,
                    }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            spark.length === 1 && (
              <span style={{ fontSize: T.caption, fontWeight: W.label, color: onInk.muted }}>One session logged — the curve starts at two.</span>
            )
          )}
        </div>
      </Hero>

      <Sheet>
        {/* The maxes you declared sit with the maxes your sets earn, so the
            number a percentage workout reads from is found where maxes are. */}
        <StartingMaxes />
        {nothingLogged ? (
          <Empty>
            Nothing logged for {name} yet.
            <br />
            Log a working set and its history starts here.
          </Empty>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <StatTile
                value={
                  <>
                    {fmtVolume(liftVolume(rows, b.now), s.unit)}{' '}
                    <span style={{ fontSize: T.note, fontWeight: W.label, color: C.tertiary }}>{volumeUnit(s.unit, true)}</span>
                  </>
                }
                label="Block volume · 28 days"
              />
              <StatTile value={best ? bestSetText(best.weightKg, best.reps, s.unit, b.isBodyweightLift(liftId)) : '—'} label="Best set" />
            </div>

            <Section title="Personal records">
              {records.map((pr) => (
                <Row
                  key={pr.label}
                  title={pr.label}
                  titleSize={14.5}
                  sub={fmtDate(pr.key)}
                  right={
                    <span style={{ fontSize: 17, fontWeight: W.title, color: pr.highlight ? C.amberDark : C.ink, whiteSpace: 'nowrap', ...num }}>
                      {pr.kind === 'volume' ? volumeText(pr.kg, s.unit) : weightShort(toDisplay(pr.kg, s.unit), s.unit, b.isBodyweightLift(liftId))}
                    </span>
                  }
                />
              ))}
            </Section>

            <Section title="Recent sessions">
              {recent.map((day) => (
                <Row
                  key={day.key}
                  title={<span style={{ fontSize: 13.5, fontWeight: W.button, color: C.ink80, ...num }}>{fmtShortDay(day.key, b.todayKey)}</span>}
                  right={
                    <span style={{ fontSize: 13.5, fontWeight: W.button, color: C.ink60, whiteSpace: 'nowrap', ...num }}>
                      {day.sets} sets · {volumeText(day.tonnageKg, s.unit)}
                    </span>
                  }
                />
              ))}
            </Section>
          </>
        )}
      </Sheet>
    </>
  );
}

/** A figure on a grey tile with its label under it: the lift's block volume and its best set. */
function StatTile({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div style={{ background: C.screen, borderRadius: R.panel, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <span style={{ fontSize: T.xl, fontWeight: W.title, letterSpacing: '-0.02em', whiteSpace: 'nowrap', ...num }}>{value}</span>
      <span style={{ fontSize: T.sm, fontWeight: W.label, color: C.tertiary }}>{label}</span>
    </div>
  );
}

/** "2.5t" in kilograms, "5.5 k lb" in pounds: the unit hugs a single letter and stands apart from a word. */
function volumeText(kg: number, unit: Unit): string {
  const short = volumeUnit(unit, true);
  return unit === 'kg' ? `${fmtVolume(kg, unit)}${short}` : `${fmtVolume(kg, unit)} ${short}`;
}

/**
 * "100×8" for a loaded lift. A bodyweight best reads "BW × 8", or "+10 kg × 8"
 * with added weight — "0×8" says the best set was nothing.
 */
function bestSetText(weightKg: number, reps: number, unit: Unit, bodyweight: boolean): string {
  const weight = toDisplay(weightKg, unit);
  if (weight === 0 || bodyweight) return `${weightShort(weight, unit, bodyweight)} × ${reps}`;
  return `${weight}×${reps}`;
}
