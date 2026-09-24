// The adapters Bompa knows about, in the order the Tools screen lists them.
//
// Adding an adapter:
//   1. Write lib/content/providers/<id>.ts exporting a `ContentProvider` whose
//      `id` equals the entry's id.
//   2. Replace that adapter's reserved line below with its entry, e.g.
//        { id: 'wger', name: 'wger', load: () => import('./wger').then((m) => m.wger) },
//
// Each adapter has its own reserved line, with unchanged lines between them, so
// two adapters written at the same time merge without a conflict. The entry
// uses a dynamic import so the adapter's code is only downloaded when someone
// uses it. Nothing else needs touching: the registry reads this list.

import type { ProviderEntry } from '../provider';

export const PROVIDER_ENTRIES: ProviderEntry[] = [
  { id: 'wger', name: 'wger', load: () => import('./wger').then((m) => m.wger) },

  { id: 'exercisedb', name: 'ExerciseDB', load: () => import('./exercisedb').then((m) => m.exercisedb) },

  // reserved: next adapter
];
