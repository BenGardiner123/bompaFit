'use client';

// Editing a warm-up checklist: a workout's own list in the builder, and the
// default list in Settings.
//
// Loaded on demand, and deliberately imports nothing from the app's shared
// components or state — only tokens and a leaf of editing helpers. Whatever a
// lazy chunk imports from the startup bundle has to be split back out of that
// bundle's single hoisted module, and splitting the shared primitives or the
// context costs the startup bundle more than lazy loading saves. Plain buttons
// and props keep the saving real.

import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { WARMUP_LIMITS, moveKey, moveWarmupItem, newWarmupItem } from '@/lib/warmupList';
import { WARMUP_MOVES } from '@/lib/warmupMoves';
import { C, FONT, R, T, TOUCH, num } from '@/lib/tokens';
import type { Routine, WarmupItem } from '@/lib/types';
import { Icon } from '@/components/icons';

/**
 * The builder's warm-up section: use the default list, or give this workout
 * its own. Switching to the default keeps the workout's own list underneath,
 * so switching back doesn't throw away what was typed.
 */
export function RoutineWarmup({
  draft,
  defaults,
  onChange,
}: {
  draft: Routine;
  /** The lifter's default list, named here when the workout uses it. */
  defaults: readonly WarmupItem[];
  onChange: (next: Routine) => void;
}): ReactNode {
  const usesDefault = Boolean(draft.warmupUsesDefault);

  return (
    <section
      aria-label="Warm-up"
      style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: R.block, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 800 }}>Warm-up</h3>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.tertiary }}>a checklist, not logged</span>
      </div>

      <button
        type="button"
        aria-pressed={usesDefault}
        onClick={() => onChange({ ...draft, warmupUsesDefault: !usesDefault })}
        style={{ ...plain, minHeight: TOUCH, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}
      >
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            flex: 'none',
            boxSizing: 'border-box',
            borderRadius: R.tiny,
            border: `2px solid ${usesDefault ? C.ink : C.lineStrong}`,
            background: usesDefault ? C.ink : C.card,
            color: C.white,
            fontSize: 13,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {usesDefault && <Icon name="check" size={14} />}
        </span>
        <span style={{ fontSize: 13, fontWeight: 800 }}>Use my default warm-up</span>
      </button>

      {usesDefault ? (
        <p style={{ margin: 0, fontSize: T.sm, lineHeight: 1.5, color: C.ink60 }}>
          {defaults.length === 0
            ? 'Your default warm-up is empty. Set it up in Settings, under Default warm-up.'
            : `${defaults.map((item) => item.name).join(', ')}. Change the list in Settings.`}
        </p>
      ) : (
        <WarmupListEditor
          items={draft.warmup ?? []}
          onChange={(warmup) => onChange({ ...draft, warmup })}
          empty="No warm-up for this workout. Add a move or two to be reminded before the first lift."
        />
      )}
    </section>
  );
}

