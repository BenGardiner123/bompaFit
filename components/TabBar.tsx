'use client';

import { C, FONT, Z, onInk } from '@/lib/tokens';
import { useBompa, type Tab } from '@/state/BompaContext';

const ICONS: Record<Tab, string> = {
  home: 'M4 11.5 12 4l8 7.5V20h-5v-6H9v6H4z',
  log: 'M4 9h2v6H4zM18 9h2v6h-2zM6 12h12M8 7v10M16 7v10',
  plan: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  stats: 'M4 19V9M10 19V5M16 19v-7M22 19H2',
  tools: 'M12 3a9 9 0 1 0 9 9h-9z',
};

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Today' },
  { id: 'log', label: 'Train' },
  { id: 'plan', label: 'Plan' },
  { id: 'stats', label: 'History' },
  { id: 'tools', label: 'Tools' },
];

export function TabBar() {
  const { s, go } = useBompa();
  // Train is used mid-set, often under harsh gym lights, and is dark all the
  // way down. A white bar under it would be the brightest thing on screen.
  const dark = s.tab === 'log' && !s.library;

  return (
    <nav
      aria-label="Main"
      style={{
        position: 'relative',
        flex: 'none',
        zIndex: Z.tabBar,
        background: dark ? C.ink : 'rgba(255,255,255,.97)',
        backdropFilter: 'blur(12px)',
        borderTop: `1px solid ${dark ? onInk.line : C.line}`,
        // The extra bottom padding is the Android gesture bar's home for its
        // pill; content underneath it is unreachable.
        padding: '8px 10px calc(20px + env(safe-area-inset-bottom))',
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 2,
      }}
    >
      {TABS.map((tab) => {
        const on = s.tab === tab.id && !s.library;
        // amberDark and tertiary are tuned for white and sink into ink, so the
        // dark bar uses their on-ink counterparts.
        const color = dark ? (on ? C.amber : onInk.muted) : on ? C.amberDark : C.tertiary;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => go(tab.id)}
            aria-current={on ? 'page' : undefined}
            style={{
              height: 52,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontFamily: FONT,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              padding: 0,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ width: 21, height: 21 }}
              aria-hidden
            >
              <path d={ICONS[tab.id]} />
            </svg>
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.02em', color }}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
