'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';

export function AuthNav({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [user, setUser] = useState<{ name: string; accountType?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function outside(event: PointerEvent) {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector('summary')?.focus();
      }
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);

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
          <details ref={menu} className="account-menu">
            <summary>{t('nav.myAccount')}</summary>
            <div className="account-menu-content">
              <span className="block max-w-52 truncate">{user.name}</span>
              {user.accountType === 'customer' && (
                <Link
                  href={`/${locale}/account`}
                  className="font-medium hover:text-white"
                  onClick={() => {
                    if (menu.current) menu.current.open = false;
                  }}
                >
                  {t('account.menuLink')}
                </Link>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={signOut}
                className="rounded-lg bg-[#2563eb] px-2 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {t(pending ? 'auth.pending' : 'auth.logout')}
              </button>
            </div>
          </details>
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
