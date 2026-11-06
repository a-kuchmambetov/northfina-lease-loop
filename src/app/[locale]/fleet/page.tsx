// Fleet impact: the CO2 and money saved by second and third lives, for the whole fleet.
// Supplier accounts only. The numbers are fetched in the browser from /api/fleet/impact.
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { FleetImpact } from '@/components/fleet-impact';
import { loadAssets } from '@/data/load';
import { isSupplier } from '@/domain/catalogue';
import { isLocale } from '@/i18n/locales';
import { getAuth } from '@/server/auth-instance';

export default async function FleetPage({ params }: PageProps<'/[locale]/fleet'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await getAuth().api.getSession({
    headers: await headers(),
    query: { disableRefresh: true },
  });
  if (!session) redirect(`/${locale}/login`);
  if (!isSupplier(session.user.accountType)) redirect(`/${locale}`);

  const assets = await loadAssets();
  return (
    <FleetImpact
      locale={locale}
      itemNames={Object.fromEntries(assets.map((a) => [a.id, `${a.make} ${a.model}`]))}
    />
  );
}
