// The customer's own page: every application, and their active and past leases.
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { CustomerOverview } from '@/components/customer-overview';
import { loadCustomers } from '@/data/load';
import { applicantCustomerId, leaseAccess } from '@/domain/catalogue';
import { overviewView } from '@/domain/customer-overview';
import { isLocale } from '@/i18n/locales';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { getCustomerOverview } from '@/server/features/customer-overview/get-customer-overview';
import { todayIso } from '@/server/today';

export default async function AccountPage({
  params,
  searchParams,
}: PageProps<'/[locale]/account'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Render on every request: this reads the database and depends on today's date.
  await connection();

  const session = await getAuth().api.getSession({
    headers: await headers(),
    query: { disableRefresh: true },
  });
  const access = leaseAccess(session?.user.accountType);
  if (access === 'guest') redirect(`/${locale}/login`);
  if (access !== 'customer') redirect(`/${locale}`);

  const customerId = applicantCustomerId(await loadCustomers());
  if (!customerId) notFound();

  const { view } = await searchParams;
  return (
    <CustomerOverview
      overview={await getCustomerOverview(db, customerId, todayIso())}
      view={overviewView(view)}
      locale={locale}
    />
  );
}