/** Add, remove and reorder the items of one list. Used for a workout's own list and for the default. */
export function WarmupListEditor({ items, onChange, empty }: { items: WarmupItem[]; onChange: (next: WarmupItem[]) => void; empty: string }): ReactNode {
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [picking, setPicking] = useState(false);
  const full = items.length >= WARMUP_LIMITS.ITEMS;
  const onList = new Set(items.map((item) => moveKey(item.name)));

  const add = (itemName: string, itemDose: string) => {
    const item = newWarmupItem(itemName, itemDose, items);
    if (item) onChange([...items, item]);
    return Boolean(item);
  };

  // Enter adds, the way a to-do list does, so a list can be typed in one go.
  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (add(name, dose)) {
      setName('');
      setDose('');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: T.sm, lineHeight: 1.5, color: C.tertiary }}>{empty}</p>
      ) : (
        <ol aria-label="Warm-up moves" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((item, index) => (
            <li key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0', borderTop: index ? `1px solid ${C.lineSoft}` : 'none' }}>
              {/* minWidth 0 lets a long name wrap instead of pushing the buttons off the edge. */}
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflowWrap: 'anywhere' }}>
                <span style={{ fontSize: 13, fontWeight: 800 }}>{item.name}</span>
                {item.dose && <span style={{ fontSize: 12, fontWeight: 700, color: C.tertiary, ...num }}>{item.dose}</span>}
              </span>
              <Square label={`Move ${item.name} up`} disabled={index === 0} onClick={() => onChange(moveWarmupItem(items, index, -1))}>
                <Icon name="arrow-up" size={15} />
              </Square>
              <Square label={`Move ${item.name} down`} disabled={index === items.length - 1} onClick={() => onChange(moveWarmupItem(items, index, 1))}>
                <Icon name="arrow-down" size={15} />
              </Square>
              <Square label={`Remove ${item.name}`} danger onClick={() => onChange(items.filter((_, i) => i !== index))}>
                <Icon name="close" size={15} />
              </Square>
            </li>
          ))}
        </ol>
      )}

      {full ? (
        <p style={{ margin: 0, fontSize: 12, color: C.tertiary, ...num }}>That&rsquo;s {WARMUP_LIMITS.ITEMS} moves, the most a warm-up holds.</p>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input aria-label="Warm-up move" placeholder="Move, e.g. Cat-cow" value={name} maxLength={WARMUP_LIMITS.NAME} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} style={{ ...field, flex: 1, minWidth: 0 }} />
          <input aria-label="How much" placeholder="e.g. 8 slow" value={dose} maxLength={WARMUP_LIMITS.DOSE} onChange={(e) => setDose(e.target.value)} onKeyDown={onEnter} style={{ ...field, width: 108, flex: 'none' }} />
          <Square
            label="Add move"
            disabled={!name.trim()}
            onClick={() => {
              if (!add(name, dose)) return;
              setName('');
              setDose('');
            }}
          >
            <Icon name="plus" size={18} />
          </Square>
        </div>
      )}

      <button
        type="button"
        aria-expanded={picking}
        onClick={() => setPicking(!picking)}
        style={{ ...plain, height: TOUCH, borderRadius: R.chip, border: `1px dashed ${C.lineStrong}`, color: C.ink60, fontSize: T.sm, fontWeight: 800 }}
      >
        {picking ? 'Done adding common moves' : '+ Add from common moves'}
      </button>

      {/* Inline rather than a sheet: it stays put while you tap several, and a
          chip already on the list shows as added instead of adding twice. */}
      {picking && (
        <div role="group" aria-label="Common moves" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {WARMUP_MOVES.map((move) => {
            const added = onList.has(moveKey(move.name));
            return (
              <button
                key={move.name}
                type="button"
                aria-pressed={added}
                disabled={added || full}
                onClick={() => add(move.name, move.dose)}
                style={{
                  ...plain,
                  minHeight: TOUCH,
                  padding: '0 12px',
                  borderRadius: R.chip,
                  border: `1px solid ${added ? C.ink : C.lineStrong}`,
                  background: added ? C.ink : C.card,
                  color: added ? C.white : C.ink80,
                  fontSize: T.sm,
                  fontWeight: 800,
                  // Added reads as done rather than unavailable, so no fade.
                  cursor: added ? 'default' : 'pointer',
                }}
              >
                {added && <Icon name="check" size={13} style={{ marginRight: 4, marginTop: -2 }} />}
                {move.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A button with the browser's own styling taken off, in the app's font. */
const plain: CSSProperties = { fontFamily: FONT, border: 'none', background: 'transparent', padding: 0, color: C.ink, cursor: 'pointer' };

const field: CSSProperties = {
  height: TOUCH,
  boxSizing: 'border-box',
  borderRadius: R.chip,
  border: `1px solid ${C.lineStrong}`,
  background: C.card,
  padding: '0 10px',
  fontSize: 13.5,
  fontWeight: 700,
  color: C.ink,
  fontFamily: 'inherit',
};

function Square({ children, onClick, label, disabled, danger }: { children: ReactNode; onClick: () => void; label: string; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...plain,
        width: TOUCH,
        height: TOUCH,
        flex: 'none',
        borderRadius: R.small,
        border: `1px solid ${danger ? C.redBd : C.lineStrong}`,
        background: danger ? C.redBg : C.card,
        color: danger ? C.redDark : C.ink60,
        fontSize: T.md,
        fontWeight: 800,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}
