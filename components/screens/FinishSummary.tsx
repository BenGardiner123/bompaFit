'use client';

// What you just did, shown once, the moment a session is finished.
//
// It replaced a three-second "session saved" toast: finishing a workout is the
// one moment someone is guaranteed to look at the phone with nothing else to
// do, and it deserved more than small print. It covers the whole app,
// including the tab bar, until "Done" — by then Today is already underneath.

import { useEffect, useRef } from 'react';
import { resolveTarget, targetRpeFor } from '@/lib/adapt';
import { countsAsWork, toDisplay } from '@/lib/calc';
import type { SessionSummary } from '@/lib/history';
import { C, HERO_SIZE, R, Z, num, onInk } from '@/lib/tokens';
import { fatigueDelta, sessionVerdict } from '@/lib/verdict';
import { isBodyweightLift, weightShort } from '@/lib/bodyweight';
import { useBompa } from '@/state/BompaContext';
import { Btn, Hero, HeroEyebrow, HeroNumeral, Row, Section, Sheet, useEscapeKey } from '@/components/ui';

export function FinishSummary() {
  const b = useBompa();
  const summary = b.s.summary;
  const open = summary !== null;

  useEscapeKey(open, b.closeSummary);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  if (!summary) return null;

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Session summary"
      tabIndex={-1}
      className="sheet no-scrollbar"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: Z.summary,
        background: C.screen,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        outline: 'none',
      }}
    >
      <SummaryBody summary={summary} />
    </div>
  );
}

function SummaryBody({ summary }: { summary: SessionSummary }) {
  const b = useBompa();
  const { unit } = b.s;
  const { session } = summary;
  const routine = b.routineById(session.routineId);

  const all = summary.lifts.flatMap((lift) => lift.sets);
  const work = all.filter((row) => countsAsWork(row.type));

  // Tonnes for kilograms. Pounds have no tonne, so they read in thousands.
  const bigValue = (toDisplay(summary.tonnageKg, unit) / 1000).toFixed(1);
  const bigLabel = unit === 'kg' ? 'tonnes' : 'thousand lb';

  const avgRpe = work.length ? (work.reduce((total, row) => total + row.rpe, 0) / work.length).toFixed(1) : '—';
  const minutes = Math.round(summary.durationMs / 60_000);

  // Measured from just before the first set, so what it shows is this session
  // and nothing else. An empty session has no first set and added nothing.
  const firstAt = all.reduce((earliest, row) => Math.min(earliest, row.at), Infinity);
  const delta = Number.isFinite(firstAt) ? fatigueDelta(b.loads, firstAt - 1, session.finishedAt ?? b.now) : 0;
  const deltaText = delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0';

  const verdict = sessionVerdict(all, targetRpeFor(routine), (id) => b.exerciseById.get(id)?.name ?? id);

  // Every lift the session was built around, trained or not, plus anything
  // added along the way. Skipping a planned lift is worth seeing here.
  const order = [...session.exerciseIds];
  for (const lift of summary.lifts) if (!order.includes(lift.exerciseId)) order.push(lift.exerciseId);

  const rows = order.flatMap((exerciseId) => {
    const lift = summary.lifts.find((x) => x.exerciseId === exerciseId);
    const slot = routine?.slots.find((x) => x.exerciseId === exerciseId);
    const done = lift ? lift.sets.filter((row) => countsAsWork(row.type)) : [];
    // Added mid-session and then never trained: nothing planned, nothing done.
    if (!slot && !lift) return [];

    const top = done.reduce((best, row) => Math.max(best, row.rpe), 0);
    const detail = done.length
      ? `${done.length} × ${done[0]!.reps} @ ${weightShort(toDisplay(lift!.topWeightKg, unit), unit, isBodyweightLift(b.exerciseById.get(exerciseId)))} · top RPE ${top}`
      : lift
        ? 'Warm-ups only'
        : 'Not trained today';

    let status: string;
    let statusColor: string;
    if (!slot) {
      status = `+${done.length} extra`;
      statusColor = C.blueDark;
    } else {
      const planned = resolveTarget(slot, b.prescriptions, b.e1rmByExercise[exerciseId] ?? 0).sets;
      status = `${done.length}/${planned}`;
      statusColor = done.length >= planned ? C.greenDark : done.length > 0 ? C.amberDark : C.tertiary;
    }

    return [{ exerciseId, name: b.exerciseById.get(exerciseId)?.name ?? exerciseId, detail, status, statusColor }];
  });

  const { done, total } = b.progress;
  const next = b.nextSlot ? b.routineById(b.nextSlot.routineId)?.name : undefined;
  const week =
    total === 0
      ? 'Nothing planned this week'
      : `${done} of ${total} done${next ? ` · ${next} is next` : done >= total ? ' · week complete' : ''}`;

  return (
    <>
      <Hero gap={8} style={{ padding: '18px 22px 46px' }}>
        <HeroEyebrow color={C.greenLight}>Session saved · {session.routineName}</HeroEyebrow>
        <div style={{ paddingTop: 6 }}>
          <HeroNumeral
            value={bigValue}
            size={HERO_SIZE.summary}
            label={bigLabel}
            sub="working sets only"
            ariaLabel={`${bigValue} ${bigLabel} lifted, counting working sets only`}
          />
        </div>
        <div style={{ display: 'flex', gap: 26, paddingTop: 14 }}>
          <Figure value={String(summary.workingSets)} label="sets" />
          <Figure value={String(minutes)} label="min" />
          <Figure value={avgRpe} label="avg RPE" />
          {/* Red only when fatigue went up — that is the cost, and the colour says so. */}
          <Figure value={deltaText} label="fatigue" color={delta > 0 ? C.redLight : onInk.text} />
        </div>
      </Hero>

      <Sheet>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span
            aria-hidden
            className="pulse"
            style={{ width: 7, height: 7, borderRadius: '50%', background: C.amber, marginTop: 7, flex: 'none' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.16em', color: C.amberDark }}>BOMPA</span>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, fontWeight: 500 }}>{verdict}</p>
          </div>
        </div>

        <Section title="What you did">
          {rows.map((row) => (
            <Row
              key={row.exerciseId}
              title={row.name}
              sub={row.detail}
              right={
                <span style={{ fontSize: 13, fontWeight: 800, color: row.statusColor, flex: 'none', ...num }}>{row.status}</span>
              }
            />
          ))}
          {rows.length === 0 && <Row title="No lifts in this session" />}
        </Section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.14em', color: C.tertiary }}>THIS WEEK</span>
          <span style={{ fontSize: 15, fontWeight: 800, ...num }}>{week}</span>
        </div>

        <Btn
          onClick={b.closeSummary}
          style={{
            marginTop: 'auto',
            height: 58,
            borderRadius: R.block,
            background: C.amber,
            color: C.ink,
            fontSize: 16,
            fontWeight: 800,
          }}
        >
          Done
        </Btn>
      </Sheet>
    </>
  );
}

function Figure({ value, label, color = onInk.text }: { value: string; label: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 26, fontWeight: 800, color, ...num }}>{value}</span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: onInk.muted }}>{label}</span>
    </div>
  );
}
