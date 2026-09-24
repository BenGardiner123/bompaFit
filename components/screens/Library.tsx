'use client';

import { useRef, useState } from 'react';
import { EXERCISE_SOURCES } from '@/lib/data';
import { C, HERO_SIZE, PH, R } from '@/lib/tokens';
import type { Routine } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { ImportPreview, useImport } from '@/components/ImportPreview';
import { Btn, Hero, HeroEyebrow, HeroNumeral, HeroTabs, InkButton, Row, Section, Sheet, Tag } from '@/components/ui';

type Filter = 'mine' | 'import' | 'template';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'mine', label: 'Mine' },
  { value: 'import', label: 'Imported' },
  { value: 'template', label: 'Templates' },
];

/** What each filter says when it has nothing in it, so an empty list never reads as broken. */
const EMPTY: Record<Filter, string> = {
  mine: 'No workouts of your own yet. Build one above, or copy a template.',
  import: 'Nothing imported yet. Drop in a Bompa export below.',
  template: 'No templates.',
};

export function Library() {
  const b = useBompa();
  const [filter, setFilter] = useState<Filter>('mine');
  const importer = useImport();
  const fileInput = useRef<HTMLInputElement>(null);

  // Templates live behind their own filter rather than mixed in with the
  // routines you actually train. They are starting points to copy, and showing
  // them alongside your own work is how you end up training someone else's
  // programme by accident.
  const visible = b.allRoutines.filter((routine) => {
    if (filter === 'template') return routine.source === 'template';
    if (filter === 'import') return routine.source === 'import';
    return routine.source === 'user' || routine.source === 'saved';
  });

  return (
    <div className="rise" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Hero gap={12} style={{ paddingTop: 10 }}>
        <HeroEyebrow
          right={
            <InkButton shape="pill" height={40} fontSize={13} onClick={() => b.patch({ library: false })}>
              {b.openSession ? 'Back to session' : 'Close'}
            </InkButton>
          }
        >
          Workouts
        </HeroEyebrow>
        <WeekNumeral />
        <HeroTabs value={filter} options={FILTERS} onChange={setFilter} label="Which workouts to show" />
      </Hero>

      <Sheet gap={24}>
        {/* Building one from nothing has to be reachable here, not only during
            first-run setup. Otherwise the only way to a new workout after day
            one is to copy a template and strip it back, which is not creating.
            Hidden on Templates, because templates are copied, never added to. */}
        {filter !== 'template' && (
          <Btn
            onClick={() => void b.createRoutine(`Workout ${b.routines.length + 1}`)}
            style={{ height: 50, borderRadius: R.control, background: C.ink, color: C.white, fontSize: 14, fontWeight: 800 }}
          >
            + New workout
          </Btn>
        )}

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {visible.map((routine) => (
            <RoutineRow key={routine.id} routine={routine} />
          ))}
          {visible.length === 0 && (
            <p style={{ margin: 0, padding: '14px 0', borderTop: `1px solid ${C.line}`, fontSize: 13.5, lineHeight: 1.5, color: C.tertiary }}>
              {EMPTY[filter]}
            </p>
          )}
        </div>

        <Section title="Import workouts">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: C.ink80 }}>
              Drop in a Bompa export. Everything stays on the device; nothing is uploaded.
            </p>

            {importer.preview ? (
              <ImportPreview preview={importer.preview} onCommit={importer.commit} onCancel={importer.cancel} />
            ) : (
              <Btn
                onClick={() => fileInput.current?.click()}
                style={{ height: 46, borderRadius: R.control, border: `1px solid ${C.lineStrong}`, color: C.ink, fontSize: 13.5, fontWeight: 800 }}
              >
                Choose file
              </Btn>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              aria-label="Bompa export file"
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importer.choose(file);
                event.target.value = '';
              }}
            />
          </div>
        </Section>

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
      </Sheet>
    </div>
  );
}

/**
 * The hero number: what the week still owes you, because picking a workout
 * should start from the plan. With no plan this week there is nothing owed, so
 * it counts the workouts you have instead of showing a zero that means nothing.
 *
 * The line under the label deliberately doesn't name the next workout: the
 * routine rows below already show every name, and a second copy of it on the
 * same screen makes "find the row called Push A" ambiguous for anything
 * reading the page by its text.
 */
