import { ReactNode } from 'react';
import { AppShell } from '@/components/shell';

export default function Layout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
