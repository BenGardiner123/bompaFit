import { describe, expect, it } from 'vitest';
import { copyName, slugify, uniqueId } from './ids';

const none = () => false;
const taken = (...ids: string[]) => (id: string) => ids.includes(id);

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Push Day')).toBe('push-day');
    expect(slugify('Legs · Squat focus')).toBe('legs-squat-focus');
  });

  it('collapses runs of punctuation rather than leaving empty segments', () => {
    expect(slugify('Wendler 5/3/1 — Week A')).toBe('wendler-5-3-1-week-a');
  });

  it('trims leading and trailing separators', () => {
    expect(slugify('  ...Upper...  ')).toBe('upper');
  });

  it('never returns an empty string', () => {
    // An empty primary key would silently overwrite the last thing that had one.
    expect(slugify('!!!')).toBe('routine');
    expect(slugify('')).toBe('routine');
  });
});

describe('uniqueId', () => {
  it('uses the plain slug when it is free', () => {
    expect(uniqueId('Push Day', none)).toBe('push-day');
  });

  it('suffixes on collision', () => {
    expect(uniqueId('Push Day', taken('push-day'))).toBe('push-day-2');
    expect(uniqueId('Push Day', taken('push-day', 'push-day-2'))).toBe('push-day-3');
  });

  it('is deterministic — same inputs, same id', () => {
    expect(uniqueId('Push Day', taken('push-day'))).toBe(uniqueId('Push Day', taken('push-day')));
  });

  it('refuses rather than returning a duplicate key', () => {
    expect(() => uniqueId('Push Day', () => true)).toThrow(/free id/);
  });
});

describe('copyName', () => {
  it('appends copy, then numbers', () => {
    expect(copyName('Push Day', none)).toBe('Push Day copy');
    expect(copyName('Push Day', taken('Push Day copy'))).toBe('Push Day copy 2');
  });

  it('refuses rather than returning a duplicate name', () => {
    expect(() => copyName('Push Day', () => true)).toThrow(/free name/);
  });
});
