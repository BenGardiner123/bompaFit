// The wger adapter: free, no account, Creative Commons entry by entry.
//
// wger answers browser calls from any origin, so everything here is a plain
// GET through providerFetch. Its descriptions arrive as HTML written by
// volunteers; this file is the only place that ever sees that HTML, and what
// leaves it is plain strings. Nothing wger sends is ever rendered as markup.

import { providerFetch, readJson } from '../fetcher';
import {
  MAX_ID_CHARS,
  clampHowTo,
  type CachePolicy,
  type ContentProvider,
  type ExternalMatch,
  type ProviderContext,
  type ProviderCredit,
  type ProviderHowTo,
  type ProviderMedia,
  type TestResult,
} from '../provider';

const DEFAULT_BASE = 'https://wger.de';
/** wger's own id for English in `translations[].language`. */
const ENGLISH = 2;
/** One page, no more. A person picking a match reads the top few; paging the rest spends the service's goodwill for nothing. */
const SEARCH_LIMIT = 10;
/**
 * Anything shorter than this is not instructions. The shortest real entries
 * are single sentences like "Very common shoulder exercise." — a name, not a how-to.
 */
const MIN_TEXT_CHARS = 40;
/** A single paragraph longer than this reads better as one step per sentence. */
const SPLIT_PARAGRAPH_CHARS = 200;
const FALLBACK_AUTHOR = 'wger.de contributors';

/**
 * wger's licence table, by id. The detail response names the exercise's own
 * licence in full but gives translations and images only an id, and fetching
 * /license/ on every sheet open would double the calls for five fixed rows.
 * The links are the ones wger's own table gives, so a credit points at the
 * terms the author actually chose.
 */
const LICENCES: Record<number, { name: string; url: string }> = {
  1: { name: 'CC-BY-SA 3', url: 'https://creativecommons.org/licenses/by-sa/3.0/deed.en' },
  2: { name: 'CC-BY-SA 4', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.en' },
  3: { name: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/deed.en' },
  4: { name: 'CC-BY 4', url: 'https://creativecommons.org/licenses/by/4.0/deed.en' },
  5: { name: 'ODbL', url: 'https://opendatacommons.org/licenses/odbl/1-0/' },
};

// ---------------------------------------------------------------------------
// Reading wger's JSON without trusting it

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function englishTranslation(exercise: Json): Json | undefined {
  return list(exercise.translations).find((t) => t.language === ENGLISH && str(t.name).trim() !== '');
}

function names(items: Json[]): string[] {
  // name_en is the plain word ("Chest"); name is the anatomical one ("Pectoralis major").
  const out = items.map((item) => (str(item.name_en) || str(item.name)).trim()).filter(Boolean);
  return [...new Set(out)];
}

function mainOf(items: Json[]): Json | undefined {
  return items.find((item) => item.is_main === true) ?? items[0];
}

// ---------------------------------------------------------------------------
// HTML to plain text

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  deg: '°',
  times: '×',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  bull: '•',
  middot: '·',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (_, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // Surrogates, NUL and out-of-range points are not characters; drop them rather than throw.
      const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : '';
    }
    // An entity we do not know would otherwise survive as literal "&foo;" in a step.
    return NAMED_ENTITIES[body.toLowerCase()] ?? '';
  });
}

function stripTags(html: string): string {
  // The second pass catches a tag cut off before its closing bracket, which
  // would otherwise survive as "<img src=x onerror=…" in a step.
  return html.replace(/<[^>]*>/g, ' ').replace(/<[a-z/!?][\s\S]*$/i, ' ');
}

function withoutControlCharacters(text: string): string {
  return Array.from(text, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('');
}

/** One block of text: tags gone, entities decoded, whitespace flattened, list markers dropped. */
function toPlain(fragment: string): string {
  // Decoding can turn "&lt;b&gt;" into "<b>", so strip tags again afterwards.
  // A step is never markup, even as literal text.
  const text = withoutControlCharacters(stripTags(decodeEntities(stripTags(fragment))))
    .replace(/\s+/g, ' ')
    // Inline tags become spaces, which strands punctuation: "to <a>stand</a>." must not read "stand ."
    .replace(/ ([.,;:!?])/g, '$1')
    .trim();
  // Volunteers write their own bullets: "-Rest your weight…", "1. Stand…".
  return text.replace(/^(?:[-*•–—]+\s*|\d{1,2}[.)]\s+)/, '').trim();
}

type Block = { text: string; item: boolean };

/**
 * Split a description into blocks, one per paragraph or list item, in order.
 * Returns the blocks as plain text.
 */
