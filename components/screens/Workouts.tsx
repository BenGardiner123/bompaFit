'use client';

import { useRef, useState } from 'react';
import { blocksUsing } from '@/lib/plan';
import { C, PH, R, T, TOUCH, num } from '@/lib/tokens';
import type { Routine } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { ImportPreview, useImport } from '@/components/ImportPreview';
import { Btn, Segmented } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';

type Filter = 'mine' | 'import' | 'template';

/** What each filter says when it has nothing in it, so an empty list never reads as broken. */
const EMPTY: Record<Filter, string> = {
  mine: 'No workouts of your own yet. Tap New to build one, or copy a template.',
  import: 'Nothing imported yet. Import workouts, below, reads a Bompa export.',
  template: 'No templates.',
};

/**
 * The Workouts tab: every routine you can train, and the gym tools.
 *
 * No hero. Today already leads with the week, and a second big number here
 * repeated it; this screen is a list to pick from, so it starts with the list.
 */
export function Workouts() {
  const b = useBompa();
  const [filter, setFilter] = useState<Filter>('mine');

  // Templates live behind their own filter rather than mixed in with the
  // routines you actually train. They are starting points to copy, and showing
  // them alongside your own work is how you end up training someone else's
  // programme by accident.
  const visible = b.allRoutines.filter((routine) => {
    if (filter === 'template') return routine.source === 'template';
    if (filter === 'import') return routine.source === 'import';
    return routine.source === 'user' || routine.source === 'saved';
  });
  const mine = b.allRoutines.filter((routine) => routine.source === 'user' || routine.source === 'saved').length;

  // One routine is open at a time. Unless you pick another, it is the one you
  // are training, then the one the week is waiting on, then the first.
  // Undefined until a row is tapped; null once the open row has been closed.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const running = b.openSession?.routineId;
  const next = b.nextSlot?.routineId;
  const fallback = [running, next, visible[0]?.id].find((id) => id !== undefined && visible.some((r) => r.id === id));
  let expanded = fallback;
  if (picked === null) expanded = undefined;
  else if (picked !== undefined && visible.some((r) => r.id === picked)) expanded = picked;

  return (
    <div className="rise" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, padding: '10px 18px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: T.xxl, fontWeight: 800, letterSpacing: '-0.02em' }}>Workouts</h1>
        {/* Building one from nothing has to be reachable here, not only during
            first-run setup. Hidden on Templates, because templates are copied,
            never added to. */}
        {filter !== 'template' && (
          <Btn
            onClick={() => void b.createRoutine(`Workout ${b.routines.length + 1}`)}
            label="New workout"
            style={{
              height: TOUCH,
              padding: '0 16px',
              borderRadius: R.chip,
              background: C.ink,
              color: C.white,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: T.md,
              fontWeight: 800,
            }}
          >
            <Icon name="plus" size={14} strokeWidth={2.5} />
            New
          </Btn>
        )}
      </div>

      <Segmented
        value={filter}
        label="Which workouts to show"
        options={[
          { value: 'mine', label: `Mine · ${mine}` },
          { value: 'import', label: 'Imported' },
          { value: 'template', label: 'Templates' },
        ]}
        onChange={(next) => {
          setFilter(next);
          // A new list starts from its own default open row, not one closed on another.
          setPicked(undefined);
        }}
      />

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {visible.map((routine) => (
          <RoutineRow
            key={routine.id}
            routine={routine}
            open={routine.id === expanded}
            onToggle={() => setPicked(routine.id === expanded ? null : routine.id)}
          />
        ))}
        {visible.length === 0 && (
          <p style={{ margin: 0, padding: '14px 0', borderTop: `1px solid ${C.line}`, fontSize: T.copy, lineHeight: 1.5, color: C.tertiary }}>
            {EMPTY[filter]}
          </p>
        )}
      </div>

      <ToolsSection />
    </div>
  );
}

/** "Bench Press · Overhead Press · Cable Fly + Triceps Pushdown": a superset reads as one step. */
function liftLine(routine: Routine, nameOf: (id: string) => string): string {
  const lifts = [...routine.slots].sort((a, x) => a.order - x.order);
  const parts: string[] = [];
  lifts.forEach((slot, i) => {
    const name = nameOf(slot.exerciseId);
    const prev = lifts[i - 1];
    if (slot.supersetGroup && prev?.supersetGroup === slot.supersetGroup) parts[parts.length - 1] += ` + ${name}`;
    else parts.push(name);
  });
  return parts.join(' · ');
}

