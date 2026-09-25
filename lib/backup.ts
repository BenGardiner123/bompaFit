// How old the last backup is, in words. Counted in calendar days rather than
// 24-hour blocks, so a backup made last night reads as "yesterday" this morning
// even though fewer than 24 hours have passed.

import { dateKey, daysBetween } from './calc';

export function lastBackupPhrase(lastExportAt: number | null, now: number): string {
  if (lastExportAt === null) return 'No backup yet. Everything lives on this phone alone.';
  const days = Math.max(0, daysBetween(dateKey(lastExportAt), dateKey(now)));
  if (days === 0) return 'Last backup today.';
  if (days === 1) return 'Last backup yesterday.';
  return `Last backup ${days} days ago.`;
}
