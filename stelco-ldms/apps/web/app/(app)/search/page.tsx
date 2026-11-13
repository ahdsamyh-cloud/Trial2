'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { t } from '@/lib/i18n';
import { Badge, Card, Empty, Input, PageHeader, Spinner } from '@/components/ui';

interface Hit { type: string; id: string; title: string; subtitle?: string; snippet?: string; link: string }

/** Renders «highlight» markers from the server as <mark> without using innerHTML. */
function Snippet({ text }: { text: string }) {
  return <>{text.split(/(«[^»]*»)/).map((p, i) => (p.startsWith('«') ? <mark key={i} className="bg-yellow-100">{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}</>;
}

function SearchInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  useEffect(() => { const h = setTimeout(() => { setDebounced(q); router.replace(`/search?q=${encodeURIComponent(q)}`); }, 350); return () => clearTimeout(h); }, [q, router]);
  const { data, loading } = useApi<{ hits: Hit[] }>(debounced.trim().length >= 2 ? `/search?q=${encodeURIComponent(debounced)}` : null, [debounced]);
  const groups = ['matter', 'document', 'email', 'law', 'contract', 'opinion', 'faq'];
  const names: Record<string, string> = { matter: t('Matters'), document: t('Documents'), email: t('Emails'), law: t('Laws'), contract: t('Contracts'), opinion: t('Legal opinions'), faq: t('FAQ') };
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title={t('Search')} subtitle={t('Matters, documents (including scanned PDFs), emails, laws, contracts and opinions you are allowed to see.')} />
      <Input aria-label={t('Search')} autoFocus placeholder={t('Search for a reference, name, clause, phrase…')} value={q} onChange={(e) => setQ(e.target.value)} />
      {loading ? <Spinner /> : !data ? null : !data.hits.length ? <Empty>{t('No results')}</Empty> : groups.filter((g) => data.hits.some((h) => h.type === g)).map((g) => (
        <Card key={g} title={`${names[g]} (${data.hits.filter((h) => h.type === g).length})`}>
          <ul className="divide-y">{data.hits.filter((h) => h.type === g).map((h) => (
            <li key={h.type + h.id} className="py-2 text-sm">
              <Link href={h.link} className="font-medium text-brand-700 hover:underline">{h.title}</Link> {h.subtitle ? <Badge>{h.subtitle}</Badge> : null}
              {h.snippet ? <p className="mt-0.5 text-slate-600"><Snippet text={h.snippet} /></p> : null}
            </li>
          ))}</ul>
        </Card>
      ))}
    </div>
  );
}

export default function SearchPage() {
  return <Suspense><SearchInner /></Suspense>;
}
