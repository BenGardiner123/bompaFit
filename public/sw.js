// Hand-written rather than generated. The caching story is about forty lines and
// a build plugin would add more moving parts than it removes.
//
// Two strategies:
//   navigation  → network-first  (fresh code online, cached shell offline)
//   assets      → stale-while-revalidate (instant load, quiet refresh)

// Replaced after `next build` by scripts/precache.mjs with this build's version
// and every file under /_next. The line must stay exactly as written — the
// script matches it character for character and fails the build if it can't.
const BUILD = { version: 'dev', assets: [] };

// One cache per build. Activate deletes every other one, so old hashed files
// don't pile up forever on the phone.
const CACHE = `bompa-${BUILD.version}`;

// Exercise images the user chose to download, kept apart from the build's
// cache because they have nothing to do with which build is running. Only the
// page writes here; the worker just reads. The version suffix lets a future
// format move to a new bucket and drop this one on purpose.
const CONTENT = 'bompa-content-v1';
const CONTENT_PREFIX = 'bompa-content-';

// The app itself: the page and every script, stylesheet and font it can ask
// for. Saved up front because the first load fetches them before this worker
// is in control, so waiting to catch them on the way past means never
// catching them at all.
const APP = ['/', ...BUILD.assets];

// Nice to have offline, but the app runs without them. howtos.json is here
// rather than left to the runtime strategy below because that only saves a file
// once something asks for it — the cues for every movement you hadn't opened
// online would be missing in the gym.
const EXTRAS = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/howtos.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        // All or nothing, on purpose. If one file fails, the install fails and
        // the previous worker stays in charge with its complete cache. Half an
        // app saved is worse than the old one: activate would delete the old
        // cache and leave a gap nothing tells you about until you're offline.
        await cache.addAll(APP);
        // One at a time, so a missing icon can't fail the whole install.
        await Promise.all(EXTRAS.map((url) => cache.add(url).catch(() => undefined)));
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // Downloaded content is spared. Deleting it here would mean every deploy
      // silently wiped the images the user saved, and they'd only find out
      // offline in the gym, which is the one place they can't fetch them again.
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE && !key.startsWith(CONTENT_PREFIX)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // Another site's image: answer from the download bucket when it is there.
    // Whether it is there is only known after an async lookup, and respondWith
    // has to be called before that, so a miss is passed straight through to
    // the network unchanged, the same request the browser would have sent.
    // Offline, that rejects and the image fails to load like any other.
    // Nothing is cached here: what may be saved is decided by the page's
    // download step, which knows each provider's terms, and the worker does not.
    if (request.destination !== 'image') return;
    event.respondWith(
      caches
        .open(CONTENT)
        .then((cache) => cache.match(request))
        .then((cached) => cached ?? fetch(request)),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put('/', copy));
          return response;
        })
        // Offline: hand back the cached shell. The app reads its data from
        // IndexedDB, so a cached shell is a fully working app.
        .catch(() => caches.match('/').then((cached) => cached ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
