// One lease's invoices: what has been issued and paid, and what is still to come.
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { LeaseInvoices } from '@/components/lease-invoices';
import { loadCustomers } from '@/data/load';
import { applicantCustomerId, leaseAccess } from '@/domain/catalogue';
import { isLocale } from '@/i18n/locales';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { getCustomerInvoices } from '@/server/features/contracts/get-customer-invoices';
import { todayIso } from '@/server/today';

export default async function LeaseInvoicesPage({
  params,
}: PageProps<'/[locale]/leases/[id]/invoices'>) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();

  // Render on every request: opening the page issues whatever is due today.
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

  const result = await getCustomerInvoices(db, {
    contractId: id,
    customerId,
    asOfDate: todayIso(),
  });
  if (!result.ok) notFound();

  return <LeaseInvoices {...result.value} locale={locale} today={todayIso()} />;
}
