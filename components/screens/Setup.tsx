'use client';

// First-run setup.
//
// Principle: ask only what changes the output. Every step either changes what
// gets generated or says where a decision lives; nothing here is a tour.

import { useState } from 'react';
import { C, HERO_SIZE, PH, R, num, onInk } from '@/lib/tokens';
import type { Phase, Unit } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { Btn, Hero, HeroEyebrow, HeroNumeral, InkButton, Row, Section, Sheet } from '@/components/ui';
import { StartingMaxes } from '@/components/StartingMaxes';

const BLOCK_TYPES: { id: Phase; label: string; sub: string }[] = [
  { id: 'hypertrophy', label: 'Hypertrophy', sub: 'High volume · RPE 7' },
  { id: 'strength', label: 'Strength', sub: '80–90% · RPE 8' },
  { id: 'power', label: 'Power', sub: 'Speed · RPE 7' },
  { id: 'peak', label: 'Peak', sub: 'Taper to test' },
];

/** Each step's name for the progress line, its title, and the one sentence under it. */
const STEPS = [
  { name: 'Units', title: 'Kilograms or pounds?', sub: 'Everything is stored in kilograms underneath. This only changes what you see and type.' },
  {
    name: 'Maxes',
    title: 'Your working maxes',
    sub: 'Only needed if you write a workout as a percentage — 5/3/1 and the like. Skip it and your logged sets will fill it in.',
  },
  {
    name: 'Workouts',
    title: 'Build your workouts',
    sub: 'Two or three is usually right — the week cycles through them in order. Nothing is pre-loaded; these are yours.',
  },
  { name: 'Block', title: 'How the block runs', sub: 'Sessions a week, not which days — train them whenever the week suits you.' },
  { name: 'Done', title: "That's it", sub: 'Two things worth knowing before you start.' },
] as const;

const LAST = STEPS.length - 1;

export function Setup() {
  const b = useBompa();
  const [step, setStep] = useState(0);
  const [perWeek, setPerWeek] = useState(4);
  const [busy, setBusy] = useState(false);

  const rotation = b.routines.map((r) => r.id);
  // A rotation of nothing generates a plan of nothing, so the flow won't move
  // past the workouts step until there is at least one.
  const hasWorkouts = rotation.length > 0;
  const current = STEPS[step]!;

  // The only place setup writes a plan. Wandering back and forth through the
  // steps schedules nothing; this button does.
  const finish = async () => {
    setBusy(true);
    await b.createPlanFromSetup({
      rotation,
      sessionsPerWeek: perWeek,
      phase: b.s.builderPhase,
      weeks: b.s.builderWeeks,
    });
    setBusy(false);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: C.screen, overflow: 'hidden' }}>
      {/* The hero scrolls away with the sheet; only the footer stays put, so
          Back and Next never move under your thumb. */}
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <Hero gap={12} style={{ paddingTop: 12 }}>
          <HeroEyebrow
            right={
              <InkButton variant="ghost" height={40} fontSize={13} color={onInk.muted} onClick={b.skipSetup}>
                Skip
              </InkButton>
            }
          >
            Setting up · {current.name}
          </HeroEyebrow>

          {/* Progress, so the flow states its own length rather than feeling endless. */}
          <div aria-hidden style={{ display: 'flex', gap: 4 }}>
            {STEPS.map((s, i) => (
              <span key={s.name} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? C.amber : onInk.line }} />
            ))}
          </div>

          <div style={{ paddingTop: 8 }}>
            <HeroNumeral
              value={String(step + 1).padStart(2, '0')}
              size={HERO_SIZE.step}
              ariaLabel={`Step ${step + 1} of ${STEPS.length}`}
            />
          </div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em', color: onInk.text }}>{current.title}</h1>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: onInk.body }}>{current.sub}</p>
        </Hero>

        <Sheet>
          {step === 0 && <UnitsStep />}
          {step === 1 && <StartingMaxes />}
          {step === 2 && <WorkoutsStep />}
          {step === 3 && <BlockStep perWeek={perWeek} setPerWeek={setPerWeek} rotation={rotation} />}
          {step === 4 && <DoneStep />}
        </Sheet>
      </div>

      <div
        style={{
          flex: 'none',
          padding: '12px 18px calc(20px + env(safe-area-inset-bottom))',
          display: 'flex',
          gap: 8,
          borderTop: `1px solid ${C.line}`,
          background: C.screen,
        }}
      >
        {step > 0 && (
          <Btn
            onClick={() => setStep(step - 1)}
            style={{ width: 96, height: 54, flex: 'none', borderRadius: R.block, border: `1px solid ${C.lineStrong}`, color: C.ink80, fontSize: 14, fontWeight: 800 }}
          >
            Back
          </Btn>
        )}
        <Btn
          onClick={() => (step === LAST ? void finish() : setStep(step + 1))}
          disabled={busy || (step >= 2 && !hasWorkouts)}
          style={{ flex: 1, height: 54, borderRadius: R.block, background: C.amber, color: C.ink, fontSize: 16, fontWeight: 800 }}
        >
          {step === LAST ? 'Build my plan' : 'Next'}
        </Btn>
      </div>
    </div>
  );
}

