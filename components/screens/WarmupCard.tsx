'use client';

// The warm-up checklist at the top of Train: a reminder of the mobility and
// activation moves to do before the first lift. Ticking one logs nothing, so
// it can never move a load, a record or a chip count.
//
// Loaded on demand with the common moves' cues, and fed through props rather
// than reading the context or the shared components: whatever an on-demand
// chunk imports from the startup bundle has to be split back out of it, which
// costs more than loading on demand saves.

import { useState, type CSSProperties, type ReactNode } from 'react';
import { moveKey, warmupProgress } from '@/lib/warmupList';
import { WARMUP_MOVES } from '@/lib/warmupMoves';
import { C, FONT, R, T, TOUCH, num, onInk } from '@/lib/tokens';
import type { WarmupItem } from '@/lib/types';
import { Icon } from '@/components/icons';

const CUES = new Map(WARMUP_MOVES.map((move) => [moveKey(move.name), move.cue]));

export function WarmupCard({ items, done, onToggle }: { items: readonly WarmupItem[]; done: readonly string[]; onToggle: (id: string) => void }): ReactNode {
  const [open, setOpen] = useState(true);
  /** The item whose cue is showing, if any. One at a time keeps the card short. */
  const [cueFor, setCueFor] = useState<string | null>(null);

  const progress = warmupProgress(items, done);
  const ticked = new Set(done);

  return (
    <section
      aria-label="Warm-up"
      style={{ borderRadius: R.card, background: onInk.line, padding: '4px 14px', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: T.xs, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: C.amberLight }}>Warm-up</h2>
          <span data-testid="warmup-progress" style={{ fontSize: 12, fontWeight: 700, color: onInk.body, ...num }}>
            {progress.done} of {progress.total} done
          </span>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Hide warm-up' : 'Show warm-up'}
          onClick={() => setOpen(!open)}
          style={{ ...plain, minWidth: TOUCH, height: TOUCH, padding: '0 4px', color: C.amberLight, fontSize: T.sm, fontWeight: 800 }}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((item) => {
            const isDone = ticked.has(item.id);
            const cue = CUES.get(moveKey(item.name));
            const showing = cueFor === item.id && cue !== undefined;
            const text = <ItemText name={item.name} dose={item.dose} done={isDone} hasCue={cue !== undefined} />;
            return (
              <li key={item.id} style={{ borderTop: `1px solid ${onInk.control}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: TOUCH + 8 }}>
                  <button
                    type="button"
                    aria-label={item.name}
                    aria-pressed={isDone}
                    onClick={() => onToggle(item.id)}
                    style={{
                      ...plain,
                      width: TOUCH,
                      height: TOUCH,
                      flex: 'none',
                      boxSizing: 'border-box',
                      borderRadius: R.chip,
                      // Muted rather than the control grey: this card is the
                      // lighter ink, where the control grey all but disappears.
                      border: `2px solid ${isDone ? C.amber : onInk.muted}`,
                      background: isDone ? C.amber : 'transparent',
                      color: C.ink,
                      fontSize: 20,
                      fontWeight: 800,
                    }}
                  >
                    {isDone && <Icon name="check" size={20} />}
                  </button>
                  {/* Only a common move has a cue, so only its name is a button. */}
                  {cue === undefined ? (
                    <div style={textBox}>{text}</div>
                  ) : (
                    <button
                      type="button"
                      aria-expanded={showing}
                      aria-label={`How to do ${item.name}`}
                      onClick={() => setCueFor(showing ? null : item.id)}
                      style={{ ...plain, ...textBox, minHeight: TOUCH, textAlign: 'left' }}
                    >
                      {text}
                    </button>
                  )}
                </div>
                {showing && <p style={{ margin: '0 0 10px', paddingLeft: TOUCH + 10, fontSize: T.sm, lineHeight: 1.5, color: onInk.body }}>{cue}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ItemText({ name, dose, done, hasCue }: { name: string; dose?: string; done: boolean; hasCue: boolean }): ReactNode {
  return (
    <>
      <span style={{ fontSize: T.md, fontWeight: 800, color: done ? onInk.body : onInk.text, textDecoration: done ? 'line-through' : 'none' }}>
        {name}
        {/* A quiet mark that the name opens a cue — without it nobody finds it. */}
        {hasCue && (
          <span aria-hidden style={{ marginLeft: 6, fontSize: T.xs, color: C.amberLight }}>
            ⓘ
          </span>
        )}
      </span>
      {/* body, not muted: small text on this lighter ink needs the stronger grey. */}
      {dose && <span style={{ fontSize: 12, fontWeight: 700, color: onInk.body, ...num }}>{dose}</span>}
    </>
  );
}

/** A button with the browser's own styling taken off, in the app's font. */
const plain: CSSProperties = { fontFamily: FONT, border: 'none', background: 'transparent', padding: 0, color: 'inherit', cursor: 'pointer' };

/** minWidth 0 lets a long name wrap rather than push the row wider than the card. */
const textBox: CSSProperties = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' };
