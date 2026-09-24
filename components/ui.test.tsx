// @vitest-environment jsdom

// The shared primitives every redesigned screen is built from. What is checked
// here is behaviour a screen relies on without looking: how a sheet closes,
// what a screen reader hears, and which state a picker announces.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DarkSheet, EditableNumber, HeroNumeral, HeroTabs, InkButton, InkChip, Row } from './ui';

afterEach(cleanup);

describe('DarkSheet', () => {
  function open(onClose = vi.fn(), extra: { closeText?: string; label?: string } = {}) {
    render(
      <DarkSheet open onClose={onClose} title="Count what you left behind" eyebrow="RPE" {...extra}>
        <p>Body</p>
      </DarkSheet>,
    );
    return onClose;
  }

  it('is a modal dialog named by its title', () => {
    open();
    const dialog = screen.getByRole('dialog', { name: 'Count what you left behind' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('takes a separate accessible name when the title is not enough', () => {
    open(vi.fn(), { label: 'Edit set 2' });
    expect(screen.getByRole('dialog', { name: 'Edit set 2' })).toBeTruthy();
  });

  it('closes on Escape', () => {
    const onClose = open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a tap outside the panel, but not inside it', () => {
    const onClose = open();
    fireEvent.click(screen.getByText('Body'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the round ✕, or from a text action when one is given', () => {
    const onClose = open();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();

    const onCancel = open(vi.fn(), { closeText: 'Cancel' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders nothing and ignores Escape while closed', () => {
    const onClose = vi.fn();
    render(
      <DarkSheet open={false} onClose={onClose} title="Hidden">
        <p>Body</p>
      </DarkSheet>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('HeroNumeral', () => {
  it('gives a screen reader the sentence, not the bare figure', () => {
    render(<HeroNumeral value={78} size={132} label="↑ Primed" sub="fatigue 41" ariaLabel="Readiness 78 out of 100, primed" />);
    expect(screen.getByText('Readiness 78 out of 100, primed')).toBeTruthy();
    // The visible figure is there for sighted users and hidden from everyone else.
    expect(screen.getByText('78').closest('[aria-hidden]')).not.toBeNull();
  });
});

describe('pickers', () => {
  it('HeroTabs stay buttons and announce which one is showing', () => {
    const onChange = vi.fn();
    render(
      <HeroTabs
        label="Plan view"
        value="cal"
        onChange={onChange}
        options={[
          { value: 'cal', label: 'Calendar' },
          { value: 'meso', label: 'Mesocycle' },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Calendar' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Mesocycle' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Mesocycle' }));
    expect(onChange).toHaveBeenCalledWith('meso');
  });

  it('InkChip announces its selected state', () => {
    render(
      <InkChip on onClick={() => {}} meta="2/4">
        Bench
      </InkChip>,
    );
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('touch targets', () => {
  it('InkButton never goes below 44px, even when asked to', () => {
    render(<InkButton height={40}>Finish</InkButton>);
    expect(screen.getByRole('button', { name: 'Finish' }).style.height).toBe('44px');
  });
});

describe('Row', () => {
  it('is a button named by its text when it has an action', () => {
    const onClick = vi.fn();
    render(<Row title="Push Day" sub="4 lifts" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Push Day/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is plain text without one', () => {
    render(<Row title="Push Day" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('EditableNumber', () => {
  function setup(extra: Partial<Parameters<typeof EditableNumber>[0]> = {}) {
    const onCommit = vi.fn();
    render(<EditableNumber label="Weight" unit="kg" value={80} min={0} max={1000} precision={0.25} onCommit={onCommit} {...extra} />);
    return onCommit;
  }

  function openBox() {
    fireEvent.click(screen.getByRole('button', { name: 'Weight 80 kg, tap to type' }));
    return screen.getByRole('textbox', { name: 'Weight in kg' }) as HTMLInputElement;
  }

  it('shows the figure as a button that says it can be typed', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Weight 80 kg, tap to type' }).textContent).toBe('80');
  });

  it('opens a numeric text box holding the value, focused and selected', () => {
    setup();
    const box = openBox();
    expect(box.value).toBe('80');
    expect(box.inputMode).toBe('decimal');
    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(2);
  });

  it('commits on Enter, rounded, and goes back to the figure', () => {
    const onCommit = setup();
    const box = openBox();
    fireEvent.change(box, { target: { value: '120,4' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(120.5);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('commits when focus leaves the box', () => {
    const onCommit = setup();
    const box = openBox();
    fireEvent.change(box, { target: { value: '95' } });
    fireEvent.blur(box);
    expect(onCommit).toHaveBeenCalledWith(95);
  });

  it('clamps to the bounds', () => {
    const onCommit = setup();
    const box = openBox();
    fireEvent.change(box, { target: { value: '5000' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(1000);
  });

  it('puts the old value back on Escape, without closing the sheet around it', () => {
    const onCommit = setup();
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    const box = openBox();
    fireEvent.change(box, { target: { value: '120' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    window.removeEventListener('keydown', onWindowKey);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onWindowKey).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Weight 80 kg, tap to type' })).toBeTruthy();
  });

  it('writes nothing for an empty or invalid box', () => {
    const onCommit = setup();
    for (const text of ['', 'abc', '-5']) {
      const box = openBox();
      fireEvent.change(box, { target: { value: text } });
      fireEvent.keyDown(box, { key: 'Enter' });
    }
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not call back when the value did not move', () => {
    const onCommit = setup();
    fireEvent.keyDown(openBox(), { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('can draw and speak something other than the bare value', () => {
    setup({ value: 0, display: 'Bodyweight', spoken: 'Bodyweight' });
    const button = screen.getByRole('button', { name: 'Bodyweight, tap to type' });
    expect(button.textContent).toBe('Bodyweight');
  });

  it('opens empty for a value that is not set yet', () => {
    setup({ value: 0, display: '—', spoken: 'Weight not set', openEmpty: true });
    fireEvent.click(screen.getByRole('button', { name: 'Weight not set, tap to type' }));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
  });

  it('keeps a 44px target however small the figure', () => {
    setup({ style: { fontSize: 14 } });
    const button = screen.getByRole('button', { name: /tap to type/ });
    expect(button.style.minHeight).toBe('44px');
    expect(button.style.minWidth).toBe('44px');
  });
});
