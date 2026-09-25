'use client';

import { C, FONT, T, Z, onInk } from '@/lib/tokens';
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
 * Ink on every screen, not only on Train. One bar that never changes colour
 * reads as the frame of the app; a bar that flips between white and ink as you
 * move reads as five different apps.
 *
 * The current tab is white, not amber: amber means "tap this", and the tab you
 * are already on is the one thing on the bar there is no point tapping.
 */
export function TabBar() {
  const { s, go } = useBompa();

  return (
    <nav
      aria-label="Main"
      style={{
        position: 'relative',
        flex: 'none',
        zIndex: Z.tabBar,
        background: C.ink,
        borderTop: `1px solid ${onInk.line}`,
        // The extra bottom padding is the Android gesture bar's home for its
        // pill; content underneath it is unreachable.
        padding: '8px 10px calc(20px + env(safe-area-inset-bottom))',
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 2,
      }}
    >
      {TABS.map((tab) => {
        const on = s.tab === tab.id;
        const color = on ? C.white : onInk.muted;
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
              color,
            }}
          >
            <Icon name={tab.icon} size={22} />
            <span style={{ fontSize: T.xs, fontWeight: 800, letterSpacing: '.02em' }}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
