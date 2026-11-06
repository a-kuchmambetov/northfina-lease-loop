import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AuditLog } from '@/components/audit-log';
import { InvoiceRun } from '@/components/invoice-run';
import { isSupplier } from '@/domain/catalogue';
import { getT } from '@/i18n/get-t';
import { isLocale } from '@/i18n/locales';
import { getAuth } from '@/server/auth-instance';
import { todayIso } from '@/server/today';

export default async function OperationsPage({ params }: PageProps<'/[locale]/operations'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await getAuth().api.getSession({
    headers: await headers(),
    query: { disableRefresh: true },
  });
  if (!session) redirect(`/${locale}/login`);
  if (!isSupplier(session.user.accountType)) redirect(`/${locale}`);

  const t = getT(locale);
  return (
    <div className="application-page account-page operations-page">
      <Link href={`/${locale}`} className="application-back">
        ← {t('application.backToEquipment')}
      </Link>
      <div className="application-heading">
        <h1>{t('operations.title')}</h1>
        <p>{t('operations.intro')}</p>
      </div>
      <InvoiceRun locale={locale} today={todayIso()} />
      <AuditLog locale={locale} />
    </div>
  );
}
