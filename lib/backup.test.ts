import { describe, expect, it } from 'vitest';
import { lastBackupPhrase } from './backup';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('lastBackupPhrase', () => {
  it('says when there has never been a backup', () => {
    expect(lastBackupPhrase(null, at(2026, 9, 25))).toMatch(/^No backup yet/);
  });

  it('counts calendar days, not 24-hour blocks', () => {
    // Late last night to early this morning is under a day, but it was yesterday.
    expect(lastBackupPhrase(at(2026, 9, 24, 23), at(2026, 9, 25, 7))).toBe('Last backup yesterday.');
    expect(lastBackupPhrase(at(2026, 9, 25, 1), at(2026, 9, 25, 23))).toBe('Last backup today.');
    expect(lastBackupPhrase(at(2026, 9, 13), at(2026, 9, 25))).toBe('Last backup 12 days ago.');
  });

  it('holds across a daylight-saving change', () => {
    // Late March and late October move the clocks in most of Europe.
    expect(lastBackupPhrase(at(2026, 3, 28), at(2026, 3, 30))).toBe('Last backup 2 days ago.');
    expect(lastBackupPhrase(at(2026, 10, 24), at(2026, 10, 26))).toBe('Last backup 2 days ago.');
  });

  it('never reads a clock set backwards as a backup in the future', () => {
    expect(lastBackupPhrase(at(2026, 9, 26), at(2026, 9, 25))).toBe('Last backup today.');
  });
});
