'use client';

import { useRef, useState } from 'react';
import { blocksUsing } from '@/lib/plan';
import { C, PH, PHASE_LABEL, R, T, TOUCH, W, num, onInk } from '@/lib/tokens';
import type { Routine } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { ImportPreview, useImport } from '@/components/ImportPreview';
import { Btn, InkButton, Segmented, useRise } from '@/components/ui';
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
  const rise = useRise();
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
    <div className={rise} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 16px 16px', background: C.card }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: W.title, letterSpacing: '-0.03em' }}>Workouts</h1>
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
              borderRadius: R.pill,
              background: C.ink,
              color: C.white,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: T.md,
              fontWeight: W.button,
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
          <p style={{ margin: 0, padding: '14px 0', borderTop: `1px solid ${C.lineSoft}`, fontSize: T.copy, lineHeight: 1.5, color: C.tertiary }}>
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

  if (!open) {
    return (
      <Btn
        onClick={onToggle}
        expanded={false}
        style={{ minHeight: 56, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', color: C.ink, borderTop: `1px solid ${C.lineSoft}` }}
      >
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: R.swatch, background: PH[routine.phase], flex: 'none' }} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: T.title, fontWeight: W.button }}>{routine.name}</span>
          <span style={{ fontSize: T.sm, fontWeight: W.label, color: C.tertiary, ...num }}>{sub}</span>
        </span>
        <Icon name="chevron-right" size={16} style={{ color: C.tertiary }} />
      </Btn>
    );
  }

  // Open, the workout is the same ink card Today leads with, so starting a
  // workout looks the same wherever it is done from.
  const status = running ? 'In progress' : isNext ? 'Next up' : null;
  const head = [status, PHASE_LABEL[routine.phase]].filter(Boolean).join(' · ');
  return (
    <div style={{ background: C.ink, color: onInk.text, borderRadius: R.hero, padding: 16, margin: '4px 0 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Btn
        onClick={onToggle}
        expanded
        // The name leads what is said, as it does on a closed row.
        label={`${routine.name} (${head})`}
        style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left', color: onInk.text, minHeight: TOUCH }}
      >
        <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, width: '100%', fontSize: T.sm, fontWeight: W.label, color: onInk.muted, ...num }}>
          <span>{head}</span>
          <span>~{routine.estMinutes} min</span>
        </span>
        <span style={{ fontSize: T.xl, fontWeight: W.title, letterSpacing: '-0.02em' }}>{routine.name}</span>
      </Btn>
      {/* One line, cut with an ellipsis: a six-lift workout wrapped to three
          lines and pushed Start down the screen. The full list is still in
          the text a screen reader reads, and Edit shows every lift. */}
      <p
        data-lift-line
        style={{
          margin: 0,
          fontSize: T.note,
          lineHeight: 1.45,
          color: onInk.body,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          ...num,
        }}
      >
        {liftLine(routine, (id) => b.exerciseById.get(id)?.name ?? id)}
        {blocks > 1 ? ` · used in ${blocks} blocks` : ''}
      </p>
      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <PrimaryAction routine={routine} running={running} isTemplate={isTemplate} />
        {!isTemplate && (
          <InkButton shape="circle" height={48} label={`Edit ${routine.name}`} onClick={() => b.patch({ editingRoutineId: routine.id })}>
            <Icon name="edit" size={18} />
          </InkButton>
        )}
      </div>
    </div>
  );
}

function PrimaryAction({ routine, running, isTemplate }: { routine: Routine; running: boolean; isTemplate: boolean }) {
  const b = useBompa();
  const base = { flex: 1, height: 48, borderRadius: R.pill, fontSize: T.title, fontWeight: W.button } as const;

  // A template is never trained directly. Copying it first is what makes the
  // routine yours to edit, and stops the app scheduling a programme you never chose.
  if (isTemplate) {
    return (
      <Btn onClick={() => void b.copyTemplate(routine.id)} style={{ ...base, background: C.white, color: C.ink }}>
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
      <Btn disabled style={{ ...base, background: onInk.raised, color: onInk.body }}>
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
      <h2 style={{ margin: 0, paddingBottom: 6, fontSize: T.sm, fontWeight: W.label, color: C.tertiary }}>
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
        borderTop: `1px solid ${C.lineSoft}`,
        textAlign: 'left',
        color: C.ink,
      }}
    >
      <Icon name={icon} size={20} strokeWidth={1.8} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: T.title, fontWeight: W.button }}>{title}</span>
        <span style={{ fontSize: T.sm, fontWeight: W.label, color: C.tertiary }}>{sub}</span>
      </span>
      <Icon name="chevron-right" size={16} style={{ color: C.tertiary }} />
    </Btn>
  );
}
