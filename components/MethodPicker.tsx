'use client';

// The method sheet for one lift in the workout builder: pick a ready-made
// method, then adjust only the inputs that method uses.
//
// Every change goes straight into the builder's draft rather than waiting for a
// "Done" here — the builder already has its own save and cancel, and a second
// layer of both would be one more thing to forget to press.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { toDisplay, toKg } from '@/lib/calc';
import {
  METHOD_LIMITS,
  REP_STYLES,
  SEGMENT_STYLES,
  cloneSlot,
  describeTempo,
  formatTempo,
  parseTempo,
  resolveSlotMethod,
  type MethodGuideKey,
} from '@/lib/methods';
import {
  METHOD_PRESETS,
  PRESET_GROUPS,
  clearMethod,
  describeMethod,
  repStyleLabel,
  segmentStyleLabel,
  type PresetGroup,
} from '@/lib/methodPresets';
import { C, FONT, R, T, TOUCH, num, onInk } from '@/lib/tokens';
import type { RepStyle, RoutineSlot, SegmentPlan, SegmentStyle, SetPrescription, Unit } from '@/lib/types';
import { useBompa } from '@/state/BompaContext';
import { Btn, DarkSheet, InkButton, InkChip } from '@/components/ui';
import { SheetHeading, sheetHairline } from '@/components/SheetParts';
import { Icon } from '@/components/icons';

/** What a new piece of a set starts as, per style, when chosen by hand rather than from a preset. */
const SEGMENT_DEFAULTS: Record<SegmentStyle, SegmentPlan> = {
  drop: { style: 'drop', segmentReps: [null, null], intraRestSec: 0, dropFraction: 0.2 },
  'mechanical-drop': { style: 'mechanical-drop', segmentReps: [null, null], intraRestSec: 0, dropFraction: 0 },
  cluster: { style: 'cluster', segmentReps: [1, 1, 1, 1], intraRestSec: 15, dropFraction: 0 },
  'rest-pause': { style: 'rest-pause', segmentReps: [null, null], intraRestSec: 15, dropFraction: 0 },
};

/** Holds start at ten seconds: long enough to mean something, short enough to hold with a working weight. */
const DEFAULT_HOLD_SEC = 10;

