// The catalogue: database inventory with today's prices and net monthly estimates.
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { EquipmentCatalogue } from '@/components/equipment-catalogue';
import { loadCoefficientTable, loadPriceLists } from '@/data/load';
import type { AssetCategory } from '@/data/schemas';
import { estimateLease } from '@/domain/lease-estimate';
import { listPriceOn } from '@/domain/price-list';
import { getT } from '@/i18n/get-t';
import { isLocale } from '@/i18n/locales';
import { listAssets } from '@/server/assets';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { todayIso } from '@/server/today';

export default async function CataloguePage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Render on every request: prices depend on today's date and on the database.
  await connection();

  const session = await getAuth().api.getSession({
    headers: await headers(),
    query: { disableRefresh: true },
  });
  if (!session) redirect(`/${locale}/login`);

  const t = getT(locale);
  if (session.user.accountType !== 'customer') {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-heading-lg">{t('catalogue.customerOnlyTitle')}</h1>
        <p className="mt-3 text-lg text-[#949ba6]">{t('catalogue.customerOnlyDescription')}</p>
      </div>
    );
  }
  const today = todayIso(); // the page decides what "today" is; domain code never reads the clock
  const [assets, priceLists, table] = await Promise.all([
    listAssets(db),
    loadPriceLists(),
    loadCoefficientTable(),
  ]);
  // The design's six photographs are illustrative category imagery; inventory and prices
  // always come from the database and the active price list, never the Figma mock data.
  const photos: Record<AssetCategory, string[]> = {
    e_bike: ['7023f.jpg', '70afa.jpg'],
    laptop: ['22c5b.jpg', 'b4bbe.jpg'],
    farm_machine: ['d8aeb.png', '2d9d7.png'],
  };
  const categoryIndex: Record<AssetCategory, number> = { e_bike: 0, laptop: 0, farm_machine: 0 };
  const items = assets.map((asset) => {
    const price = listPriceOn(priceLists, asset.id, today);
    const image = photos[asset.category][categoryIndex[asset.category]++ % 2];
    return {
      asset,
      price,
      estimate: price.ok ? estimateLease(table, price.priceCents) : null,
      image: `/images/catalogue/${image}`,
    };
  });

  return <EquipmentCatalogue items={items} table={table} locale={locale} today={today} />;
}
