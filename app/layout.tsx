import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { C } from '@/lib/tokens';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bompa',
  description: 'The periodization-first workout tracker. Offline, on-device, no account.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Bompa',
  appleWebApp: { capable: true, title: 'Bompa', statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192' }],
  },
};

export const viewport: Viewport = {
  // First paint only: the page swaps it to match whichever screen is showing.
  themeColor: C.screen,
  width: 'device-width',
  initialScale: 1,
  // The logging screen has a sticky footer button; letting the page zoom would
  // put it somewhere unpredictable mid-set.
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body>{children}</body>
    </html>
  );
}
