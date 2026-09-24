// Proposing links between Bompa movements and a provider's entries.
//
// A bad automatic match is worse than none: the sheet would confidently show a
// Romanian deadlift under "Deadlift", with a credit line making it look
// authoritative. So matching only ever *suggests*. The user confirms, picks
// another, or says there is no match — and nothing is shown until they do.

import type { ContentLink, Exercise } from '@/lib/types';
import { backoffUntil } from './fetcher';
import type { ContentProvider, ExternalMatch, FailureReason, ProviderContext } from './provider';

/** A suggestion has to clear this. Below it, the movement just says "No match found". */
export const MATCH_THRESHOLD = 0.5;
/** Searches per run. Enough for every lift in a real programme, and a bounded spend of anyone's quota. */
export const MAX_SEARCHES_PER_RUN = 40;

// Spellings that mean the same kit. Folded before comparing, so "DB Row" and
// "Dumbbell Row" are one name.
const SYNONYMS: Record<string, string> = {
  bb: 'barbell',
  db: 'dumbbell',
  dumbell: 'dumbbell',
  dumbells: 'dumbbell',
  dumbbells: 'dumbbell',
  kb: 'kettlebell',
  kettlebells: 'kettlebell',
  ez: 'ezbar',
  ohp: 'overhead',
  pullup: 'pull',
  pullups: 'pull',
  chinup: 'chin',
  chinups: 'chin',
  pushup: 'push',
  pushups: 'push',
  presses: 'press',
  rows: 'row',
  curls: 'curl',
  squats: 'squat',
  deadlifts: 'deadlift',
  raises: 'raise',
  extensions: 'extension',
  lunges: 'lunge',
};

// Words that carry no identity: "Squat with Barbell" is "Barbell Squat".
const FILLER = new Set(['the', 'a', 'an', 'with', 'on', 'of', 'to', 'and', 'up', 'ups']);

// A result carrying one of these when the Bompa name doesn't is a different
// lift that happens to share words. "Deadlift" and "Romanian Deadlift" have
// half their tokens in common and nothing else.
const QUALIFIERS = new Set([
  'romanian',
  'rdl',
  'stiff',
  'sumo',
  'deficit',
  'paused',
  'pause',
  'single',
  'one',
  'unilateral',
  'front',
  'incline',
  'decline',
  'close',
  'wide',
  'reverse',
  'split',
  'bulgarian',
  'hack',
  'box',
  'pin',
  'block',
  'rack',
  'jump',
  'jumping',
  'smith',
  'machine',
  'cable',
  'band',
  'banded',
  'kneeling',
  'assisted',
]);

const QUALIFIER_PENALTY = 0.5;
const EQUIPMENT_BONUS = 0.15;

export function nameTokens(name: string): string[] {
  const words = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => SYNONYMS[word] ?? word)
    .filter((word) => !FILLER.has(word));
  return [...new Set(words)];
}

type Named = Pick<Exercise, 'name'> & { equipment?: string };

/**
 * How well a provider entry fits a Bompa movement, from about -1 to a little
 * over 1. Shared tokens over all tokens, plus a small bonus when the kit
 * agrees and a large penalty for each qualifier only the result has.
 */
export function scoreMatch(movement: Named, candidate: Pick<ExternalMatch, 'name' | 'equipment'>): number {
  const ours = new Set(nameTokens(movement.name));
  const theirs = new Set(nameTokens(candidate.name));
  if (ours.size === 0 || theirs.size === 0) return 0;

  let shared = 0;
  for (const token of theirs) if (ours.has(token)) shared += 1;
  const union = new Set([...ours, ...theirs]).size;
  let score = shared / union;

  const kit = new Set([...nameTokens(movement.equipment ?? ''), ...ours]);
  const theirKit = nameTokens(candidate.equipment ?? '');
  if (theirKit.length > 0 && theirKit.some((token) => kit.has(token))) score += EQUIPMENT_BONUS;

  for (const token of theirs) {
    if (QUALIFIERS.has(token) && !ours.has(token)) score -= QUALIFIER_PENALTY;
  }
  return score;
}

/** The best candidate above the threshold, or null. Ties go to the provider's own ordering. */
export function bestMatch(movement: Named, candidates: ExternalMatch[]): { match: ExternalMatch; score: number } | null {
  let best: { match: ExternalMatch; score: number } | null = null;
  for (const match of candidates) {
    const score = scoreMatch(movement, match);
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { match, score };
  }
  return best;
}

/** The one question that decides whether a link may supply content. */
export function isUsableLink(link: ContentLink | undefined): link is ContentLink & { externalId: string } {
  return Boolean(link && link.status === 'confirmed' && link.externalId);
}

export type MatchRun = {
  /** New suggestions, ready to store. */
  suggestions: ContentLink[];
  searched: number;
  /** Why the run ended early, if it did. */
  stoppedBy?: FailureReason;
};

/**
 * Search the provider for each movement that has no link yet, one request at
 * a time, and propose the best result for each.
 *
 * Any existing link — suggested, confirmed or "no match" — means the user has
 * either been asked or has answered, so that movement is left alone. That is
 * what makes "No match" stick.
 */
export async function findMatches(args: {
  provider: ContentProvider;
  ctx: () => ProviderContext;
  movements: (Named & { id: string })[];
  existing: ContentLink[];
  now: number;
  limit?: number;
}): Promise<MatchRun> {
  const { provider, movements, existing, now } = args;
  const limit = args.limit ?? MAX_SEARCHES_PER_RUN;
  const decided = new Set(existing.filter((l) => l.providerId === provider.id).map((l) => l.exerciseId));
  const suggestions: ContentLink[] = [];
  let searched = 0;

  for (const movement of movements) {
    if (searched >= limit) break;
    if (decided.has(movement.id)) continue;
    decided.add(movement.id);
    searched += 1;

    const ctx = args.ctx();
    if (ctx.signal.aborted) break;
    let results: ExternalMatch[];
    try {
      results = await provider.search(movement.name, ctx);
    } catch {
      // Adapters are not supposed to throw; one that does is a bug, and a bug in
      // one search is no reason to lose the suggestions already found.
      return { suggestions, searched, stoppedBy: 'unexpected' };
    }
    // Adapters report a spent quota as "no results", so the run asks the network
    // helper whether it has just paused this provider. Carrying on would spend
    // the rest of the run on requests that are refused before they leave.
    if (backoffUntil(provider.id) !== null) return { suggestions, searched, stoppedBy: 'quota' };
    const best = bestMatch(movement, results);
    if (!best) continue;
    suggestions.push({
      providerId: provider.id,
      exerciseId: movement.id,
      externalId: best.match.externalId,
      externalName: best.match.name,
      status: 'suggested',
      method: 'auto',
      at: now,
    });
  }
  return { suggestions, searched };
}
