// Measures the JavaScript a modern browser actually downloads to start the app.
//
// Two things this gets right that reading `next build` does not.
//
// It counts what the exported HTML really references, rather than Next's
// "First Load JS" summary. And it *excludes* the polyfill chunk, which carries
// `noModule` — meaning only browsers too old to understand ES modules fetch it.
// Bompa is an installed progressive web app on Android Chrome, so that file is
// never downloaded in practice. It is reported separately rather than hidden,
// because "we ship a legacy bundle nobody takes" is worth being able to see.
//
// node:zlib rather than a bundle-analyser dependency, for the same reason the
// icons are generated with node:zlib and the test server is node:http.

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const OUT = resolve(process.cwd(), 'out');
// Gzipped JavaScript a modern browser downloads to start the app. A tripwire for
// something large landing in the startup path by accident, not a target: the app
// is installed once and runs from the saved copy after that.
const BUDGET_KB = 300;

const indexPath = join(OUT, 'index.html');
if (!existsSync(indexPath)) {
  console.error('No out/index.html — run `npm run build` first.');
  process.exit(1);
}

const html = readFileSync(indexPath, 'utf8');

// Each <script> tag, with whatever attributes it carries, so `noModule` is
// visible rather than guessed at from the filename.
const tags = [...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+\.js)"([^>]*)>/g)].map((m) => ({
  src: m[2],
  legacy: /\bnomodule\b/i.test(m[1] + m[3]),
}));

const kb = (n) => (n / 1024).toFixed(1);
const weigh = (src) => {
  const file = join(OUT, src.replace(/^\//, ''));
  if (!existsSync(file)) return null;
  const buf = readFileSync(file);
  return { gz: gzipSync(buf).length, raw: buf.length };
};

let gzipped = 0;
let raw = 0;
let legacyGz = 0;
const rows = [];

for (const tag of tags) {
  const size = weigh(tag.src);
  if (!size) {
    console.error(`  referenced but missing: ${tag.src}`);
    process.exitCode = 1;
    continue;
  }
  if (tag.legacy) {
    legacyGz += size.gz;
    continue;
  }
  gzipped += size.gz;
  raw += size.raw;
  rows.push([size.gz, tag.src]);
}

rows.sort((a, b) => b[0] - a[0]);
for (const [gz, src] of rows) console.log(`  ${kb(gz).padStart(7)} KB  ${src}`);

const headroom = BUDGET_KB - gzipped / 1024;
console.log('  ' + '-'.repeat(52));
console.log(`  ${kb(gzipped)} KB gzipped (${kb(raw)} KB raw) across ${rows.length} chunks`);
if (legacyGz) console.log(`  ${kb(legacyGz)} KB more in a noModule chunk that modern browsers skip`);
console.log(`  budget ${BUDGET_KB} KB — ${headroom.toFixed(1)} KB headroom`);

if (headroom < 0) {
  console.error(`\nOver the startup bundle budget by ${Math.abs(headroom).toFixed(1)} KB.`);
  console.error('Before shaving code, check nothing large was added to the startup path —');
  console.error('the exercise how-to text is meant to load on demand, not at boot.');
  process.exit(1);
}
