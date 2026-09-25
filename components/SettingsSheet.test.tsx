// The storage dot sits beside the words "protected from eviction" or "not
// protected", so its colour has to agree with them. Green beside "not
// protected" reads as all clear when the browser may still clear the data.

import { describe, expect, it } from 'vitest';
import { C } from '@/lib/tokens';
import { storageState } from './SettingsSheet';

describe('the storage dot', () => {
  it('is green only when storage works and is protected from eviction', () => {
    expect(storageState(true, true)).toEqual({ colour: C.greenLight, label: 'Saving to this device, protected' });
  });

  it('is not green when saving but not protected', () => {
    const state = storageState(true, false);
    expect(state.colour).not.toBe(C.greenLight);
    expect(state.label).toBe('Saving to this device, not protected');
  });

  it('is not green while protection is still being checked', () => {
    expect(storageState(true, null).colour).not.toBe(C.greenLight);
  });

  it('is red when nothing is being saved, whatever protection says', () => {
    expect(storageState(false, true)).toEqual({ colour: C.redLight, label: 'Not saving to this device' });
  });
});
