'use client';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { preferredLanguage, setLanguage } from './i18n';

export interface Me {
  id: string;
  username: string;
  displayName: string;
  email: string;
  departmentId: string | null;
  isAdminAccount: boolean;
  mustChangePassword: boolean;
  roles: { role: string; unit: string | null }[];
  permissions: { perm: string; scope: string; units: string[] }[];
  stage: string;
}

const Ctx = createContext<{ me: Me | null; loading: boolean; can: (p: string, unit?: string) => boolean; refresh: () => Promise<void> }>({
  me: null, loading: true, can: () => false, refresh: async () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    try {
      const user = await api.get<Me>('/auth/me');
      // Language before the first signed-in render, so the whole app draws once in the chosen language.
      if (user.stage === 'FULL' && preferredLanguage() === 'dv') {
        const overrides = await api.get<Record<string, string>>('/config/i18n/dv').catch(() => ({}));
        setLanguage('dv', overrides);
      }
      setMe(user);
    } catch { setMe(null); } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const can = (perm: string, unit?: string) => {
    const g = me?.permissions.find((p) => p.perm === perm);
    if (!g) return false;
    if (!unit || g.scope !== 'UNIT') return true;
    return g.units.includes(unit);
  };
  return <Ctx.Provider value={{ me, loading, can, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
