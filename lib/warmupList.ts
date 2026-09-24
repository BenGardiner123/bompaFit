// Warm-up helpers the editor and the Train card need, kept apart from
// lib/warmup.ts and free of imports. Both load on demand, and anything they
// share with the startup bundle gets pulled out of that bundle's single
// hoisted module — a leaf of constants and small functions is the cheapest
// thing to share.

import type { WarmupItem } from './types';

export const WARMUP_LIMITS = {
  /** Long enough for "Spiderman lunge with rotation"; short enough to fit one line on a phone. */
  NAME: 60,
  /** "5 each side", "30 s", "8 slow" — a dose, not a paragraph. */
  DOSE: 30,
  /** A warm-up, not a second workout. */
  ITEMS: 20,
} as const;

/** How a typed name is compared with a common move's, so "Cat-cow " finds "Cat-cow". */
export function moveKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Move one item up (-1) or down (+1). Out of range is a no-op, not a wrap. */
export function moveWarmupItem<T>(list: readonly T[], index: number, by: number): T[] {
  const to = index + by;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [lifted] = next.splice(index, 1);
  next.splice(to, 0, lifted!);
  return next;
}

/**
 * A new item, trimmed and cut to length, with an id no other item in the list
 * has — `w1`, `w2`, and so on. Null for a blank name or a full list.
 */
export function newWarmupItem(name: string, dose: string, list: readonly WarmupItem[]): WarmupItem | null {
  const cleanName = name.trim().slice(0, WARMUP_LIMITS.NAME).trim();
  if (!cleanName || list.length >= WARMUP_LIMITS.ITEMS) return null;
  const taken = new Set(list.map((item) => item.id));
  let n = list.length + 1;
  while (taken.has(`w${n}`)) n++;
  const cleanDose = dose.trim().slice(0, WARMUP_LIMITS.DOSE).trim();
  return cleanDose ? { id: `w${n}`, name: cleanName, dose: cleanDose } : { id: `w${n}`, name: cleanName };
}

/**
 * "3 of 6 done". Only ticks that still name an item count, so editing the list
 * mid-session can't leave the count claiming more than exists.
 */
export function warmupProgress(items: readonly WarmupItem[], done: readonly string[]): { done: number; total: number } {
  const ticked = new Set(done);
  return { done: items.filter((item) => ticked.has(item.id)).length, total: items.length };
}