function blocksOf(html: string): Block[] {
  const cleaned = html
    // Remove script and style bodies whole — their contents are code, not words.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(script|style)\b[\s\S]*$/gi, ' ')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ');

  const blocks: Block[] = [];
  // Every block-level boundary becomes a split point. <li> is remembered so a
  // lead-in line can be joined to the list it introduces.
  const parts = cleaned.split(/(<li\b[^>]*>)|<\/?(?:p|div|ul|ol|li|h[1-6]|br|tr|table|blockquote)\b[^>]*>/i);
  let nextIsItem = false;
  for (const part of parts) {
    if (part === undefined) continue;
    if (/^<li\b/i.test(part)) {
      nextIsItem = true;
      continue;
    }
    for (const line of part.split(/\n+/)) {
      const text = toPlain(line);
      if (text) blocks.push({ text, item: nextIsItem });
    }
    nextIsItem = false;
  }
  return blocks;
}

function sentences(paragraph: string): string[] {
  // Split only where a capital follows, so "i.e. 40 yards" and "e.g. a bench" stay whole.
  return paragraph
    .replace(/([.!?])\s+(?=[A-Z"“(])/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Turn wger's description HTML into instruction steps. Returns [] for anything that is not instructions. */
export function descriptionToSteps(html: string): string[] {
  const blocks = blocksOf(html);
  const whole = blocks.map((b) => b.text).join(' ');
  if (isPlaceholder(whole)) return [];

  const steps: string[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    // "With the width of the grip you can control…:" followed by bullets reads
    // as one thought. Split apart, the bullets are fragments with no subject.
    if (!block.item && block.text.endsWith(':') && blocks[i + 1]?.item) {
      const items: string[] = [];
      while (blocks[i + 1]?.item) {
        items.push(blocks[i + 1]!.text.replace(/[.;]$/, ''));
        i += 1;
      }
      steps.push(`${block.text} ${items.join('; ')}.`);
      continue;
    }
    steps.push(block.text);
  }

  // One long paragraph is how most entries are written; a step per sentence is
  // what a person between sets can actually follow.
  if (steps.length === 1 && steps[0]!.length > SPLIT_PARAGRAPH_CHARS) return sentences(steps[0]!);
  return steps;
}

/**
 * Entries that exist but say nothing: importer boilerplate, empty
 * descriptions, a single short line.
 */
function isPlaceholder(text: string): boolean {
  if (text.trim().length < MIN_TEXT_CHARS) return true;
  return /^custom description created by\b/i.test(text.trim());
}

// ---------------------------------------------------------------------------
// Addresses and credits

function apiBase(ctx: Pick<ProviderContext, 'baseUrl'>): string {
  return (ctx.baseUrl?.trim() || DEFAULT_BASE).replace(/\/+$/, '');
}

/** Keep a media URL only if it is https on one of this adapter's media hosts. */
function allowedMedia(raw: unknown, ctx: Pick<ProviderContext, 'baseUrl'>): string | undefined {
  const value = str(raw);
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const allowed = ctx.baseUrl ? [new URL(apiBase(ctx)).host] : wger.mediaHosts;
    return url.protocol === 'https:' && allowed.includes(url.host) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function authorOf(row: Json): string {
  const people = [str(row.license_author), ...(Array.isArray(row.author_history) ? row.author_history : []).map(str)]
    .map((name) => name.trim())
    .filter(Boolean);
  const unique = [...new Set(people)];
  return unique.length > 0 ? unique.join(', ') : FALLBACK_AUTHOR;
}

function licenceOf(row: Json, exercise: Json): { name: string; url?: string } | undefined {
  const id = typeof row.license === 'number' ? row.license : undefined;
  if (id !== undefined && LICENCES[id]) return LICENCES[id];
  // Fall back to the exercise's own licence only when it is the same one.
  const own = isObject(exercise.license) ? exercise.license : undefined;
  if (!own || (id !== undefined && own.id !== id)) return undefined;
  const name = str(own.short_name).trim();
  const url = str(own.url).trim();
  return name ? { name, ...(url ? { url } : {}) } : undefined;
}

function creditFor(row: Json, exercise: Json, line: string, entryUrl: string): ProviderCredit {
  const licence = licenceOf(row, exercise);
  return {
    line,
    // clampHowTo drops a licence link that is not plain https.
    ...(licence ? { licence: licence.name, ...(licence.url ? { licenceUrl: licence.url } : {}) } : {}),
    author: authorOf(row),
    url: entryUrl,
  };
}

// ---------------------------------------------------------------------------
// The adapter

async function getJson(url: string, ctx: ProviderContext): Promise<{ ok: true; body: unknown } | { ok: false; outcome: TestResult }> {
  const result = await providerFetch(wger, url, ctx);
  if (!result.ok) return { ok: false, outcome: { ok: false, reason: result.reason, ...(result.detail ? { detail: result.detail } : {}) } };
  return { ok: true, body: await readJson(result.response) };
}

function resultsOf(body: unknown): Json[] | null {
  return isObject(body) && Array.isArray(body.results) ? list(body.results) : null;
}

function toMatch(exercise: Json, ctx: ProviderContext): ExternalMatch | null {
  const uuid = str(exercise.uuid);
  const english = englishTranslation(exercise);
  if (!uuid || !english) return null;
  const equipment = names(list(exercise.equipment)).join(', ');
  const muscle = names(list(exercise.muscles))[0];
  const image = mainOf(list(exercise.images));
  const thumbs = image && isObject(image.thumbnails) ? image.thumbnails : undefined;
  const thumbUrl = allowedMedia(thumbs?.small ?? image?.image, ctx);
  return {
    externalId: uuid,
    name: str(english.name).trim(),
    ...(equipment ? { equipment } : {}),
    ...(muscle ? { muscle } : {}),
    ...(thumbUrl ? { thumbUrl } : {}),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toHowTo(exercise: Json, externalId: string, ctx: ProviderContext): ProviderHowTo | null {
  const english = englishTranslation(exercise);
  if (!english) return null;
  const steps = descriptionToSteps(str(english.description));
  if (steps.length === 0) return null;

  const id = typeof exercise.id === 'number' ? exercise.id : undefined;
  const entryUrl = id !== undefined ? `${apiBase(ctx)}/exercise/${id}/` : apiBase(ctx);
  const title = str(english.name).trim();

  const media: ProviderMedia[] = [];
  const image = mainOf(list(exercise.images));
  const imageUrl = image && allowedMedia(image.image, ctx);
  if (image && imageUrl) media.push({ kind: 'image', url: imageUrl, credit: creditFor(image, exercise, `Image of "${title}" from wger`, entryUrl) });
  // Streamed only, never saved — and wger's clips are large, so one is plenty.
  const video = mainOf(list(exercise.videos));
  const videoUrl = video && allowedMedia(video.video, ctx);
  if (video && videoUrl) media.push({ kind: 'video', url: videoUrl, credit: creditFor(video, exercise, `Video of "${title}" from wger`, entryUrl) });

  const primary = names(list(exercise.muscles));
  const secondary = names(list(exercise.muscles_secondary)).filter((m) => !primary.includes(m));
  const muscles = [primary.join(', '), secondary.length ? `also ${secondary.join(', ')}` : ''].filter(Boolean).join('; ');

  return clampHowTo({
    externalId,
    steps,
    ...(muscles ? { muscles } : {}),
    media,
    // "Adapted": the text is reformatted into steps, and CC-BY-SA asks that changes be indicated.
    credit: creditFor(english, exercise, `Adapted from "${title}" on wger`, entryUrl),
  });
}

const CREATIVE_COMMONS: CachePolicy = { textMaxAgeMs: null, imageMaxAgeMs: null, cacheVideo: false };

export const wger: ContentProvider = {
  id: 'wger',
  name: 'wger',
  auth: { kind: 'none' },
  capabilities: { search: true, steps: true, images: true, video: true },
  // wger.de serves the API and the pictures. It needs no key, so listing it
  // twice sends nothing it shouldn't. Its /media/ files carry no CORS header;
  // they are saved for offline as opaque responses, which an <img> can show
  // but code cannot read — enough, since nothing here reads a picture.
  apiHosts: ['wger.de'],
  mediaHosts: ['wger.de'],
  // wger is open source and people run their own; theirs then replaces wger.de.
  allowsBaseUrl: true,
  // Creative Commons lets anyone keep a copy, for as long as they like.
  cachePolicy: () => CREATIVE_COMMONS,

  async test(ctx) {
    const got = await getJson(`${apiBase(ctx)}/api/v2/exerciseinfo/?limit=1`, ctx);
    if (!got.ok) return got.outcome;
    return resultsOf(got.body) ? { ok: true } : { ok: false, reason: 'unexpected', detail: 'not a wger answer' };
  },

  async search(query, ctx) {
    const q = query.replace(/\s+/g, ' ').trim().slice(0, MAX_ID_CHARS);
    if (!q) return [];
    const params = new URLSearchParams({ name__search: q, limit: String(SEARCH_LIMIT) });
    const got = await getJson(`${apiBase(ctx)}/api/v2/exerciseinfo/?${params.toString()}`, ctx);
    if (!got.ok) return [];
    return (resultsOf(got.body) ?? []).map((exercise) => toMatch(exercise, ctx)).filter((m): m is ExternalMatch => m !== null);
  },

  async fetchHowTo(externalId, ctx) {
    // The uuid is wger's stable id. Anything else is not one of theirs, and
    // asking costs a request for a guaranteed miss.
    if (!UUID.test(externalId)) return null;
    // The detail route takes wger's numeric id, which changes; the uuid filter on the list does not.
    const params = new URLSearchParams({ uuid: externalId });
    const got = await getJson(`${apiBase(ctx)}/api/v2/exerciseinfo/?${params.toString()}`, ctx);
    if (!got.ok) return null;
    const exercise = (resultsOf(got.body) ?? []).find((row) => str(row.uuid).toLowerCase() === externalId.toLowerCase());
    return exercise ? toHowTo(exercise, externalId, ctx) : null;
  },
};
