// @vitest-environment jsdom

// The RPE button on Train and the sheet behind it, on their own: what the
// button says in each state, and that one tap in the sheet is enough.

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RpeButton, RpePickerSheet } from './RpeEntry';

afterEach(cleanup);

/** The button and sheet wired together the way the Train screen does it. */
function Harness(props: { value: number | null; target: number; onPick: (next: number | null) => void; onExplain: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <RpeButton value={props.value} target={props.target} onClick={() => setOpen(true)} />
      <RpePickerSheet open={open} onClose={() => setOpen(false)} {...props} />
    </>
  );
}

function setup(value: number | null, target = 8) {
  const onPick = vi.fn();
  const onExplain = vi.fn();
  render(<Harness value={value} target={target} onPick={onPick} onExplain={onExplain} />);
  return { onPick, onExplain };
}

describe('the RPE button', () => {
  it('unset, it names the target that will be recorded', () => {
    setup(null, 8);
    const button = screen.getByRole('button', { name: 'RPE: not set, target 8 — choose' });
    expect(button.textContent).toContain('RPE 8 · target');
  });

  it('set, it shows the value and what it means', () => {
    setup(9);
    const button = screen.getByRole('button', { name: 'RPE 9 — change' });
    expect(button.textContent).toContain('RPE 9');
    expect(button.textContent).toContain('One rep left in the tank.');
  });

  it('opens the picker, and one tap chooses and closes', () => {
    const { onPick } = setup(null);
    fireEvent.click(screen.getByRole('button', { name: /^RPE: not set/ }));
    expect(screen.getByRole('dialog', { name: 'How hard was that set?' })).toBeTruthy();
    // Nothing chosen yet, so there is nothing to clear.
    expect(screen.queryByRole('button', { name: /^Clear/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'RPE 9' }));
    expect(onPick).toHaveBeenCalledWith(9);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clear hands back to the target and closes', () => {
    const { onPick } = setup(9);
    fireEvent.click(screen.getByRole('button', { name: 'RPE 9 — change' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear — log my target' }));
    expect(onPick).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the explainer link closes the picker before opening the explainer', () => {
    const { onExplain, onPick } = setup(null);
    fireEvent.click(screen.getByRole('button', { name: /^RPE: not set/ }));
    fireEvent.click(screen.getByRole('button', { name: /^What.s RPE\?$/ }));
    expect(onExplain).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
