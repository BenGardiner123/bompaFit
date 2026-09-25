'use client';

// A phone bezel for desktop previewing only. Below FRAME_BREAKPOINT this
// renders nothing but the app itself — phones get the app, not a picture of a
// phone.
//
// The bare hex values below are the bezel itself — the housing gradient, the
// simulated status bar, the camera dot. They are a picture of a phone rather
// than part of the app, so they are deliberately not tokens: adding them to
// lib/tokens.ts would put desktop-only decoration in the design system every
// screen reads from. Anything that renders *inside* the frame uses tokens.

import { useEffect, useState, type ReactNode } from 'react';
import { C, DEVICE, FRAME_BREAKPOINT } from '@/lib/tokens';

export function AndroidFrame({
  children,
  dark = false,
  urgent = false,
}: {
  children: ReactNode;
  /** Paint the status bar ink, for the Train screen. */
  dark?: boolean;
  /** Paint it amber, for the rest screen's last ten seconds. */
  urgent?: boolean;
}) {
  const [framed, setFramed] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${FRAME_BREAKPOINT}px)`);
    const update = () => setFramed(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  if (!framed) {
    return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{children}</div>;
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '36px 20px',
        background: 'radial-gradient(120% 80% at 50% 0%, #F6F4F0 0%, #E4E1DA 70%)',
      }}
    >
      <div
        style={{
          width: DEVICE.width,
          height: DEVICE.height,
          borderRadius: 18,
          overflow: 'hidden',
          background: '#f4fbf8',
          border: '8px solid rgba(116,119,117,0.5)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        <StatusBar dark={dark} urgent={urgent} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{children}</div>
      </div>
    </div>
  );
}

function StatusBar({ dark, urgent }: { dark: boolean; urgent: boolean }) {
  return (
    <div
      style={{
        height: 34,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        position: 'relative',
        // Matches whatever the screen under it starts with, the way a real
        // phone tints its status bar to the app.
        background: urgent ? C.amber : dark ? C.ink : C.screen,
        fontFamily: 'Roboto, system-ui, sans-serif',
        fontSize: 13,
        color: dark && !urgent ? C.white : C.ink,
      }}
      aria-hidden
    >
      <span>9:41</span>
      <span style={{ position: 'absolute', left: '50%', top: 6, transform: 'translateX(-50%)', width: 20, height: 20, borderRadius: 100, background: '#2e2e2e' }} />
      <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <svg width="14" height="14" viewBox="0 0 16 16">
          <path d="M8 13.3L.67 5.97a10.37 10.37 0 0114.66 0L8 13.3z" fill="currentColor" />
        </svg>
        <svg width="14" height="14" viewBox="0 0 16 16">
          <rect x="3.75" y="2" width="8.5" height="13" rx="1.5" fill="currentColor" />
        </svg>
      </span>
    </div>
  );
}
