'use client';
import { t } from '@/lib/i18n';
import { MattersList } from '@/components/matters-list';

export default function MattersPage() {
  return <MattersList title={t('All matters')} subtitle={t('Every matter you are allowed to see, across units.')} />;
}
