// My invoices: every invoice across the customer's leases, newest first.
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { CustomerInvoices } from '@/components/customer-invoices';
import { loadCustomers } from '@/data/load';
import { applicantCustomerId, leaseAccess } from '@/domain/catalogue';
import { isLocale } from '@/i18n/locales';
import { getT } from '@/i18n/get-t';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { getAllCustomerInvoices } from '@/server/features/customer-invoices/get-all-customer-invoices';
import { findCustomerForUser } from '@/server/features/customers/find-customer-for-user';
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
  if (!session) redirect(`/${locale}/login`);
  if (access !== 'customer') redirect(`/${locale}`);

  const profile = await findCustomerForUser(db, session.user.id);
  const customerId = profile?.id ?? applicantCustomerId(await loadCustomers());
  if (!customerId) notFound();

  const today = todayIso();
  const invoices = await getAllCustomerInvoices(db, { customerId, asOfDate: today });
  const t = getT(locale);
  return (
    <>
      {!profile && (
        <aside className="profile-banner">
          {t('profile.banner')}
          <Link href={`/${locale}/profile`}>{t('profile.completeProfile')}</Link>
        </aside>
      )}
      <CustomerInvoices {...invoices} locale={locale} today={today} />
    </>
  );
}
