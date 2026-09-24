// @vitest-environment jsdom

// The method explainer sheet inside the real provider. The openers live on
// Train and in the routine builder; here a bare button stands in for them so
// the sheet can be checked on its own, for every guide.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { METHOD_GUIDE_KEYS, type MethodGuideKey } from '@/lib/methods';
import { METHOD_GUIDES } from '@/lib/methodGuides';
import { C, TOUCH } from '@/lib/tokens';
import { BompaProvider, useBompa } from '@/state/BompaContext';
import { MethodGuideSheet } from './MethodGuideSheet';

function Opener({ guide }: { guide: MethodGuideKey }) {
  const b = useBompa();
  return (
    <>
      <span data-testid="hydrated">{String(b.s.hydrated)}</span>
      <button type="button" onClick={() => b.openMethodGuide(guide)}>
        Open {guide}
      </button>
    </>
  );
}

async function openGuide(guide: MethodGuideKey) {
  render(
    <BompaProvider>
      <Opener guide={guide} />
      <MethodGuideSheet />
    </BompaProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('hydrated').textContent).toBe('true'), { timeout: 4000 });
  const opener = screen.getByRole('button', { name: `Open ${guide}` });
  opener.focus();
  fireEvent.click(opener);
  return { opener, dialog: await screen.findByRole('dialog', { name: `${METHOD_GUIDES[guide].title} explained` }) };
}

// WCAG relative luminance and contrast ratio.
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** jsdom reports inline colours as rgb(); the tokens are hex. */
function toHex(css: string): string | null {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(css);
  if (!match) return css.startsWith('#') ? css : null;
  return `#${match.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await db.close();
});

describe('MethodGuideSheet', () => {
  it('renders nothing while no guide is open', async () => {
    render(
      <BompaProvider>
        <Opener guide="tempo" />
        <MethodGuideSheet />
      </BompaProvider>,
    );
    // Wait for hydration so the provider isn't still writing when the database closes.
    await waitFor(() => expect(screen.getByTestId('hydrated').textContent).toBe('true'), { timeout: 4000 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(METHOD_GUIDE_KEYS)('%s opens as a named dialog with all five parts as headings', async (key) => {
    const guide = METHOD_GUIDES[key];
    const { dialog } = await openGuide(key);
    const sheet = within(dialog);

    expect(sheet.getByRole('heading', { level: 2, name: guide.title })).toBeTruthy();
    const headings = sheet.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['What it is', 'How to do it', 'How Bompa logs it', 'What Bompa counts', 'Watch out for']);

    expect(sheet.getByText(guide.what)).toBeTruthy();
    expect(sheet.getAllByRole('listitem').map((li) => li.textContent)).toEqual([...guide.steps]);
    expect(sheet.getByText(guide.logs)).toBeTruthy();
    expect(sheet.getByText(guide.counts)).toBeTruthy();
    expect(sheet.getByText(guide.caution)).toBeTruthy();
  });

  it('closes from its close button and hands focus back to what opened it', async () => {
    const { opener, dialog } = await openGuide('drop');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape', async () => {
    await openGuide('tempo');
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('asks the network for nothing when it opens', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetch);
    try {
      const { dialog } = await openGuide('cluster');
      expect(within(dialog).getByText(METHOD_GUIDES.cluster.counts)).toBeTruthy();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the close control at a full touch target', async () => {
    const { dialog } = await openGuide('amrap');
    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(TOUCH).toBeGreaterThanOrEqual(44);
    expect(parseFloat(close.style.height || close.style.minHeight)).toBeGreaterThanOrEqual(TOUCH);
  });

  it('draws every piece of text in a colour that reads on the sheet', async () => {
    const { dialog } = await openGuide('eccentric-only');
    const colours = new Set<string>();
    for (const el of dialog.querySelectorAll<HTMLElement>('h2, h3, p, li, ol')) {
      const own = el.style.color || getComputedStyle(el).color;
      const hex = own ? toHex(own) : null;
      if (hex) colours.add(hex.toLowerCase());
    }
    expect(colours.size).toBeGreaterThan(0);
    for (const colour of colours) {
      expect(contrast(colour, C.ink), `${colour} on the sheet`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
