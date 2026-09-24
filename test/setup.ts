// Dexie needs a real IndexedDB implementation. fake-indexeddb provides one that
// runs in Node, so db tests exercise the actual driver — including migrations,
// which is the part most worth testing.
import 'fake-indexeddb/auto';

// jsdom has no matchMedia, and the app shell needs one: AndroidFrame asks
// whether the viewport is wide enough for the desktop bezel. Without this, any
// test that renders the shell throws before it reaches what it came to check.
// Reports "not a wide viewport", so tests see the phone layout — which is the
// one that matters.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
