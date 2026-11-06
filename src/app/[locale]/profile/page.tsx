import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { CustomerProfileForm } from '@/components/customer-profile-form';
import { CustomerProfileView } from '@/components/customer-profile-view';
import { isLocale } from '@/i18n/locales';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { getCustomerProfile } from '@/server/features/customers/get-customer-profile';

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const session = await getAuth().api.getSession({
    headers: await headers(),
    query: { disableRefresh: true },
  });
  if (!session) redirect(`/${locale}/login`);
  if (session.user.accountType !== 'customer') redirect(`/${locale}`);
  const profile = await getCustomerProfile(db, session.user.id);
  if (profile) return <CustomerProfileView locale={locale} initial={profile} />;

  return (
    <CustomerProfileForm locale={locale} name={session.user.name} email={session.user.email} />
  );
}
