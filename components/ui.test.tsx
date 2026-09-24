// @vitest-environment jsdom

// The shared primitives every redesigned screen is built from. What is checked
// here is behaviour a screen relies on without looking: how a sheet closes,
// what a screen reader hears, and which state a picker announces.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DarkSheet, HeroNumeral, HeroTabs, InkButton, InkChip, Row } from './ui';

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
