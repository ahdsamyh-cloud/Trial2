import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { ReactNode } from 'react';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { SwRegister } from '@/components/sw-register';

export const metadata: Metadata = {
  title: 'STELCO Legal (LDMS)',
  description: 'Legal Department Management System — State Electric Company Limited',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon.svg' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#124a8f' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading headers makes every page dynamic so each response gets its own CSP nonce.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
        <SwRegister nonce={nonce} />
      </body>
    </html>
  );
}
