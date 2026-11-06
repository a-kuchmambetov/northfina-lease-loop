'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';

const customerLinks = [
  { page: 'leases', key: 'nav.myLeases' },
  { page: 'invoices', key: 'nav.myInvoices' },
  { page: 'profile', key: 'nav.myProfile' },
] as const;

const supplierLinks = [
  { page: 'requests', key: 'nav.requests' },
  { page: 'fleet', key: 'nav.fleetImpact' },
  { page: 'operations', key: 'nav.operations' },
] as const;

/** Which customer page `pathname` belongs to. A lease's own invoice page counts as invoices. */
function currentPage(
  pathname: string,
  locale: Locale
): 'leases' | 'invoices' | 'profile' | 'requests' | 'fleet' | 'operations' | null {
  if (pathname === `/${locale}/requests`) return 'requests';
  if (pathname === `/${locale}/fleet`) return 'fleet';
  if (pathname === `/${locale}/operations`) return 'operations';
  if (pathname === `/${locale}/profile`) return 'profile';
  if (pathname === `/${locale}/invoices` || pathname.endsWith('/invoices')) return 'invoices';
  if (pathname === `/${locale}/leases`) return 'leases';
  return null;
}

export function AuthNav({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [user, setUser] = useState<{ name: string; accountType?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const pathname = usePathname();

  useEffect(() => {
    let active = true;
    fetch('/api/auth/get-session', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((result) => {
        if (!result.success) throw new Error();
        if (active) setUser(result.data?.user ?? null);
      })
      .catch(() => {
        if (active) setSessionError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/sign-out', { method: 'POST' });
      if (response.status >= 500) {
        setError(t('auth.unavailable'));
        setPending(false);
        return;
      }
      const result = await response.json();
      if (!response.ok || !result.success) {
        setError(t(response.status === 429 ? 'auth.rateLimited' : 'auth.networkError'));
        setPending(false);
        return;
      }
      window.location.assign(`/${locale}`);
    } catch {
      setError(t('auth.networkError'));
      setPending(false);
    }
  }

  if (loading)
    return (
      <span role="status" className="text-sm text-[#a6abb2]">
        {t('auth.pending')}
      </span>
    );
  if (sessionError)
    return (
      <span role="alert" className="text-sm">
        {t('auth.sessionError')}{' '}
        <Link href={`/${locale}/login`} className="underline">
          {t('auth.login')}
        </Link>
      </span>
    );
  return (
    <nav
      aria-label={t('auth.account')}
      className="flex flex-wrap items-center gap-4 text-sm leading-ui"
    >
      {user ? (
        <>
          {(user.accountType === 'customer'
            ? customerLinks
            : user.accountType === 'supplier'
              ? supplierLinks
              : []
          ).map(({ page, key }) => (
            <Link
              key={page}
              href={`/${locale}/${page}`}
              aria-current={currentPage(pathname, locale) === page ? 'page' : undefined}
              className="nav-link"
            >
              {t(key)}
            </Link>
          ))}
          <button
            type="button"
            disabled={pending}
            onClick={signOut}
            className="rounded-lg bg-[#2563eb] px-2 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {t(pending ? 'auth.pending' : 'auth.logout')}
          </button>
          {error && <span role="alert">{error}</span>}
        </>
      ) : (
        <>
          <Link
            href={`/${locale}/login`}
            className="rounded-lg px-1.5 py-2 font-medium hover:text-white"
          >
            {t('auth.login')}
          </Link>
          <Link
            href={`/${locale}/signup`}
            className="rounded-lg bg-[#2563eb] px-1.5 py-2 font-medium text-white hover:bg-blue-700"
          >
            {t('nav.signup')}
          </Link>
        </>
      )}
    </nav>
  );
}
