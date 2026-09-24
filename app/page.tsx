'use client';

import { useEffect } from 'react';
import { AndroidFrame } from '@/components/AndroidFrame';
import { MethodGuideSheet } from '@/components/MethodGuideSheet';
import { TabBar } from '@/components/TabBar';
import { EditSetSheet } from '@/components/screens/EditSetSheet';
import { FinishSummary } from '@/components/screens/FinishSummary';
import { SetTypeSheet } from '@/components/screens/SetTypeSheet';
import { History } from '@/components/screens/History';
import { HowToSheet } from '@/components/screens/HowToSheet';
import { Library } from '@/components/screens/Library';
import { Log } from '@/components/screens/Log';
import { Plan } from '@/components/screens/Plan';
import { RestOverlay } from '@/components/screens/RestOverlay';
import { RoutineBuilder } from '@/components/screens/RoutineBuilder';
import { RpeSheet } from '@/components/screens/RpeSheet';
import { Setup } from '@/components/screens/Setup';
import { Today } from '@/components/screens/Today';
import { Tools } from '@/components/screens/Tools';
import { useThemeColor } from '@/components/useThemeColor';
import { C, R, SHADOW, Z, onInk } from '@/lib/tokens';
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
  const dark = s.hydrated && ((s.tab === 'log' && !s.library) || s.summary !== null);
  useThemeColor(dark ? C.ink : C.screen);
  return (
    <AndroidFrame dark={dark}>
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

      {/* Setup owns the viewport and suppresses the tab bar — a fourth branch of
          the ternary below would leave the tabs live, which is why the Library
          sits there and this does not. */}
      {b.s.hydrated && b.needsSetup ? (
        <Setup />
      ) : (
        <>
          <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {!b.s.hydrated ? <Booting /> : b.s.library ? <Library /> : <Screen />}
          </div>
          <TabBar />
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
      <RpeSheet />
      <SetTypeSheet />
      {b.s.editingRoutineId && (
        <RoutineBuilder routineId={b.s.editingRoutineId} onClose={() => b.patch({ editingRoutineId: null })} />
      )}
      {/* After the builder, not before: both sit at the same layer, so the one
          drawn later is on top, and the builder's "?" buttons open this. */}
      <MethodGuideSheet />
      <Toast />
    </div>
  );
}

function Screen() {
  const { s } = useBompa();
  if (s.tab === 'home') return <Today />;
  if (s.tab === 'log') return <Log />;
  if (s.tab === 'plan') return <Plan />;
  if (s.tab === 'stats') return <History />;
  return <Tools />;
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

function Toast() {
  const { s } = useBompa();
  // On the dark Train screen an ink toast would vanish into the page, so it
  // lifts to the next shade up there.
  const onTrain = s.tab === 'log' && !s.library;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        left: 18,
        right: 18,
        bottom: 100,
        zIndex: Z.toast,
        pointerEvents: 'none',
        // Rendered always so screen readers keep a stable live region to
        // announce into; only visible when there is something to say.
        opacity: s.toast ? 1 : 0,
        transition: 'opacity .2s ease',
      }}
    >
      {s.toast && (
        <div
          className="sheet"
          style={{
            background: onTrain ? onInk.line : C.ink,
            borderRadius: R.control,
            padding: '13px 15px',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            boxShadow: SHADOW.toast,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.amber, flex: 'none' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: C.white, lineHeight: 1.4 }}>{s.toast.text}</span>
        </div>
      )}
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
 * than only from Tools, which is where this used to hide.
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
        Not saving to this device. Today&rsquo;s sets are in memory only — export a backup from Tools before you reload.
      </span>
    </div>
  );
}
