// My leases: every application, and the customer's active and past leases.
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { CustomerOverview } from '@/components/customer-overview';
import { loadCoefficientTable, loadCustomers } from '@/data/load';
import { applicantCustomerId, leaseAccess } from '@/domain/catalogue';
import { offeredTerms } from '@/domain/coefficient';
import { overviewView } from '@/domain/customer-overview';
import { isLocale } from '@/i18n/locales';
import { getT } from '@/i18n/get-t';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { getCustomerOverview } from '@/server/features/customer-overview/get-customer-overview';
import { findCustomerForUser } from '@/server/features/customers/find-customer-for-user';
import { todayIso } from '@/server/today';

export default async function LeasesPage({ params, searchParams }: PageProps<'/[locale]/leases'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Render on every request: this reads the database and depends on today's date.
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
  const t = getT(locale);

  const { view } = await searchParams;
  return (
    <>
      {!profile && (
        <aside className="profile-banner">
          {t('profile.banner')}
          <Link href={`/${locale}/profile`}>{t('profile.completeProfile')}</Link>
        </aside>
      )}
      <CustomerOverview
        overview={await getCustomerOverview(db, customerId, todayIso())}
        view={overviewView(view)}
        extendTerms={offeredTerms(await loadCoefficientTable())}
        locale={locale}
      />
    </>
  );
}
