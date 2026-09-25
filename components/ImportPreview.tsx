'use client';

// Importing a Bompa export, from anywhere it is offered (restoring a backup in
// Settings, and importing workouts on the Workouts tab). One flow so the rule holds everywhere: read the file, show what it
// holds, and write nothing until the lifter says so. An import that
// half-succeeds is worse than one that asks first.

import { useState } from 'react';
import { applyEnvelope, parseEnvelope } from '@/lib/exchange';
import { C, R, T, num, onInk } from '@/lib/tokens';
import { useBompa } from '@/state/BompaContext';
import { Btn } from '@/components/ui';

type Preview = { counts: Record<string, number>; text: string };

// Most tables read fine by their stored name. These don't, and a person
// restoring a backup shouldn't have to decode one.
const TABLE_LABEL: Record<string, string> = { contentLinks: 'exercise links' };

/** State and actions for one import: choose a file, then commit or cancel. */
export function useImport() {
  const b = useBompa();
  const [preview, setPreview] = useState<Preview | null>(null);

  const choose = async (file: File) => {
    const text = await file.text();
    const parsed = parseEnvelope(text);
    if (!parsed.ok) {
      b.say(parsed.error);
      return;
    }
    setPreview({ counts: parsed.counts, text });
  };

  const commit = async () => {
    if (!preview) return;
    // Parsed again rather than held from the first read, so what is written is
    // exactly the text that was previewed and nothing kept alongside it.
    const parsed = parseEnvelope(preview.text);
    if (!parsed.ok) return;
    try {
      await applyEnvelope(parsed.envelope);
      const total = Object.values(parsed.counts).reduce((sum, n) => sum + n, 0);
      setPreview(null);
      b.say(`Imported ${total} records. Reload to see them.`);
    } catch {
      b.say('The file was readable but the import failed. Nothing changed.');
    }
  };

  return { preview, choose, commit, cancel: () => setPreview(null) };
}

/** What the chosen file holds, with Import it / Cancel. Nothing is written before "Import it". */
export function ImportPreview({
  preview,
  onCommit,
  onCancel,
  dark = false,
}: {
  preview: Preview;
  onCommit: () => void;
  onCancel: () => void;
  /** Drawn inside an ink sheet, where the light-surface greys and the ink button would disappear. */
  dark?: boolean;
}) {
  const found = Object.entries(preview.counts).filter(([, count]) => count > 0);
  const quiet = dark ? onInk.muted : C.tertiary;
  // On ink the main action is amber, the one colour that says "tap this" there.
  const commit = dark ? { background: C.amber, color: C.ink } : { background: C.ink, color: C.white };
  const cancel = dark ? { border: `1px solid ${onInk.control}`, color: onInk.text } : { border: `1px solid ${C.lineStrong}`, color: C.ink };
  return (
    <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {found.length > 0 ? (
        <div role="group" aria-label="Found in that file" style={{ display: 'flex', flexWrap: 'wrap', columnGap: 22, rowGap: 8, padding: '4px 0' }}>
          {found.map(([table, count]) => (
            <div key={table} style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: T.count, fontWeight: 800, ...num }}>{count.toLocaleString('en-GB')}</span>
              <span style={{ fontSize: T.xs, fontWeight: 700, color: quiet }}>{TABLE_LABEL[table] ?? table}</span>
            </div>
          ))}
        </div>
      ) : (
        <span style={{ fontSize: T.note, lineHeight: 1.5, color: quiet }}>That file is a Bompa export, but it holds nothing to import.</span>
      )}
      <div style={{ display: 'flex', gap: 7 }}>
        <Btn
          onClick={onCommit}
          disabled={found.length === 0}
          style={{ flex: 1, height: 46, borderRadius: R.control, ...commit, fontSize: T.copy, fontWeight: 800 }}
        >
          Import it
        </Btn>
        <Btn
          onClick={onCancel}
          style={{ flex: 1, height: 46, borderRadius: R.control, ...cancel, fontSize: T.copy, fontWeight: 800 }}
        >
          Cancel
        </Btn>
      </div>
    </div>
  );
}
