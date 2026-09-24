'use client';

/**
 * Reviewing the links automatic matching suggested for one provider.
 *
 * A suggestion is a question, not an answer: nothing is shown on a How-to
 * sheet until the user accepts it here or links the movement by hand. A wrong
 * match with a confident credit line under it is worse than no match at all.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ExternalMatch } from '@/lib/content/provider';
import { C, FONT, R, TOUCH, num, onInk } from '@/lib/tokens';
import { useBompa } from '@/state/BompaContext';
import { DarkSheet, InkButton, Row } from '@/components/ui';
import { sheetHairline } from '@/components/SheetParts';

export function LinkReviewSheet({
  open,
  onClose,
  providerId,
  providerName,
}: {
  open: boolean;
  onClose: () => void;
  providerId: string;
  providerName: string;
}) {
  const b = useBompa();
  const anchor = useRef<HTMLSpanElement>(null);
  // undefined until looked for; null when there is no shell to draw into.
  const [host, setHost] = useState<HTMLElement | null | undefined>(undefined);
  const [choosing, setChoosing] = useState<string | null>(null);

  // Tools sits inside the app's scrolling area, on a sheet that is itself
  // positioned, so a bottom sheet drawn in place would cover the whole long
  // Tools page and put its panel off the bottom of the screen. The shell just
  // outside the scrolling area is the frame every other bottom sheet fills.
  useEffect(() => {
    if (!open) return;
    let node = anchor.current?.parentElement ?? null;
    while (node && !isScroller(node)) node = node.parentElement;
    setHost(node?.parentElement ?? null);
  }, [open]);

  const links = b.contentLinks.filter((l) => l.providerId === providerId);
  const suggestions = links.filter((l) => l.status === 'suggested' && l.externalId);
  const linked = links.filter((l) => l.status === 'confirmed').length;
  const none = links.filter((l) => l.status === 'none').length;
  const nameOf = (exerciseId: string) => b.exerciseById.get(exerciseId)?.name ?? exerciseId;

  const sheet = (
    <DarkSheet
      open={open}
      onClose={onClose}
      eyebrow={providerName}
      title="Suggested links"
      label={`Suggested links from ${providerName}`}
      sub={
        <span style={num}>
          {suggestions.length} to review · {linked} linked · {none} with no match
        </span>
      }
      gap={14}
    >
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: onInk.muted }}>
        Only links you accept are used. Check each pair names the same movement — a near miss like a Romanian deadlift for a deadlift
        would show the wrong instructions.
      </span>

      {suggestions.length === 0 && (
        <span style={{ fontSize: 14, color: onInk.muted, padding: '14px 0', ...sheetHairline }}>Nothing left to review.</span>
      )}

      <ul aria-label="Suggestions" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
        {suggestions.map((link) => {
          const name = nameOf(link.exerciseId);
          return (
            <li key={link.exerciseId} aria-label={name} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 0', ...sheetHairline }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 800 }}>{name}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: onInk.muted }}>
                  {providerName}: {link.externalName ?? link.externalId}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                <InkButton variant="white" height={TOUCH} label={`Accept ${name}`} onClick={() => b.confirmLinks(providerId, [link.exerciseId])}>
                  Accept
                </InkButton>
                <InkButton
                  height={TOUCH}
                  label={`Choose another for ${name}`}
                  pressed={choosing === link.exerciseId}
                  onClick={() => setChoosing(choosing === link.exerciseId ? null : link.exerciseId)}
                >
                  Choose another
                </InkButton>
                <InkButton
                  variant="ghost"
                  height={TOUCH}
                  color={onInk.muted}
                  label={`No match for ${name}`}
                  onClick={() => b.linkExercise(providerId, link.exerciseId, null)}
                >
                  No match
                </InkButton>
              </div>
              {choosing === link.exerciseId && (
                <ChooseAnother
                  providerId={providerId}
                  providerName={providerName}
                  movementName={name}
                  onPick={(match) => {
                    b.linkExercise(providerId, link.exerciseId, match);
                    setChoosing(null);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>

      {/* Below the list on purpose: reaching it means scrolling past every pair,
          so nobody accepts forty guesses without at least seeing them. */}
      {suggestions.length > 1 && (
        <InkButton variant="amber" height={56} onClick={() => b.confirmLinks(providerId, suggestions.map((l) => l.exerciseId))}>
          Accept all {suggestions.length}
        </InkButton>
      )}
    </DarkSheet>
  );

  return (
    <>
      <span ref={anchor} hidden />
      {/* With no shell found (rendered on its own), drawing in place still beats not opening. */}
      {open && host !== undefined && (host ? createPortal(sheet, host) : sheet)}
    </>
  );
}

function isScroller(node: HTMLElement): boolean {
  const overflow = getComputedStyle(node).overflowY;
  return overflow === 'auto' || overflow === 'scroll';
}

/** Search the provider by hand, starting from the Bompa name. */
function ChooseAnother({
  providerId,
  providerName,
  movementName,
  onPick,
}: {
  providerId: string;
  providerName: string;
  movementName: string;
  onPick: (match: ExternalMatch) => void;
}) {
  const b = useBompa();
  const [query, setQuery] = useState(movementName);
  const [results, setResults] = useState<ExternalMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  const search = async () => {
    setSearching(true);
    setResults(await b.searchProvider(providerId, query));
    setSearching(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 7 }}>
        <label style={{ flex: 1, minWidth: 0, display: 'flex' }}>
          <span className="sr-only">Search {providerName}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && query.trim() && !offline) void search();
            }}
            autoComplete="off"
            spellCheck={false}
            style={field}
          />
        </label>
        <InkButton height={TOUCH} onClick={() => void search()} disabled={searching || offline || !query.trim()}>
          {offline ? 'Needs a connection' : searching ? 'Searching…' : 'Search'}
        </InkButton>
      </div>
      {results !== null && results.length === 0 && (
        <span role="status" style={{ fontSize: 13, color: onInk.muted }}>
          {providerName} has nothing called “{query}”.
        </span>
      )}
      {results?.map((match) => (
        <Row
          key={match.externalId}
          dark
          titleSize={14}
          title={match.name}
          sub={[match.equipment, match.muscle].filter(Boolean).join(' · ') || undefined}
          label={`Link to ${match.name}`}
          onClick={() => onPick(match)}
        />
      ))}
    </div>
  );
}

const field: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: TOUCH,
  borderRadius: R.control,
  border: `1px solid ${onInk.control}`,
  background: onInk.line,
  color: onInk.text,
  padding: '0 12px',
  fontFamily: FONT,
  fontSize: 14,
  fontWeight: 600,
  caretColor: C.amber,
};
