'use client';
import { use } from 'react';
import { MatterView } from '@/components/matter-view';
import { DraftingPanel } from '@/components/drafting-panels';

export default function DraftingRequestPage({ params }: { params: Promise<{ id: string }> }) {
  return <MatterView id={use(params).id} docStages={['DRAFT', 'REVIEWED', 'FINAL', 'SIGNED']}>{(m, reload) => <DraftingPanel m={m} reloadMatter={reload} />}</MatterView>;
}
