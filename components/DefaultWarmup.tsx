'use client';

// The default warm-up, in Settings. One list the lifter keeps once and points any
// workout at, so a warm-up that never changes isn't typed into every workout.
// The editor loads on demand; this shell is all the startup bundle carries.

import { Suspense, lazy } from 'react';
import { useBompa } from '@/state/BompaContext';
import { Section } from '@/components/ui';

// A failed load draws nothing rather than throwing the whole screen away.
const Editor = lazy(() =>
  import('@/components/WarmupEditor').then((m) => ({ default: m.WarmupListEditor })).catch(() => ({ default: () => null })),
);

export function DefaultWarmup() {
  const b = useBompa();
  return (
    <Section title="Default warm-up" right="a checklist on Train">
      <Suspense fallback={null}>
        <Editor
          items={b.defaultWarmup}
          onChange={b.setDefaultWarmup}
          empty="Nothing yet. A workout can use this list instead of its own: switch on Use my default warm-up when you edit it."
        />
      </Suspense>
    </Section>
  );
}