function UnitsStep() {
  const b = useBompa();
  const options: { value: Unit; label: string; word: string }[] = [
    { value: 'kg', label: 'KG', word: 'kilograms' },
    { value: 'lb', label: 'LB', word: 'pounds' },
  ];

  return (
    <div role="group" aria-label="Units" style={{ display: 'flex', gap: 10 }}>
      {options.map((opt) => {
        const on = b.s.unit === opt.value;
        return (
          <Btn
            key={opt.value}
            onClick={() => b.setUnit(opt.value)}
            pressed={on}
            style={{
              flex: 1,
              height: 128,
              borderRadius: R.card,
              border: `1px solid ${on ? C.ink : C.lineStrong}`,
              background: on ? C.ink : C.card,
              color: on ? onInk.text : C.ink,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-0.03em' }}>{opt.label}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: on ? onInk.muted : C.tertiary }}>{opt.word}</span>
          </Btn>
        );
      })}
    </div>
  );
}

function WorkoutsStep() {
  const b = useBompa();
  const [busy, setBusy] = useState(false);

  // The builder is rendered once, by the page shell, deliberately outside the
  // setup branch so this step can open it. Keeping a second copy here mounted
  // two dialogs on the same routine: two modals and two independent drafts of
  // one workout. createRoutine already opens the builder on the new routine.
  const create = async () => {
    setBusy(true);
    await b.createRoutine(`Workout ${b.routines.length + 1}`);
    setBusy(false);
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {b.routines.length === 0 && (
          <p style={{ margin: 0, padding: '12px 0', borderTop: `1px solid ${C.line}`, fontSize: 13.5, lineHeight: 1.5, color: C.tertiary }}>
            No workouts yet.
          </p>
        )}
        {b.routines.map((routine) => (
          <Row
            key={routine.id}
            title={routine.name}
            sub={`${routine.slots.length} ${routine.slots.length === 1 ? 'lift' : 'lifts'}`}
            lead={<PhaseSquare phase={routine.phase} />}
            right={
              <Btn
                onClick={() => b.patch({ editingRoutineId: routine.id })}
                label={`Edit ${routine.name}`}
                style={{ height: 44, padding: '0 6px', color: C.amberDark, fontSize: 13, fontWeight: 800 }}
              >
                Edit
              </Btn>
            }
          />
        ))}
        <Btn
          onClick={create}
          disabled={busy}
          style={{ height: 50, marginTop: 6, borderRadius: R.control, background: C.ink, color: C.white, fontSize: 14, fontWeight: 800 }}
        >
          + New workout
        </Btn>
      </div>

      {b.templates.length > 0 && (
        <Section title="Or start from a template">
          <p style={{ margin: 0, padding: '0 0 8px', fontSize: 12.5, lineHeight: 1.5, color: C.tertiary }}>
            Copies it into a workout of your own. The template itself stays as it is.
          </p>
          {b.templates.map((template) => (
            <Row
              key={template.id}
              title={template.name}
              titleSize={14}
              lead={<PhaseSquare phase={template.phase} />}
              right={<span style={{ fontSize: 12.5, fontWeight: 800, color: C.amberDark }}>Copy</span>}
              label={`Copy ${template.name} into your workouts`}
              onClick={() => void b.copyTemplate(template.id)}
            />
          ))}
        </Section>
      )}
    </>
  );
}

function BlockStep({
  perWeek,
  setPerWeek,
  rotation,
}: {
  perWeek: number;
  setPerWeek: (n: number) => void;
  rotation: string[];
}) {
  const b = useBompa();

  return (
    <>
      <Section title="Sessions a week">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <NumberPicker values={[2, 3, 4, 5, 6]} value={perWeek} onChange={setPerWeek} label="Sessions a week" />
          {rotation.length > 0 && (
            <span style={{ fontSize: 12.5, lineHeight: 1.5, color: C.tertiary }}>
              Week one:{' '}
              {Array.from({ length: perWeek }, (_, i) => b.routineById(rotation[i % rotation.length]!)?.name ?? '—').join(' · ')}
            </span>
          )}
        </div>
      </Section>

      <Section title="Block type">
        <div role="group" aria-label="Block type" style={{ display: 'flex', flexDirection: 'column' }}>
          {BLOCK_TYPES.map((type) => {
            const on = b.s.builderPhase === type.id;
            return (
              <Btn
                key={type.id}
                onClick={() => b.patch({ builderPhase: type.id })}
                pressed={on}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '12px 1fr auto',
                  gap: 12,
                  alignItems: 'center',
                  minHeight: 44,
                  padding: '12px 0',
                  borderTop: `1px solid ${C.line}`,
                  textAlign: 'left',
                }}
              >
                <PhaseSquare phase={type.id} size={10} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>{type.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.tertiary }}>{type.sub}</span>
                </span>
                {/* A radio ring: filled ink with a screen-coloured inner ring when chosen. */}
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    border: `2px solid ${on ? C.ink : C.lineStrong}`,
                    background: on ? C.ink : 'transparent',
                    boxShadow: on ? `inset 0 0 0 3px ${C.screen}` : 'none',
                  }}
                />
              </Btn>
            );
          })}
        </div>
      </Section>

      <Section title="Length · plus a deload week">
        <NumberPicker values={[3, 4, 5, 6]} value={b.s.builderWeeks} onChange={(n) => b.patch({ builderWeeks: n })} label="Block length in weeks" />
      </Section>
    </>
  );
}