function WeekNumeral() {
  const b = useBompa();
  const slots = b.thisWeekSlots;

  if (slots.length === 0) {
    const n = b.routines.length;
    const noun = n === 1 ? 'workout' : 'workouts';
    return (
      <HeroNumeral
        value={n}
        size={HERO_SIZE.screen}
        label={noun}
        sub="no plan this week"
        ariaLabel={`${n} ${noun}, and no plan this week`}
      />
    );
  }

  const left = slots.filter((slot) => slot.status === 'plan').length;
  const done = slots.filter((slot) => slot.status === 'done').length;
  const sub = left === 0 ? 'week complete' : `${done} of ${slots.length} done`;
  return (
    <HeroNumeral
      value={left}
      size={HERO_SIZE.screen}
      label="left this week"
      sub={sub}
      ariaLabel={`${left} ${left === 1 ? 'session' : 'sessions'} left this week, ${sub}`}
    />
  );
}

function RoutineRow({ routine }: { routine: Routine }) {
  const b = useBompa();
  const active = b.openSession?.routineId === routine.id;
  const isTemplate = routine.source === 'template';
  // "Pending this week" rather than "today", because the plan no longer names days.
  const pending = b.thisWeekSlots.some((slot) => slot.status === 'plan' && slot.routineId === routine.id);

  const tag = active ? 'ACTIVE' : isTemplate ? 'TEMPLATE' : pending ? 'THIS WEEK' : routine.source === 'import' ? 'IMPORT' : 'MINE';
  const highlight = tag === 'THIS WEEK' || tag === 'ACTIVE';
  const lifts = [...routine.slots].sort((a, x) => a.order - x.order);

  return (
    <Row
      titleSize={16}
      title={routine.name}
      sub={`${lifts.length} ${lifts.length === 1 ? 'lift' : 'lifts'} · ~${routine.estMinutes} min`}
      lead={<span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, background: PH[routine.phase], flex: 'none' }} />}
      right={
        <Tag bg={highlight ? C.amberBg : C.tagBg} fg={highlight ? C.amberDark : C.ink60}>
          {tag}
        </Tag>
      }
      style={{ paddingBottom: 14 }}
    >
      {/* Indented to the title, past the phase square, so the lifts and the
          buttons read as belonging to this workout rather than floating free. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 19 }}>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: C.ink80 }}>
          {lifts.map((slot, i) => (
            <span key={slot.exerciseId}>
              {i > 0 && ' · '}
              {/* Superset members are coloured, and keep their place in the
                  order, so the line shows the shape of the session rather than
                  a flat list. */}
              <span style={slot.supersetGroup ? { color: C.amberDark, fontWeight: 700 } : undefined}>
                {b.exerciseById.get(slot.exerciseId)?.name ?? slot.exerciseId}
                {slot.supersetGroup ? ` · ${slot.supersetGroup}` : ''}
              </span>
            </span>
          ))}
        </p>

        <div style={{ display: 'flex', gap: 7 }}>
          <PrimaryAction routine={routine} active={active} isTemplate={isTemplate} />
          {!isTemplate && (
            <Btn
              onClick={() => b.patch({ editingRoutineId: routine.id })}
              label={`Edit ${routine.name}`}
              style={{
                width: 44,
                height: 44,
                flex: 'none',
                borderRadius: R.chip,
                border: `1px solid ${C.lineStrong}`,
                color: C.ink60,
                fontSize: 15,
                fontWeight: 800,
              }}
            >
              ✎
            </Btn>
          )}
        </div>
      </div>
    </Row>
  );
}

function PrimaryAction({ routine, active, isTemplate }: { routine: Routine; active: boolean; isTemplate: boolean }) {
  const b = useBompa();
  const base = { flex: 1, height: 44, borderRadius: R.chip, fontSize: 13.5, fontWeight: 800 } as const;

  // A template is never trained directly. Copying it first is what makes the
  // routine yours to edit, and stops the app scheduling a programme you never chose.
  if (isTemplate) {
    return (
      <Btn onClick={() => void b.copyTemplate(routine.id)} style={{ ...base, background: C.ink, color: C.white }}>
        Copy to my workouts
      </Btn>
    );
  }

  if (active) {
    return (
      <Btn onClick={() => b.startSession(routine.id)} style={{ ...base, background: C.amber, color: C.ink }}>
        Continue session
      </Btn>
    );
  }

  // One session at a time. Saying why the button is dead beats a button that
  // quietly takes you to the session you already have open.
  if (b.openSession) {
    return (
      <Btn disabled style={{ ...base, background: C.ink, color: C.white }}>
        Finish current session first
      </Btn>
    );
  }

  return (
    <Btn onClick={() => b.startSession(routine.id)} style={{ ...base, background: C.ink, color: C.white }}>
      Start this workout
    </Btn>
  );
}
