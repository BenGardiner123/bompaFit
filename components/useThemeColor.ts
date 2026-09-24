'use client';

import { useEffect } from 'react';

/**
 * Keep `<meta name="theme-color">` in step with the screen.
 *
 * An installed app has no browser chrome, so the phone paints its status bar
 * from this tag. The layout sets it once for first paint; without this, a
 * light bar would sit over the dark Train screen and look like a rendering
 * fault.
 */
export function useThemeColor(color: string) {
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      // The layout always renders one, but a missing tag should not leave the
      // status bar stuck on whatever the browser defaulted to.
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = color;
  }, [color]);
}
