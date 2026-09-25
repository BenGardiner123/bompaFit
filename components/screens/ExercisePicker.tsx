'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { C, FONT, R, T, onInk } from '@/lib/tokens';
import { useBompa } from '@/state/BompaContext';
import { DarkSheet, Row } from '@/components/ui';
import { sheetHairline } from '@/components/SheetParts';
import styles from '@/components/SheetSearch.module.css';

/**
 * The dark sheet's own top and bottom padding. The pinned search box and
 * footnote reach into it so nothing scrolling underneath peeks out round them.
 */
const PANEL_PAD = { top: 10, bottom: 26 } as const;

/**
 * Search the bundled movement library and drop a lift into the running session.
 * It is added to this session only — the routine itself is not edited, because
 * "I did some curls at the end" should not rewrite the programme.
 */
export function ExercisePicker({
  onClose,
  onPick,
  selectedIds,
  title = 'Add a lift',
  footnote = 'Adding a lift here changes today only. Your routine stays as programmed.',
  closeOnPick = true,
}: {
  onClose: () => void;
  /** Defaults to adding into the running session, which is what the logger wants. */
  onPick?: (exerciseId: string) => void;
  /** Ids already chosen, shown as taken. Defaults to the open session's lifts. */
  selectedIds?: Set<string>;
  title?: string;
  footnote?: string;
  closeOnPick?: boolean;
}) {
  const b = useBompa();
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);

  // Straight into the search box, because typing is the only reason to open
  // this. Done in an effect rather than with `autoFocus`: the sheet notes what
  // had focus when it opened so it can hand focus back on close, and autoFocus
  // would move focus before it looked, leaving it to "return" into itself.
  // This effect runs after the sheet's own, since the sheet is our child.
  useEffect(() => {
    search.current?.focus();
  }, []);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = b.exercises;
    if (!needle) return all;
    return all.filter(
      (exercise) =>
        exercise.name.toLowerCase().includes(needle) ||
        exercise.muscle.toLowerCase().includes(needle) ||
        exercise.pattern.toLowerCase().includes(needle) ||
        exercise.equipment.toLowerCase().includes(needle),
    );
  }, [query, b.exercises]);

  const taken = selectedIds ?? new Set(b.openSession?.exerciseIds ?? []);

  return (
    <DarkSheet open onClose={onClose} title={title} gap={14}>
      <label
        style={{
          display: 'flex',
          flexDirection: 'column',
          // Stays in view while the results scroll under it, so a second search
          // doesn't mean scrolling back up through 700 movements. The ink fill
          // hides the rows passing beneath.
          position: 'sticky',
          // Pinned into the panel's own top padding and filling it, so rows
          // scrolling past can't show through the strip above the search box.
          // The negative margin gives the space back so the layout is unchanged.
          top: -PANEL_PAD.top,
          marginTop: -PANEL_PAD.top,
          paddingTop: PANEL_PAD.top,
          // A little ink below the box too, so a half-scrolled row doesn't
          // butt straight up against it.
          paddingBottom: 8,
          marginBottom: -8,
          zIndex: 1,
          background: C.ink,
        }}
      >
        <span className="sr-only">Search movements</span>
        <input
          ref={search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, muscle or equipment"
          className={styles.search}
          style={
            {
              '--placeholder': onInk.body,
              height: 50,
              borderRadius: R.control,
              border: `1px solid ${onInk.control}`,
              background: onInk.line,
              padding: '0 14px',
              fontSize: 15,
              fontWeight: 600,
              color: onInk.text,
              fontFamily: FONT,
              width: '100%',
            } as CSSProperties
          }
        />
      </label>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {results.length === 0 && (
          <span style={{ fontSize: T.md, color: onInk.muted, padding: '14px 0', ...sheetHairline }}>Nothing matches “{query}”.</span>
        )}
        {results.map((exercise) => (
          <Row
            key={exercise.id}
            dark
            title={exercise.name}
            sub={`${exercise.muscle} · ${exercise.equipment}`}
            right={
              taken.has(exercise.id) && (
                <span style={{ flex: 'none', fontSize: T.xs, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: C.amberLight }}>
                  Added
                </span>
              )
            }
            onClick={() => {
              if (onPick) onPick(exercise.id);
              else b.addExerciseToSession(exercise.id);
              if (closeOnPick) onClose();
            }}
          />
        ))}
      </div>

      {/* Pinned to the bottom for the same reason the search is pinned to the
          top: with the whole library listed, a footnote after the last row would
          only be seen by someone who scrolled past 700 movements. */}
      <span
        style={{
          position: 'sticky',
          // The same trick as the search box, at the bottom edge.
          bottom: -PANEL_PAD.bottom,
          marginBottom: -PANEL_PAD.bottom,
          padding: `10px 0 ${PANEL_PAD.bottom}px`,
          background: C.ink,
          fontSize: 12,
          lineHeight: 1.5,
          color: onInk.muted,
          ...sheetHairline,
        }}
      >
        {footnote}
      </span>
    </DarkSheet>
  );
}
