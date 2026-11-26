'use client';
import { use } from 'react';
import { MatterView } from '@/components/matter-view';

export default function MatterPage({ params }: { params: Promise<{ id: string }> }) {
  return <MatterView id={use(params).id} />;
}
