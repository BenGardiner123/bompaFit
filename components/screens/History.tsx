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
import { C, HERO_SIZE, num, onInk } from '@/lib/tokens';
import type { Unit } from '@/lib/types';
import { weightShort } from '@/lib/bodyweight';
import { useBompa } from '@/state/BompaContext';
import { Empty, Hero, HeroEyebrow, HeroNumeral, HeroTabs, InkChip, Row, Scroller, Section, Sheet } from '@/components/ui';
import { SessionHistory } from '@/components/screens/SessionHistory';

type View = 'session' | 'lift';

export function History() {
  // Two axes on the same data. By session answers "what did I do on
  // Tuesday"; by lift answers "how is my squat going". Slicing by lift alone
  // made the first question unanswerable, because one session's lifts
  // scatter across as many chips as it had exercises.
  const [view, setView] = useState<View>('session');

  const tabs = (
    <HeroTabs
      label="History view"
      value={view}
      options={[
        { value: 'session', label: 'By session' },
        { value: 'lift', label: 'By lift' },
      ]}
      onChange={setView}
    />
  );

  return (
    <div className="rise" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Every other screen names itself in a heading; the hero leads with a
          number instead, so the name is here for screen readers only. */}
      <h1 className="sr-only">History</h1>
      {view === 'session' ? <SessionHistory tabs={tabs} /> : <LiftHistory tabs={tabs} />}
    </div>
  );
}

/** The By lift view: estimated max and its twelve-week curve, then records and recent days. */
function LiftHistory({ tabs }: { tabs: ReactNode }) {
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

  const figure = e1rm > 0 ? String(toDisplay(e1rm, s.unit)) : '—';
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
        {tabs}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {logged.length > 0 && (
            // Runs to the hero's edges so a long row scrolls under them
            // rather than stopping short in the padding.
            <Scroller style={{ gap: 6, margin: '0 -22px', padding: '0 22px' }}>
              {logged.map((id) => (
                <InkChip key={id} on={id === liftId} onClick={() => b.setStatsLift(id)}>
                  {b.exerciseById.get(id)?.name ?? id}
                </InkChip>
              ))}
            </Scroller>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
            <HeroEyebrow>Estimated 1RM</HeroEyebrow>
            <HeroNumeral
              value={figure}
              size={HERO_SIZE.detail}
              label={s.unit}
              sub={sub}
              subColor={subColor}
              ariaLabel={e1rm > 0 ? `${name}: estimated one-rep max ${figure} ${s.unit}, ${sub}` : `${name}: no estimated max yet`}
            />
          </div>

          {spark.length > 1 ? (
            <div>
              <svg viewBox="0 0 300 82" preserveAspectRatio="none" style={{ width: '100%', height: 72, display: 'block' }} aria-hidden>
                <polyline points={spark.join(' ')} fill="none" stroke={C.amber} strokeWidth={2.5} strokeLinejoin="round" />
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
                      fontSize: 11,
                      fontWeight: 700,
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
              <span style={{ fontSize: 12, fontWeight: 600, color: onInk.muted }}>One session logged — the curve starts at two.</span>
            )
          )}
        </div>
      </Hero>

      <Sheet>
        {nothingLogged ? (
          <Empty>
            Nothing logged for {name} yet.
            <br />
            Log a working set and its history starts here.
          </Empty>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 28 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                  <span style={{ fontSize: 28, fontWeight: 800, ...num }}>{fmtVolume(liftVolume(rows, b.now), s.unit)}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.tertiary }}>{volumeUnit(s.unit, true)}</span>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: C.tertiary }}>block volume · 28d</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 28, fontWeight: 800, ...num }}>
                  {best ? bestSetText(best.weightKg, best.reps, s.unit, b.isBodyweightLift(liftId)) : '—'}
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: C.tertiary }}>best set</span>
              </div>
            </div>

            <Section title="Personal records">
              {records.map((pr) => (
                <Row
                  key={pr.label}
                  title={pr.label}
                  titleSize={14}
                  sub={fmtDate(pr.key)}
                  right={
                    <span style={{ fontSize: 17, fontWeight: 800, color: pr.highlight ? C.amberDark : C.ink, whiteSpace: 'nowrap', ...num }}>
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
                  title={<span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink80, ...num }}>{fmtShortDay(day.key, b.todayKey)}</span>}
                  right={
                    <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink60, whiteSpace: 'nowrap', ...num }}>
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
