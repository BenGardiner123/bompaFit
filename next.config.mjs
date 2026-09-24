import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// What build is this? Shown at the bottom of Tools, because an installed app
// keeps running the copy it saved until an update lands, and without a version
// on screen there is no way to tell whether the phone has the latest deploy.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

function commit() {
  // Vercel says which commit it built; a local build asks git; anything else is 'dev'.
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The app is a single client-rendered shell over IndexedDB — there is nothing
  // to render on a server. Keeping this off Vercel's serverless runtime entirely
  // means the deploy is a static bundle behind a CDN.
  output: 'export',

  // `output: 'export'` has no image optimiser behind it.
  images: { unoptimized: true },

  // Baked in at build time, so they are part of the saved app and read offline.
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_APP_BUILD: commit(),
    NEXT_PUBLIC_APP_BUILT_AT: new Date().toISOString().slice(0, 10),
  },
};

export default nextConfig;
