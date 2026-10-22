'use client';

import { C, FONT, T, W, Z, onInk } from '@/lib/tokens';
import { useBompa, type Tab } from '@/state/BompaContext';
import { Icon, type IconName } from '@/components/icons';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Today', icon: 'home' },
  { id: 'log', label: 'Train', icon: 'train' },
  { id: 'plan', label: 'Plan', icon: 'plan' },
  { id: 'stats', label: 'History', icon: 'history' },
  { id: 'workouts', label: 'Workouts', icon: 'workouts' },
];

/**
 * Follows the surface above it: dark under Train, which is dark all the way
 * down, and white under every other screen, whose body is white. An ink bar
 * under a white screen drew a heavy band across the bottom that belonged to
 * neither.
 *
 * The current tab is ink (white on Train), not amber: amber means "tap this",
 * and the tab you are already on is the one thing on the bar there is no point
 * tapping.
 */
export function TabBar() {
  const { s, go } = useBompa();
  // A view pushed over Train, such as a tool, is light, so the bar goes light with it.
  const dark = s.tab === 'log' && s.pushed === null;

  return (
    <nav
      aria-label="Main"
      style={{
        position: 'relative',
        flex: 'none',
        zIndex: Z.tabBar,
        background: dark ? C.ink : C.card,
        borderTop: `1px solid ${dark ? onInk.raised : C.lineSoft}`,
        // The extra bottom padding is the Android gesture bar's home for its
        // pill; content underneath it is unreachable.
        padding: '6px 10px calc(20px + env(safe-area-inset-bottom))',
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 2,
      }}
    >
      {TABS.map((tab) => {
        const on = s.tab === tab.id;
        const color = on ? (dark ? C.white : C.ink) : dark ? onInk.muted : C.tertiary;
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
              gap: 4,
              padding: 0,
              color,
            }}
          >
            <Icon name={tab.icon} size={22} strokeWidth={1.8} />
            <span style={{ fontSize: T.xs, fontWeight: on ? W.button : W.label }}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
