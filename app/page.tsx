'use client';

import { useEffect } from 'react';
import { AndroidFrame } from '@/components/AndroidFrame';
import { MethodGuideSheet } from '@/components/MethodGuideSheet';
import { TabBar } from '@/components/TabBar';
import { Toast } from '@/components/Toast';
import { EditSetSheet } from '@/components/screens/EditSetSheet';
import { FinishSummary } from '@/components/screens/FinishSummary';
import { SetTypeSheet } from '@/components/screens/SetTypeSheet';
import { History } from '@/components/screens/History';
import { HowToSheet } from '@/components/screens/HowToSheet';
import { Log } from '@/components/screens/Log';
import { Plan } from '@/components/screens/Plan';
import { RateSheet } from '@/components/screens/RateSheet';
import { RestOverlay, useRestView } from '@/components/screens/RestOverlay';
import { RoutineBuilder } from '@/components/screens/RoutineBuilder';
import { RpeSheet } from '@/components/screens/RpeSheet';
import { Setup } from '@/components/screens/Setup';
import { Today } from '@/components/screens/Today';
import { PushedScreen } from '@/components/screens/ToolViews';
import { Workouts } from '@/components/screens/Workouts';
import { SettingsSheet } from '@/components/SettingsSheet';
import { useThemeColor } from '@/components/useThemeColor';
import { TimerAlerts } from '@/components/TimerAlerts';
import { C } from '@/lib/tokens';
import { BompaProvider, useBompa } from '@/state/BompaContext';

export default function Page() {
  return (
    <BompaProvider>
      <Frame />
    </BompaProvider>
  );
}

/**
 * The frame sits inside the provider so its status bar can follow whatever
 * dark surface is at the top of the screen: the Train screen (and the rest
 * countdown, which only ever opens over it), or the ink header of the finish
 * summary, which covers Today.
 *
 * One condition drives both the preview frame and the real phone's status
 * bar, so the two cannot drift apart.
 */
function Frame() {
  const { s } = useBompa();
  const dark = s.hydrated && ((s.tab === 'log' && s.pushed === null) || s.summary !== null);
  // The rest screen's last ten seconds are amber from edge to edge, the bar included.
  const urgent = useRestView().urgent;
  useThemeColor(urgent ? C.amber : dark ? C.ink : C.screen);
  return (
    <AndroidFrame dark={dark} urgent={urgent}>
      <App />
    </AndroidFrame>
  );
}

function App() {
  const b = useBompa();

  // Registered here rather than in the layout so it only runs client-side, and
  // only in production — in development it would serve stale bundles.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // A failed registration costs offline loading, not the app.
    });
  }, []);

  return (
    <div
      style={{
        background: C.screen,
        height: '100%',
        overflow: 'hidden',
        color: C.ink,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      <StorageBanner />

      {/* Setup owns the viewport and suppresses the tab bar, so it is a branch
          of its own rather than one more screen inside the scrolling area. */}
      {b.s.hydrated && b.needsSetup ? (
        <>
          <Setup />
          <ToastSlot />
        </>
      ) : (
        <>
          <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {!b.s.hydrated ? <Booting /> : b.s.pushed ? <PushedScreen /> : <Screen />}
          </div>
          <ToastSlot />
          <TabBar />
          {/* Drawn from the shell, not from Today, so the sheet and the erase
              question over it cover the tab bar as well. */}
          <SettingsSheet />
        </>
      )}

      {/* Full-screen layers cover the tab bar too, so they live in the shell
          rather than inside a screen. The bottom sheets stack above both: a
          How-to opened from the rest screen has to land on top of it. */}
      <RestOverlay />
      <FinishSummary />

      {/* Overlays live outside the branch so setup can open them too. */}
      <HowToSheet />
      <EditSetSheet />
      <RateSheet />
      <RpeSheet />
      <SetTypeSheet />
      {b.s.editingRoutineId && (
        <RoutineBuilder routineId={b.s.editingRoutineId} onClose={() => b.patch({ editingRoutineId: null })} />
      )}
      {/* After the builder, not before: both sit at the same layer, so the one
          drawn later is on top, and the builder's help buttons open this. */}
      <MethodGuideSheet />
      <TimerAlerts />
    </div>
  );
}

function Screen() {
  const { s } = useBompa();
  if (s.tab === 'home') return <Today />;
  if (s.tab === 'log') return <Log />;
  if (s.tab === 'plan') return <Plan />;
  if (s.tab === 'stats') return <History />;
  return <Workouts />;
}

function Booting() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <span className="pulse" style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.18em', color: C.muted }}>
        BOMPA
      </span>
    </div>
  );
}

/**
 * A zero-height strip on top of the tab bar that the toast hangs from, so it
 * sits a fixed distance above the bar without anyone having to know how tall
 * the bar is.
 *
 * On Train with a session open, the toast moves into the sticky footer above
 * the Log button instead, and this one stands down.
 */
function ToastSlot() {
  const b = useBompa();
  const inTrainFooter = b.s.tab === 'log' && b.s.pushed === null && b.openSession !== null && !b.needsSetup;
  if (inTrainFooter) return null;
  return (
    <div style={{ position: 'relative', height: 0, flex: 'none' }}>
      <Toast placement="shell" />
    </div>
  );
}

/**
 * Storage has stopped accepting writes.
 *
 * A banner rather than a toast, and deliberately so. This is a *condition*,
 * not an event: it stays true until the app is reloaded, and every set logged
 * while it holds is being kept in memory alone. A toast was the first attempt
 * and it was worse than nothing — `logSet` raises "Set logged. Rest running."
 * on the same tap, which buried the warning and left the reassuring lie on
 * screen. It sits above the tab bar so it is visible from every screen rather
 * than only from the settings, which is where this used to hide.
 */
function StorageBanner() {
  const { s } = useBompa();
  if (s.storageOk) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: C.redBg,
        borderBottom: `1px solid ${C.redBd}`,
        padding: '9px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        flex: 'none',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.red, flex: 'none' }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: C.redDark, lineHeight: 1.4 }}>
        Not saving to this device. Today&rsquo;s sets are in memory only — export a backup from Settings (the gear on Today) before you reload.
      </span>
    </div>
  );
}