function RoutineRow({ routine, open, onToggle }: { routine: Routine; open: boolean; onToggle: () => void }) {
  const b = useBompa();
  const running = b.openSession?.routineId === routine.id;
  const isTemplate = routine.source === 'template';
  const isNext = !b.openSession && b.nextSlot?.routineId === routine.id;
  const lifts = routine.slots.length;
  // Editing a workout changes every block that runs it; say so before the pencil is tapped.
  const blocks = isTemplate ? 0 : blocksUsing(routine.id, b.blocks, b.planned, b.plan).length;
  const sub = `${lifts} ${lifts === 1 ? 'lift' : 'lifts'} · ~${routine.estMinutes} min${blocks > 1 ? ` · used in ${blocks} blocks` : ''}`;
  const tag = running ? 'IN PROGRESS' : isNext ? 'NEXT' : null;

  return (
    <div style={{ borderTop: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', gap: open ? 4 : 0, paddingBottom: open ? 14 : 0 }}>
      <Btn
        onClick={onToggle}
        expanded={open}
        style={{
          // Open, the name line only needs a thumb's height; closed, it is the whole row.
          minHeight: open ? TOUCH : 56,
          paddingTop: open ? 6 : 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          textAlign: 'left',
          color: C.ink,
        }}
      >
        <span aria-hidden style={{ width: 12, height: 12, borderRadius: R.swatch, background: PH[routine.phase], flex: 'none' }} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: T.lg, fontWeight: 800 }}>{routine.name}</span>
          {!open && <span style={{ fontSize: T.sm, fontWeight: 600, color: C.tertiary, ...num }}>{sub}</span>}
        </span>
        {open && tag && (
          <span
            style={{
              fontSize: T.xs,
              fontWeight: 800,
              letterSpacing: '.06em',
              padding: '4px 7px',
              borderRadius: R.tag,
              background: C.ink,
              color: C.white,
              flex: 'none',
            }}
          >
            {tag}
          </span>
        )}
        {!open && <Icon name="chevron-right" size={16} style={{ color: C.tertiary }} />}
      </Btn>

      {open && (
        // Indented to the name, past the phase square, so the lifts and the
        // buttons read as belonging to this workout.
        <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 22 }}>
          {/* One line, cut with an ellipsis: a six-lift workout wrapped to three
              lines and pushed Start down the screen. The full list is still in
              the text a screen reader reads, and Edit shows every lift. */}
          <p
            style={{
              margin: 0,
              fontSize: T.sm,
              lineHeight: 1.45,
              color: C.ink60,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              ...num,
            }}
          >
            {liftLine(routine, (id) => b.exerciseById.get(id)?.name ?? id)} · ~{routine.estMinutes} min
            {blocks > 1 ? ` · used in ${blocks} blocks` : ''}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <PrimaryAction routine={routine} running={running} isTemplate={isTemplate} />
            {!isTemplate && (
              <Btn
                onClick={() => b.patch({ editingRoutineId: routine.id })}
                label={`Edit ${routine.name}`}
                style={{
                  width: TOUCH,
                  height: TOUCH,
                  flex: 'none',
                  borderRadius: R.chip,
                  border: `1px solid ${C.lineStrong}`,
                  color: C.ink,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="edit" size={17} />
              </Btn>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PrimaryAction({ routine, running, isTemplate }: { routine: Routine; running: boolean; isTemplate: boolean }) {
  const b = useBompa();
  const base = { flex: 1, height: TOUCH, borderRadius: R.chip, fontSize: T.md, fontWeight: 800 } as const;

  // A template is never trained directly. Copying it first is what makes the
  // routine yours to edit, and stops the app scheduling a programme you never chose.
  if (isTemplate) {
    return (
      <Btn onClick={() => void b.copyTemplate(routine.id)} style={{ ...base, background: C.ink, color: C.white }}>
        Copy to my workouts
      </Btn>
    );
  }

  if (running) {
    return (
      <Btn onClick={() => b.startSession(routine.id)} label={`Continue ${routine.name}`} style={{ ...base, background: C.amber, color: C.ink }}>
        Continue
      </Btn>
    );
  }

  // One session at a time. Saying when it can start beats a button that
  // quietly takes you to the session you already have open.
  if (b.openSession) {
    return (
      <Btn disabled style={{ ...base, border: `1px solid ${C.lineStrong}`, color: C.ink60 }}>
        Start after you finish
      </Btn>
    );
  }

  return (
    <Btn onClick={() => b.startSession(routine.id)} label={`Start ${routine.name}`} style={{ ...base, background: C.amber, color: C.ink }}>
      Start
    </Btn>
  );
}

// ─────────────────────────────────────────────────────────────

/** The gym tools, and the way in for someone else's workouts. */
function ToolsSection() {
  const b = useBompa();
  const importer = useImport();
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <section style={{ display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ margin: 0, paddingBottom: 8, fontSize: T.xs, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: C.tertiary }}>
        Tools
      </h2>
      <ToolRow icon="timer" title="Interval timer" sub="Stopwatch · AMRAP · EMOM" onClick={() => b.openView('timer')} />
      <ToolRow icon="calculator" title="1RM calculator" sub="Epley and Brzycki" onClick={() => b.openView('calc')} />
      <ToolRow
        icon="import"
        title="Import workouts"
        sub="Shows you what's in the file before anything is saved"
        onClick={() => fileInput.current?.click()}
      />
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
      {importer.preview && (
        <div style={{ padding: '4px 0 12px' }}>
          <ImportPreview preview={importer.preview} onCommit={importer.commit} onCancel={importer.cancel} />
        </div>
      )}
    </section>
  );
}

function ToolRow({ icon, title, sub, onClick }: { icon: IconName; title: string; sub: string; onClick: () => void }) {
  return (
    <Btn
      onClick={onClick}
      style={{
        minHeight: 56,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderTop: `1px solid ${C.line}`,
        textAlign: 'left',
        color: C.ink,
      }}
    >
      <Icon name={icon} size={20} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: T.title, fontWeight: 800 }}>{title}</span>
        <span style={{ fontSize: T.sm, fontWeight: 600, color: C.tertiary }}>{sub}</span>
      </span>
      <Icon name="chevron-right" size={16} style={{ color: C.tertiary }} />
    </Btn>
  );
}
