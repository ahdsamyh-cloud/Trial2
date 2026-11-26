import { TokenPage } from '@/components/token-page';
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  return <TokenPage token={(await params).token} />;
}
