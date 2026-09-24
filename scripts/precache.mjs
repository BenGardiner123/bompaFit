// Tells the service worker exactly which files make up this build.
//
// Why this exists: the browser downloads the app's scripts during the very first
// page load, before the worker is controlling the page, so those requests never
// pass through it. A worker that only saves files as they go past therefore
// never saves the app itself, and a cold start with no signal paints the HTML
// over a dead app. The only fix is to hand the worker the full file list at
// install time — and only the build knows the hashed file names.
//
// Every file under out/_next is listed, not just the scripts index.html names.
// The page pulls some chunks in later through webpack's loader and the font
// through the CSS, and a list built by guessing which files matter is a list
// that goes stale the first time Next splits the bundle differently.
//
// node:crypto and node:fs rather than a plugin, for the same reason the static
// server is node:http.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const OUT = resolve(process.cwd(), 'out');
const SW = join(OUT, 'sw.js');
// Must match public/sw.js character for character. If it doesn't, fail the
// build: a worker that silently shipped without its file list is exactly the
// bug this script exists to fix, and nothing on screen would say so.
const PLACEHOLDER = "const BUILD = { version: 'dev', assets: [] };";

if (!existsSync(SW)) {
  console.error('No out/sw.js — run `next build` first.');
  process.exit(1);
}

/** Every file under `dir`, as paths relative to out/, sorted so the hash is stable. */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    })
    .sort();
}

const toUrl = (file) => '/' + relative(OUT, file).split(sep).join('/');

const assets = walk(join(OUT, '_next')).map(toUrl);

// The version is a hash of the whole build, sw.js aside. It names the cache, so
// a new build gets a fresh one and the old is deleted on activate. It also
// changes the bytes of sw.js, which is how the browser notices an update at
// all. Next writes a random build id into the output, so every build gets a new
// version even when nothing changed — a wasted download of a few hundred KB,
// never a stale app, which is the failure worth ruling out.
const hash = createHash('sha256');
for (const file of walk(OUT)) {
  if (file === SW) continue;
  hash.update(toUrl(file));
  hash.update(readFileSync(file));
}
const version = hash.digest('hex').slice(0, 12);

const source = readFileSync(SW, 'utf8');
if (!source.includes(PLACEHOLDER)) {
  console.error('out/sw.js has no precache placeholder — was public/sw.js changed?');
  process.exit(1);
}

writeFileSync(SW, source.replace(PLACEHOLDER, `const BUILD = ${JSON.stringify({ version, assets })};`));
console.log(`sw.js: ${assets.length} build files precached, version ${version}`);
