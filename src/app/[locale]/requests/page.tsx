// The supplier's Requests page: the leases whose item customers have given back.
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { ReturnRequests } from '@/components/return-requests';
import { isSupplier } from '@/domain/catalogue';
import { isLocale } from '@/i18n/locales';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { getReturnRequests } from '@/server/features/return-requests/get-return-requests';

export default async function RequestsPage({ params }: PageProps<'/[locale]/requests'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Render on every request: this reads the database.
  await connection();

  const session = await getAuth().api.getSession({
    headers: await headers(),
    query: { disableRefresh: true },
  });
  if (!session) redirect(`/${locale}/login`);
  if (!isSupplier(session.user.accountType)) redirect(`/${locale}`);

  return <ReturnRequests requests={await getReturnRequests(db)} locale={locale} />;
}
