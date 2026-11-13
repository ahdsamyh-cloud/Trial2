'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { Bell, BookOpen, Calendar, ClipboardCheck, FileText, Gavel, GraduationCap, Home, Inbox, LayoutDashboard, LogOut, Menu, Search, Settings, Shield, Users, X, Briefcase, Send, Upload, Archive } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { ReauthDialog } from './reauth';
import { cx } from './ui';

interface NavItem { href: string; label: string; icon: ReactNode; show: boolean }

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading, can } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!loading && (!me || me.stage !== 'FULL' || me.mustChangePassword)) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [loading, me, path, router]);
  useEffect(() => {
    if (!me) return;
    const load = () => api.get<{ unreadCount: number }>('/notifications?unread=true').then((r) => setUnread(r.unreadCount)).catch(() => undefined);
    void load();
    const i = setInterval(load, 60_000);
    return () => clearInterval(i);
  }, [me]);
  useEffect(() => setOpen(false), [path]);

  if (loading || !me || me.stage !== 'FULL') return <div className="p-10 text-center text-sm text-slate-500">{t('Loading…')}</div>;

  const legal = can('matter:read');
  const nav: NavItem[] = [
    { href: '/', label: t('My work'), icon: <Home size={18} />, show: legal || can('portal:use') },
    { href: '/dashboard', label: t('Dashboards'), icon: <LayoutDashboard size={18} />, show: can('dashboard:hod') || can('dashboard:unit') || can('dashboard:mgmt') },
    { href: '/portal', label: t('My requests'), icon: <Send size={18} />, show: can('portal:use') },
    { href: '/intake', label: t('Intake inbox'), icon: <Inbox size={18} />, show: can('intake:read') },
    { href: '/matters', label: t('All matters'), icon: <Briefcase size={18} />, show: legal },
    { href: '/litigation', label: t('Litigation'), icon: <Gavel size={18} />, show: can('lit:write') || can('matter:read', 'LIT') },
    { href: '/drafting', label: t('Drafting'), icon: <FileText size={18} />, show: can('draft:draft') || can('matter:read', 'DRF') },
    { href: '/compliance', label: t('Compliance'), icon: <ClipboardCheck size={18} />, show: can('cmp:write') || can('matter:read', 'CMP') || can('portal:respond') },
    { href: '/awareness', label: t('Awareness'), icon: <GraduationCap size={18} />, show: can('awr:write') || can('matter:read', 'AWR') || can('portal:use') },
    { href: '/calendar', label: t('Calendar'), icon: <Calendar size={18} />, show: can('calendar:read') },
    { href: '/search', label: t('Search'), icon: <Search size={18} />, show: can('search:use') || can('portal:use') },
    { href: '/knowledge', label: t('Bulletins & FAQ'), icon: <BookOpen size={18} />, show: true },
    { href: '/admin/imports', label: t('Data import'), icon: <Upload size={18} />, show: can('lit:import') || can('draft:draft', 'DRF') || can('cmp:write', 'CMP') || can('awr:write', 'AWR') },
    { href: '/admin/users', label: t('Users'), icon: <Users size={18} />, show: can('users:read') || can('users:manage') },
    { href: '/admin/config', label: t('Configuration'), icon: <Settings size={18} />, show: can('config:read') && (can('config:manage') || legal) },
    { href: '/admin/retention', label: t('Retention'), icon: <Archive size={18} />, show: can('disposal:approve') },
    { href: '/admin/audit', label: t('Audit log'), icon: <Shield size={18} />, show: can('audit:read') || can('audit:read.system') },
  ].filter((n) => n.show);

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    location.href = '/login';
  };

  const NavList = (
    <nav aria-label={t('Main')} className="space-y-0.5">
      {nav.map((n) => {
        const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined}
            className={cx('flex items-center gap-2.5 rounded-md px-3 py-2 text-sm', active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-700 hover:bg-slate-100')}>
            {n.icon}{n.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">{t('Skip to content')}</a>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-3 md:px-5">
        <button className="rounded p-1.5 md:hidden" onClick={() => setOpen(!open)} aria-label={open ? t('Close menu') : t('Open menu')} aria-expanded={open}>{open ? <X size={20} /> : <Menu size={20} />}</button>
        <Link href="/" className="flex items-center gap-2 font-semibold text-brand-900"><img src="/icons/icon.svg" alt="" width={26} height={26} />{t('STELCO Legal')}</Link>
        <div className="ml-auto flex items-center gap-1">
          <Link href="/notifications" className="relative rounded p-2 hover:bg-slate-100" aria-label={t('Notifications ({n} unread)', { n: unread })}>
            <Bell size={18} />{unread ? <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span> : null}
          </Link>
          <Link href="/account" className="hidden rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-100 sm:block">{me.displayName}</Link>
          <button onClick={logout} className="rounded p-2 hover:bg-slate-100" aria-label={t('Sign out')}><LogOut size={18} /></button>
        </div>
      </header>
      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3 md:block">{NavList}</aside>
        {open ? <div className="fixed inset-0 top-14 z-20 overflow-y-auto bg-white p-3 md:hidden">{NavList}<Link href="/account" className="mt-3 block px-3 py-2 text-sm">{t('My account')}</Link></div> : null}
        <main id="main" className="min-w-0 flex-1 px-4 py-5 md:px-6">{children}</main>
      </div>
      <ReauthDialog />
    </div>
  );
}
