'use client';

import Link from 'next/link';
import { isSupplier } from '@/domain/catalogue';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { useSessionUser } from './use-session-user';

/** The "Requests" item of the main navigation. Only suppliers see it. The page behind it
 *  checks the account type again, so hiding the link is not what protects it. */
export function RequestsNavLink({ locale }: { locale: Locale }) {
  const user = useSessionUser();
  if (!isSupplier(user?.accountType)) return null;
  return (
    <Link href={`/${locale}/requests`} className="nav-info-button">
      {getT(locale)('nav.requests')}
    </Link>
  );
}
