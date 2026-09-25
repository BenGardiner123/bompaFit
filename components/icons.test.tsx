// @vitest-environment jsdom

// Icons replace font glyphs, so what matters is that they behave like the
// glyphs did where it counts: take the text colour, stay out of a button's
// accessible name, and come out the size they were asked for.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ICON_NAMES, Icon } from './icons';

afterEach(cleanup);

describe('Icon', () => {
  it.each(ICON_NAMES)('%s draws something on the shared 24-unit grid', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.children.length).toBeGreaterThan(0);
  });

  it('takes its colour from the text around it', () => {
    const { container } = render(<Icon name="close" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
  });

  it('fills rather than strokes the three dots, which vanish as rings at small sizes', () => {
    const { container } = render(<Icon name="more" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.getAttribute('stroke')).toBe('none');
  });

  it('draws the tick heavier, unless told otherwise', () => {
    const { container, rerender } = render(<Icon name="check" />);
    expect(container.querySelector('svg')!.getAttribute('stroke-width')).toBe('2.5');
    rerender(<Icon name="check" strokeWidth={3} />);
    expect(container.querySelector('svg')!.getAttribute('stroke-width')).toBe('3');
  });

  it('is sized by its prop', () => {
    const { container } = render(<Icon name="gear" size={16} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
  });

  it('stays out of the accessible name of the button it sits in', () => {
    render(
      <button type="button" aria-label="Close">
        <Icon name="close" />
      </button>,
    );
    const svg = screen.getByRole('button', { name: 'Close' }).querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('can stand alone with a name of its own', () => {
    render(<Icon name="help" label="Help" />);
    expect(screen.getByRole('img', { name: 'Help' })).toBeTruthy();
  });
});
