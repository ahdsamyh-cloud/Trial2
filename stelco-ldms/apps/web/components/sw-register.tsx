'use client';
import { useEffect } from 'react';

export function SwRegister({ nonce: _nonce }: { nonce?: string }) {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  return null;
}
