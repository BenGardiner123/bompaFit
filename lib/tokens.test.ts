import { describe, expect, it } from 'vitest';
import { C, ON_PHASE, PH, PH_ON_INK, onInk } from './tokens';

// WCAG relative luminance and contrast ratio, straight from the spec. Kept here
// rather than pulled in as a dependency — it is nine lines.

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

describe('contrast ratios', () => {
  it('the light segmented control reads on its grey track, on and off', () => {
    // Off options are ink60; muted (2.9:1) and tertiary (4.3:1) both fail here.
    expect(contrast(C.ink60, C.sunkenAlt)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(C.ink, C.card)).toBeGreaterThanOrEqual(4.5);
  });

  it('sanity-checks the maths against known pairs', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  // Body text meets WCAG AA (4.5:1) against its background.
  it.each([
    ['ink', C.ink],
    ['ink80', C.ink80],
    ['ink60', C.ink60],
    ['tertiary', C.tertiary],
    ['amberDark', C.amberDark],
    ['greenDark', C.greenDark],
    ['redDark', C.redDark],
    ['blueDark', C.blueDark],
  ])('%s passes AA on a white card', (_name, colour) => {
    expect(contrast(colour, C.card)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['ink', C.ink],
    ['ink80', C.ink80],
    ['ink60', C.ink60],
    ['tertiary', C.tertiary],
    ['amberDark', C.amberDark],
  ])('%s passes AA on the screen background', (_name, colour) => {
    expect(contrast(colour, C.screen)).toBeGreaterThanOrEqual(4.5);
  });

  it('white passes AA on the dark session card', () => {
    expect(contrast(C.white, C.ink)).toBeGreaterThanOrEqual(4.5);
  });

  it('semantic text on its own tinted background passes AA', () => {
    expect(contrast(C.amberDark, C.amberBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(C.redDark, C.redBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(C.greenDark, C.greenBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(C.blueDark, C.blueBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('semantic text also passes on the plain screen background', () => {
    expect(contrast(C.redDark, C.screen)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(C.greenDark, C.screen)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(C.amberDark, C.screen)).toBeGreaterThanOrEqual(4.5);
  });

  it('the amber call-to-action carries dark text, not white', () => {
    // #141410 on #F59E0B is readable; white on amber is not.
    expect(contrast(C.ink, C.amber)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(C.white, C.amber)).toBeLessThan(4.5);
  });

  // These two are documented as failing AA and are therefore restricted.
  it('records that muted and faint do not reach AA', () => {
    // `muted` clears the 3:1 floor for large text but not the 4.5:1 body floor.
    expect(contrast(C.muted, C.card)).toBeGreaterThanOrEqual(3);
    expect(contrast(C.muted, C.card)).toBeLessThan(4.5);
    // `faint` is decoration only — it does not even clear 3:1.
    expect(contrast(C.faint, C.card)).toBeLessThan(3);
  });

  // The dark surfaces: heroes, the Train screen and every bottom sheet.
  it.each([
    ['onInk.text', onInk.text],
    ['onInk.muted', onInk.muted],
    ['onInk.body', onInk.body],
    ['amber', C.amber],
    ['amberLight', C.amberLight],
    ['greenLight', C.greenLight],
    ['redLight', C.redLight],
    ['blueLight', C.blueLight],
  ])('%s passes AA as text on ink', (_name, colour) => {
    expect(contrast(colour, C.ink)).toBeGreaterThanOrEqual(4.5);
  });

  it('every phase has a readable numeral colour on ink', () => {
    for (const [phase, colour] of Object.entries(PH_ON_INK)) {
      expect(contrast(colour, C.ink), `${phase} numeral`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the dark tab bar and on-ink controls are readable', () => {
    // Active tab, and the ink text on a selected amber chip.
    expect(contrast(C.amber, C.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(C.ink, C.amber)).toBeGreaterThanOrEqual(4.5);
    // The selected segment is white with ink text.
    expect(contrast(C.ink, C.white)).toBeGreaterThanOrEqual(4.5);
  });

  // `ink80` is the raised card on ink and the urgent background. It is lighter,
  // so the set of text colours that survive on it is smaller.
  it.each([
    ['onInk.text', onInk.text],
    ['onInk.body', onInk.body],
    ['amber', C.amber],
    ['amberLight', C.amberLight],
    ['greenLight', C.greenLight],
  ])('%s passes AA as text on ink80', (_name, colour) => {
    expect(contrast(colour, C.ink80)).toBeGreaterThanOrEqual(4.5);
  });

  it('records that faint and redLight only reach the large-text floor on ink80', () => {
    // Fine for a big countdown numeral, not for a small label. Pinned so a
    // screen that puts either on ink80 at caption size gets questioned.
    for (const colour of [onInk.muted, C.redLight]) {
      expect(contrast(colour, C.ink80)).toBeGreaterThanOrEqual(3);
      expect(contrast(colour, C.ink80)).toBeLessThan(4.5);
    }
  });

  it('every phase colour carries a readable label on the macrocycle strip', () => {
    // The strip prints 9.5px labels straight onto the phase fill, so the text
    // colour has to clear AA against all five.
    for (const [phase, colour] of Object.entries(PH)) {
      expect(contrast(ON_PHASE, colour), `${phase} chip`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('white would not have worked on those fills', () => {
    // Guards the reason ON_PHASE exists, so nobody "tidies" it back to white.
    expect(contrast(C.white, PH.power)).toBeLessThan(3);
    expect(contrast(C.white, PH.strength)).toBeLessThan(3);
  });
});
