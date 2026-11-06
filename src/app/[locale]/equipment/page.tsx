// The supplier's "Your equipment" page: their items, contracts and what needs attention.
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { SupplierEquipment } from '@/components/supplier-equipment';
import { isSupplier } from '@/domain/catalogue';
import { isLocale } from '@/i18n/locales';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { getSupplierEquipment } from '@/server/features/supplier-equipment/get-supplier-equipment';
import { todayIso } from '@/server/today';

export default async function EquipmentPage({ params }: PageProps<'/[locale]/equipment'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Render on every request: this reads the database and depends on today's date.
  await connection();

  const session = await getAuth().api.getSession({
    headers: await headers(),
    query: { disableRefresh: true },
  });
  if (!session) redirect(`/${locale}/login`);
  if (!isSupplier(session.user.accountType)) redirect(`/${locale}`);

  const items = await getSupplierEquipment(db, {
    supplierName: session.user.name,
    today: todayIso(),
  });
  return <SupplierEquipment items={items} locale={locale} supplierName={session.user.name} />;
}
