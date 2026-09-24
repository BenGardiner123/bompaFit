// Serves the exported `out/` directory for end-to-end tests.
//
// Why not a package: the service worker only registers in a production build
// (app/page.tsx), so the browser tests have to run against the real static
// export rather than `next dev`. Serving that needs about forty lines of
// node:http, and this project already prefers that to a dependency — the PNG
// icons are generated with node:zlib for the same reason.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'out');
const PORT = Number(process.env.PORT ?? 4173);

/**
 * Content types that matter here. A service worker served as text/plain is
 * rejected by the browser outright, and a manifest with the wrong type is
 * ignored silently — which would look like a broken app rather than a broken
 * server.
 */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Resolve a URL to a file inside `out/`, or null if it escapes the root. */
function resolvePath(url) {
  const clean = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  // normalize collapses '..' before the join, so a crafted path cannot climb
  // out of the served directory.
  const candidate = resolve(join(ROOT, normalize(clean)));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + (process.platform === 'win32' ? '\\' : '/'))) return null;
  return candidate;
}

async function readIfFile(path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    // The path comes back with the body because the content type has to be
    // derived from the file actually served, not the one asked for. '/' resolves
    // to a directory with no extension, and typing that from the request gives
    // application/octet-stream — which the browser downloads instead of renders.
    return { path, body: await readFile(path) };
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const path = resolvePath(req.url ?? '/');
  if (!path) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  // A directory means its index.html — the export writes one per route.
  const hit = (await readIfFile(path)) ?? (await readIfFile(join(path, 'index.html')));

  if (!hit) {
    const notFound = await readIfFile(join(ROOT, '404.html'));
    res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(notFound?.body ?? 'Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': TYPES[extname(hit.path)] ?? 'application/octet-stream',
    // No caching: a stale service worker between test runs is a debugging
    // afternoon nobody needs.
    'Cache-Control': 'no-store',
  });
  res.end(hit.body);
});

server.listen(PORT, () => {
  console.log(`serving ${ROOT} on http://localhost:${PORT}`);
});
