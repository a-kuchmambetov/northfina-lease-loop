// My invoices: every invoice across the customer's leases, newest first.
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { CustomerInvoices } from '@/components/customer-invoices';
import { loadCustomers } from '@/data/load';
import { applicantCustomerId, leaseAccess } from '@/domain/catalogue';
import { isLocale } from '@/i18n/locales';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { getAllCustomerInvoices } from '@/server/features/customer-invoices/get-all-customer-invoices';
import { todayIso } from '@/server/today';

export default async function InvoicesPage({ params }: PageProps<'/[locale]/invoices'>) {
  const { locale } = await params;
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

  const today = todayIso();
  const invoices = await getAllCustomerInvoices(db, { customerId, asOfDate: today });
  return <CustomerInvoices {...invoices} locale={locale} today={today} />;
}
