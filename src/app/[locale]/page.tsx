// The catalogue: database inventory with today's prices and net monthly estimates. A supplier
// sees their own equipment table instead ("Your equipment"), not the customers' catalogue.
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { EquipmentCatalogue } from '@/components/equipment-catalogue';
import { SupplierEquipment } from '@/components/supplier-equipment';
import { loadCoefficientTable, loadCustomers, loadPriceLists } from '@/data/load';
import type { AssetCategory } from '@/data/schemas';
import {
  applicantCustomerId,
  catalogueAsset,
  isLeasable,
  isSupplier,
  leaseAccess,
} from '@/domain/catalogue';
import { estimateLease } from '@/domain/lease-estimate';
import { listPriceOn } from '@/domain/price-list';
import { isLocale } from '@/i18n/locales';
import { getT } from '@/i18n/get-t';
import { listAssets } from '@/server/assets';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { getSupplierEquipment } from '@/server/features/supplier-equipment/get-supplier-equipment';
import { findCustomerForUser } from '@/server/features/customers/find-customer-for-user';
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
  const today = todayIso(); // the page decides what "today" is; domain code never reads the clock
  if (session && isSupplier(session.user.accountType)) {
    const items = await getSupplierEquipment(db, { supplierName: session.user.name, today });
    return <SupplierEquipment items={items} locale={locale} supplierName={session.user.name} />;
  }

  const access = leaseAccess(session?.user.accountType);
  const profile =
    session && access === 'customer' ? await findCustomerForUser(db, session.user.id) : null;
  const t = getT(locale);
  const [assets, priceLists, table, customers] = await Promise.all([
    listAssets(db),
    loadPriceLists(),
    loadCoefficientTable(),
    loadCustomers(),
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
      asset: catalogueAsset(asset, access),
      price,
      estimate: price.ok ? estimateLease(table, price.priceCents) : null,
      image: `/images/catalogue/${image}`,
    };
  });

  // Filtered here so equipment that cannot be leased never reaches the browser.
  return (
    <>
      {access === 'customer' && !profile && (
        <aside className="profile-banner">
          {t('profile.banner')}
          <Link href={`/${locale}/profile`}>{t('profile.completeProfile')}</Link>
        </aside>
      )}
      <EquipmentCatalogue
        items={items.filter(isLeasable)}
        table={table}
        locale={locale}
        today={today}
        access={access}
        // The decision comes from the answers, not from this customer's record.
        applicantId={
          access === 'customer' ? (profile?.id ?? applicantCustomerId(customers)) : undefined
        }
      />
    </>
  );
}