export function MethodPicker({
  slot,
  exerciseName,
  grouped,
  groupGapSec,
  unit,
  onChange,
  onClose,
}: {
  slot: RoutineSlot;
  exerciseName: string;
  /** In a superset, triset or giant set: offers the gap after this lift. */
  grouped: boolean;
  /** The group's own gap, shown as what an empty per-lift gap falls back to. */
  groupGapSec: number;
  unit: Unit;
  onChange: (slot: RoutineSlot) => void;
  onClose: () => void;
}) {
  const b = useBompa();
  const [tab, setTab] = useState<PresetGroup>('sets');
  const method = resolveSlotMethod(slot);
  const summary = describeMethod(slot);
  const plain = summary === 'Straight sets';

  // Escape on an explainer opened from here should close only the explainer.
  const close = () => {
    if (b.s.methodGuide === null) onClose();
  };

  const edit = (mutate: (draft: RoutineSlot) => void) => {
    const draft = cloneSlot(slot);
    mutate(draft);
    onChange(draft);
  };

  const guide = (key: MethodGuideKey) => b.openMethodGuide(key);

  return (
    <DarkSheet open onClose={close} title="Method" eyebrow={exerciseName} label={`Method for ${exerciseName}`} gap={16}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span data-testid="method-summary" style={{ flex: 1, minWidth: 0, fontSize: T.md, fontWeight: 700, color: onInk.body, ...num }}>
          {summary}
        </span>
        <InkButton height={TOUCH} disabled={plain} onClick={() => onChange(clearMethod(slot))}>
          No method
        </InkButton>
      </div>

      {/* Presets: one group at a time, so the adjust inputs below are never
          more than a short scroll away. */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SheetHeading>Start from</SheetHeading>
        <div role="group" aria-label="Kind of method" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESET_GROUPS.map((group) => (
            <InkChip key={group.key} on={tab === group.key} onClick={() => setTab(group.key)}>
              {group.label}
            </InkChip>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {METHOD_PRESETS.filter((preset) => preset.group === tab).map((preset) => (
            <div key={preset.id} style={{ display: 'flex', alignItems: 'center', gap: 8, ...sheetHairline }}>
              <Btn
                onClick={() => onChange(preset.apply(slot))}
                style={{ flex: 1, minWidth: 0, minHeight: TOUCH, padding: '9px 0', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2 }}
              >
                <span style={{ fontSize: T.md, fontWeight: 800, color: onInk.text, ...num }}>{preset.label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: onInk.muted, ...num }}>{preset.description}</span>
              </Btn>
              <HelpButton label={`About ${preset.label}`} onClick={() => guide(preset.guide)} />
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12, ...sheetHairline, paddingTop: 14 }}>
        <SheetHeading>Adjust</SheetHeading>

        <SchemeEditor slot={slot} unit={unit} edit={edit} onGuide={() => guide('wave')} />

        <SegmentEditor slot={slot} plan={method.segments} edit={edit} onGuide={guide} />

        <TempoField slot={slot} edit={edit} onGuide={() => guide('tempo')} />

        <Block title="Each rep" onGuide={() => guide(method.repStyle === 'full' ? 'partial' : method.repStyle)} guideLabel="About rep styles">
          <div role="group" aria-label="Rep style" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {REP_STYLES.map((style) => (
              <InkChip
                key={style}
                on={method.repStyle === style}
                onClick={() =>
                  edit((draft) => {
                    setRepStyle(draft, style);
                  })
                }
              >
                {repStyleLabel(style)}
              </InkChip>
            ))}
          </div>
          {method.repStyle === 'isometric' && (
            <NumberField
              label="Seconds per hold"
              value={method.holdSec}
              min={1}
              max={120}
              onChange={(n) => edit((draft) => (draft.holdSec = n ?? DEFAULT_HOLD_SEC))}
            />
          )}
        </Block>

        <div style={{ display: 'flex', gap: 10 }}>
          <NumberField
            label="Rest after a set (s)"
            placeholder="Usual"
            value={method.restSec}
            min={0}
            max={METHOD_LIMITS.REST_MAX_SEC}
            onChange={(n) =>
              edit((draft) => {
                if (n === null) delete draft.restSec;
                else draft.restSec = n;
              })
            }
          />
          {grouped && (
            <NumberField
              label="Gap after this lift (s)"
              placeholder={String(groupGapSec)}
              value={method.gapAfterSec}
              min={0}
              max={METHOD_LIMITS.GAP_MAX_SEC}
              onChange={(n) =>
                edit((draft) => {
                  if (n === null) delete draft.gapAfterSec;
                  else draft.gapAfterSec = n;
                })
              }
            />
          )}
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <FieldLabel>Note</FieldLabel>
          <textarea
            value={slot.note ?? ''}
            maxLength={METHOD_LIMITS.NOTE_MAX}
            rows={2}
            placeholder="Anything else, e.g. lower with one leg"
            onChange={(event) =>
              edit((draft) => {
                // Stored as typed so a space mid-word isn't eaten; saving trims it.
                if (event.target.value === '') delete draft.note;
                else draft.note = event.target.value;
              })
            }
            style={{ ...inputStyle, height: 'auto', padding: '10px 12px', resize: 'none', fontWeight: 600 }}
          />
          <span style={{ alignSelf: 'flex-end', fontSize: T.xs, color: onInk.muted, ...num }}>
            {(slot.note ?? '').length}/{METHOD_LIMITS.NOTE_MAX}
          </span>
        </label>
      </section>
    </DarkSheet>
  );
}

function setRepStyle(draft: RoutineSlot, style: RepStyle) {
  // 'full' is what an absent field already means; storing it would only be
  // tidied away on save and make the draft look changed when it isn't.
  if (style === 'full') delete draft.repStyle;
  else draft.repStyle = style;
  if (style === 'isometric') draft.holdSec = draft.holdSec ?? DEFAULT_HOLD_SEC;
  else delete draft.holdSec;
}

// ─────────────────────────────────────────────────────────────
// Per-set scheme
// ─────────────────────────────────────────────────────────────

function loadText(entry: SetPrescription, unit: Unit): { value: number; suffix: string } {
  const load = entry.load ?? { kind: 'rel', x: 1 };
  if (load.kind === 'kg') return { value: toDisplay(load.x, unit), suffix: unit };
  return { value: Math.round(load.x * 1000) / 10, suffix: load.kind === 'pct' ? '% max' : '%' };
}

function SchemeEditor({
  slot,
  unit,
  edit,
  onGuide,
}: {
  slot: RoutineSlot;
  unit: Unit;
  edit: (mutate: (draft: RoutineSlot) => void) => void;
  onGuide: () => void;
}) {
  const scheme = slot.scheme;

  if (!scheme || scheme.length === 0) {
    return (
      <Block title="Sets" onGuide={onGuide} guideLabel="About per-set schemes">
        <span style={{ fontSize: T.sm, color: onInk.muted }}>Same reps and weight every set.</span>
        <InkButton
          height={TOUCH}
          onClick={() =>
            edit((draft) => {
              draft.scheme = Array.from({ length: Math.max(1, draft.sets) }, () => ({ reps: draft.reps, load: { kind: 'rel', x: 1 } }));
            })
          }
          style={{ alignSelf: 'flex-start' }}
        >
          Vary each set
        </InkButton>
      </Block>
    );
  }

  const setEntry = (index: number, patch: (entry: SetPrescription) => SetPrescription) =>
    edit((draft) => {
      draft.scheme = draft.scheme!.map((entry, i) => (i === index ? patch(entry) : entry));
    });

  return (
    <Block title="Sets" onGuide={onGuide} guideLabel="About per-set schemes">
      <span style={{ fontSize: 12, color: onInk.muted }}>Load is a share of the lift&rsquo;s working weight; 100% is the heaviest set.</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* One header for the columns rather than a label over every box; each
            box still carries its own name for a screen reader. */}
        <div aria-hidden style={{ display: 'flex', gap: 6 }}>
          <span style={{ width: 38, flex: 'none' }} />
          {['Reps', 'Load', 'Rest (s)'].map((heading) => (
            <span key={heading} style={{ flex: 1, minWidth: 64 }}>
              <FieldLabel>{heading}</FieldLabel>
            </span>
          ))}
          <span style={{ width: TOUCH, flex: 'none' }} />
        </div>
        {scheme.map((entry, index) => {
          const load = loadText(entry, unit);
          // Presets set these two; the marker keeps them visible while the
          // numbers around them are edited.
          let tag: string | null = null;
          if (entry.amrap) tag = 'AMRAP';
          else if (entry.type === 'backoff') tag = 'B/O';
          return (
            <div key={index} role="group" aria-label={`Set ${index + 1}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 38, flex: 'none', height: TOUCH, display: 'flex', flexDirection: 'column', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: onInk.body, ...num }}>
                {index + 1}
                {tag && <span style={{ fontSize: T.xs, fontWeight: 700, color: C.amberLight }}>{tag}</span>}
              </span>
              <NumberField
                compact
                label="Reps"
                value={entry.reps}
                min={1}
                max={METHOD_LIMITS.REPS_MAX}
                onChange={(n) => n !== null && setEntry(index, (e) => ({ ...e, reps: n }))}
              />
              <NumberField
                compact
                label={`Load (${load.suffix})`}
                value={load.value}
                min={0}
                max={entry.load?.kind === 'kg' ? METHOD_LIMITS.KG_MAX : METHOD_LIMITS.PCT_MAX * 100}
                step="any"
                onChange={(n) => {
                  if (n === null) return;
                  setEntry(index, (e) => {
                    const kind = e.load?.kind ?? 'rel';
                    // A fixed weight is typed in the lifter's unit and stored in
                    // kilograms, converted here once.
                    if (kind === 'kg') return { ...e, load: { kind, x: toKg(n, unit) } };
                    return { ...e, load: { kind, x: n / 100 } };
                  });
                }}
              />
              <NumberField
                compact
                label="Rest (s)"
                placeholder="—"
                value={entry.restSec ?? null}
                min={0}
                max={METHOD_LIMITS.REST_MAX_SEC}
                onChange={(n) =>
                  setEntry(index, (e) => {
                    const next = { ...e };
                    if (n === null) delete next.restSec;
                    else next.restSec = n;
                    return next;
                  })
                }
              />
              <InkButton
                shape="circle"
                height={TOUCH}
                label={`Remove set ${index + 1}`}
                disabled={scheme.length === 1}
                onClick={() =>
                  edit((draft) => {
                    draft.scheme = draft.scheme!.filter((_, i) => i !== index);
                    draft.sets = draft.scheme.length;
                  })
                }
              >
                <Icon name="close" size={16} />
              </InkButton>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <InkButton
          height={TOUCH}
          disabled={scheme.length >= METHOD_LIMITS.SCHEME_MAX_SETS}
          onClick={() =>
            edit((draft) => {
              const last = draft.scheme![draft.scheme!.length - 1]!;
              draft.scheme = [...draft.scheme!, { ...last, ...(last.load ? { load: { ...last.load } } : {}) }];
              draft.sets = draft.scheme.length;
            })
          }
        >
          + Add set
        </InkButton>
        <InkButton
          height={TOUCH}
          variant="ghost"
          onClick={() =>
            edit((draft) => {
              draft.sets = draft.scheme!.length;
              delete draft.scheme;
            })
          }
        >
          Same every set
        </InkButton>
      </div>
    </Block>
  );
}

// ─────────────────────────────────────────────────────────────
// Pieces within a set
// ─────────────────────────────────────────────────────────────

function SegmentEditor({
  slot,
  plan,
  edit,
  onGuide,
}: {
  slot: RoutineSlot;
  plan: SegmentPlan | null;
  edit: (mutate: (draft: RoutineSlot) => void) => void;
  onGuide: (key: MethodGuideKey) => void;
}) {
  // Edit what is stored, so a half-typed value is not snapped by the clamp
  // mid-keystroke; saving clamps it.
  const stored = slot.segments ?? null;
  const patch = (next: Partial<SegmentPlan>) =>
    edit((draft) => {
      if (draft.segments) draft.segments = { ...draft.segments, ...next };
    });

  const pieces = plan?.segmentReps.length ?? 0;
  const firstReps = plan?.segmentReps[0] ?? null;

  return (
    <Block title="Within each set" onGuide={() => onGuide(plan?.style ?? 'drop')} guideLabel="About drops, clusters and rest-pause">
      <div role="group" aria-label="Within each set" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <InkChip on={stored === null} onClick={() => edit((draft) => delete draft.segments)}>
          Nothing
        </InkChip>
        {SEGMENT_STYLES.map((style) => (
          <InkChip
            key={style}
            on={plan?.style === style}
            onClick={() => edit((draft) => (draft.segments = { ...SEGMENT_DEFAULTS[style], segmentReps: [...SEGMENT_DEFAULTS[style].segmentReps] }))}
          >
            {segmentStyleLabel(style)}
          </InkChip>
        ))}
      </div>
      {plan && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {plan.totalReps === undefined && (
            <NumberField
              label="Extra pieces"
              value={pieces}
              min={1}
              max={METHOD_LIMITS.SEGMENTS_MAX}
              onChange={(n) => {
                if (n === null || n < 1) return;
                patch({ segmentReps: Array.from({ length: n }, (_, i) => plan.segmentReps[i] ?? firstReps) });
              }}
            />
          )}
          {plan.totalReps === undefined && (
            <NumberField
              label="Reps each"
              placeholder="Max"
              value={firstReps}
              min={1}
              max={METHOD_LIMITS.REPS_MAX}
              onChange={(n) => patch({ segmentReps: plan.segmentReps.map(() => n) })}
            />
          )}
          {(plan.style === 'drop' || plan.style === 'cluster' || plan.style === 'rest-pause') && (
            <NumberField
              label="Drop each (%)"
              value={Math.round(plan.dropFraction * 100)}
              min={0}
              max={METHOD_LIMITS.DROP_FRACTION_MAX * 100}
              onChange={(n) => patch({ dropFraction: (n ?? 0) / 100 })}
            />
          )}
          {(plan.style === 'cluster' || plan.style === 'rest-pause') && (
            <NumberField
              label="Pause (s)"
              value={plan.intraRestSec}
              min={0}
              max={METHOD_LIMITS.INTRA_REST_MAX_SEC}
              onChange={(n) => patch({ intraRestSec: n ?? 0 })}
            />
          )}
          {plan.style === 'rest-pause' && (
            <NumberField
              label="Total reps"
              placeholder="None"
              value={plan.totalReps ?? null}
              min={1}
              max={METHOD_LIMITS.TOTAL_REPS_MAX}
              onChange={(n) =>
                edit((draft) => {
                  if (!draft.segments) return;
                  const next = { ...draft.segments };
                  if (n === null) {
                    delete next.totalReps;
                    // Without a total the set needs pieces of its own to carry on.
                    if (next.segmentReps.length === 0) next.segmentReps = [null, null];
                  } else next.totalReps = n;
                  draft.segments = next;
                })
              }
            />
          )}
          {plan.style === 'mechanical-drop' && (
            <label style={{ flex: '1 1 100%', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <FieldLabel>Versions, in order</FieldLabel>
              <input
                value={(stored?.labels ?? []).join(', ')}
                placeholder="e.g. incline, flat, decline"
                onChange={(event) => {
                  const labels = event.target.value.split(',').map((label) => label.trimStart());
                  patch(labels.some((label) => label.trim() !== '') ? { labels } : { labels: undefined });
                }}
                style={inputStyle}
              />
            </label>
          )}
        </div>
      )}
    </Block>
  );
}

// ─────────────────────────────────────────────────────────────
// Tempo
// ─────────────────────────────────────────────────────────────

function TempoField({
  slot,
  edit,
  onGuide,
}: {
  slot: RoutineSlot;
  edit: (mutate: (draft: RoutineSlot) => void) => void;
  onGuide: () => void;
}) {
  const stored = resolveSlotMethod(slot).tempo;
  const [text, setText] = useState(stored ? formatTempo(stored) : '');

  // A preset or "No method" can change the tempo under the field; follow it
  // unless what is typed already means the same thing.
  useEffect(() => {
    const typed = parseTempo(text);
    const same = typed && stored ? formatTempo(typed) === formatTempo(stored) : !typed && !stored;
    if (!same) setText(stored ? formatTempo(stored) : '');
    // Only an outside change to the stored tempo should rewrite the field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored ? formatTempo(stored) : '']);

  const parsed = parseTempo(text);
  const feedback =
    text.trim() === '' ? 'Four figures: down, pause, up, pause. X means as fast as you can.' : parsed ? describeTempo(parsed) : 'Not a tempo yet. Try 3110, 30X or 10/0/10.';

  return (
    <Block title="Tempo" onGuide={onGuide} guideLabel="About tempo">
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span className="sr-only">Tempo</span>
        <input
          value={text}
          placeholder="e.g. 3110"
          inputMode="text"
          autoCapitalize="characters"
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            const tempo = parseTempo(next);
            // Only a readable tempo is stored; clearing the field clears it.
            // A half-typed one leaves the last good value alone.
            if (tempo) edit((draft) => (draft.tempo = tempo));
            else if (next.trim() === '') edit((draft) => delete draft.tempo);
          }}
          style={{ ...inputStyle, letterSpacing: '.12em' }}
        />
      </label>
      <span
        aria-live="polite"
        data-testid="tempo-reading"
        style={{ fontSize: T.sm, fontWeight: 600, color: text.trim() !== '' && !parsed ? C.redLight : onInk.muted }}
      >
        {feedback}
      </span>
    </Block>
  );
}

// ─────────────────────────────────────────────────────────────
// Small parts
// ─────────────────────────────────────────────────────────────

const inputStyle: CSSProperties = {
  height: TOUCH,
  width: '100%',
  boxSizing: 'border-box',
  borderRadius: R.chip,
  border: `1px solid ${onInk.control}`,
  background: onInk.line,
  color: onInk.text,
  padding: '0 10px',
  fontSize: 15,
  fontWeight: 800,
  fontFamily: FONT,
  ...num,
};

function FieldLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: T.xs, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: onInk.muted }}>{children}</span>;
}

function Block({ title, children, onGuide, guideLabel }: { title: string; children: ReactNode; onGuide: () => void; guideLabel: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: onInk.text }}>{title}</span>
        <HelpButton label={guideLabel} onClick={onGuide} />
      </div>
      {children}
    </div>
  );
}

function HelpButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <InkButton shape="circle" height={TOUCH} label={label} onClick={onClick} fontSize={T.md} color={onInk.muted}>
      <Icon name="help" size={20} />
    </InkButton>
  );
}

/**
 * A number typed rather than stepped: a wave has a dozen figures, and a
 * stepper per figure would be a wall of buttons. Empty means "not set" where
 * the field allows it. What is typed is kept as text until it reads as a
 * number, so clearing a field to retype it doesn't snap back.
 */
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  placeholder,
  step = 1,
  compact = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min: number;
  max: number;
  placeholder?: string;
  step?: number | 'any';
  /** Inside a table with its own column headings: the label is for screen readers only. */
  compact?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));

  useEffect(() => {
    const typed = text.trim() === '' ? null : Number(text);
    if (typed !== value) setText(value === null ? '' : String(value));
    // Follow outside changes only; the text itself is ours while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <label style={{ flex: 1, minWidth: 64, display: 'flex', flexDirection: 'column', gap: 5 }}>
      {compact ? <span className="sr-only">{label}</span> : <FieldLabel>{label}</FieldLabel>}
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (next.trim() === '') {
            onChange(null);
            return;
          }
          const n = Number(next);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        style={inputStyle}
      />
    </label>
  );
}