function DoneStep() {
  const b = useBompa();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Signpost where="Plan → Mesocycle" what="Change the block style or add another one. This is where periodization lives." />
        <Signpost where="Today" what="Your readiness, with the fitness and fatigue curve behind it." />
        <Signpost where="Plan → Calendar" what="This week's sessions, and what I've changed in your plan and why." />
        <Signpost where="Anywhere" what="Planned days are a guide. Train when you want — I keep the week's arithmetic honest either way." />
      </div>

      {/* The explainer has to be reachable from setup, not only from the
          logger. RPE is the one input the whole adaptation engine reads, and
          the first time anyone meets it is mid-set, which is the worst moment
          to be working out what it means. */}
      <Btn
        onClick={() => b.patch({ rpeHelp: true })}
        style={{ height: 48, borderRadius: R.control, border: `1px solid ${C.lineStrong}`, color: C.amberDark, fontSize: 13.5, fontWeight: 800 }}
      >
        What is RPE, and why does it matter?
      </Btn>
    </div>
  );
}

function Signpost({ where, what }: { where: string; what: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '13px 0', borderTop: `1px solid ${C.line}` }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: C.amberDark }}>{where}</span>
      <span style={{ fontSize: 14, lineHeight: 1.5, color: C.ink80 }}>{what}</span>
    </div>
  );
}

function PhaseSquare({ phase, size = 9 }: { phase: Phase; size?: number }) {
  return <span aria-hidden style={{ width: size, height: size, borderRadius: 2, background: PH[phase], flex: 'none' }} />;
}

/** A row of number buttons where one is chosen: sessions a week, block length. */
function NumberPicker({
  values,
  value,
  onChange,
  label,
}: {
  values: number[];
  value: number;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', gap: 7 }}>
      {values.map((n) => {
        const on = value === n;
        return (
          <Btn
            key={n}
            onClick={() => onChange(n)}
            pressed={on}
            style={{
              flex: 1,
              height: 48,
              borderRadius: R.control,
              fontSize: 15,
              fontWeight: 800,
              background: on ? C.ink : 'transparent',
              border: `1px solid ${on ? C.ink : C.lineStrong}`,
              color: on ? C.white : C.ink60,
              ...num,
            }}
          >
            {n}
          </Btn>
        );
      })}
    </div>
  );
}
