'use client';
import { use } from 'react';
import { MatterView } from '@/components/matter-view';
import { LitigationPanels } from '@/components/litigation-panels';

const LIT_DOC_TYPES = ['PLEADING', 'EVIDENCE', 'SUBMISSION', 'COURT_ORDER', 'JUDGMENT', 'CORRESPONDENCE', 'ENGAGEMENT_LETTER', 'INVOICE'].map((v) => ({ value: v, label: v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }));

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  return <MatterView id={use(params).id} docTypes={LIT_DOC_TYPES}>{(m, reload) => <LitigationPanels m={m} reloadMatter={reload} />}</MatterView>;
}
