/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The app is a single client-rendered shell over IndexedDB — there is nothing
  // to render on a server. Keeping this off Vercel's serverless runtime entirely
  // means the deploy is a static bundle behind a CDN.
  output: 'export',

  // `output: 'export'` has no image optimiser behind it.
  images: { unoptimized: true },
};

export default nextConfig;
