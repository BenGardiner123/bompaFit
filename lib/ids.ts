// Id generation for user-created records.
//
// Routines use a string primary key rather than an auto-increment, so ids have
// to be minted client-side. They are derived from the name so the database is
// readable when you go looking, and disambiguated with a counter rather than a
// random suffix so the same inputs always produce the same id — which is what
// makes this testable without stubbing a clock or a random source.

/** Lowercase, hyphenated, ASCII-safe. "Push Day — Heavy" becomes "push-day-heavy". */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    // Strip the combining marks NFKD just split off, so "piernás" slugs to
    // "piernas" rather than losing the vowel. Escapes rather than literals —
    // combining characters are invisible in an editor and get mangled by tools.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // A name of pure punctuation would slug to nothing, and an empty primary key
  // silently overwrites whatever else slugged to nothing.
  return slug || 'routine';
}

/**
 * A slug that isn't already taken. `exists` is passed in rather than read from
 * the database so this stays pure and the collision path is testable.
 */
export function uniqueId(name: string, exists: (id: string) => boolean): string {
  const base = slugify(name);
  if (!exists(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!exists(candidate)) return candidate;
  }
  // A thousand routines with the same name is not a real scenario, but silently
  // returning a duplicate primary key would be a data-loss bug, so refuse.
  throw new Error(`Could not find a free id for "${name}" after 1000 attempts`);
}

/** "Push Day" → "Push Day copy" → "Push Day copy 2". Used by routine duplication. */
export function copyName(name: string, exists: (name: string) => boolean): string {
  return freeName(`${name} copy`, name, exists);
}

/**
 * "Push A" for a strength block → "Push A (Strength)" → "Push A (Strength) 2".
 * The phase in the name is what tells two versions of a workout apart in the
 * library, where the block they belong to is not shown.
 */
export function versionName(name: string, label: string, exists: (name: string) => boolean): string {
  return freeName(`${name} (${label})`, name, exists);
}

function freeName(base: string, original: string, exists: (name: string) => boolean): string {
  if (!exists(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} ${n}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`Could not find a free name for "${original}" after 1000 attempts`);
}
