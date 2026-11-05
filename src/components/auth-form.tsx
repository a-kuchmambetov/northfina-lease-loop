'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AlertIcon, CrateIcon, PersonIcon, SpinnerIcon } from '@/components/auth-icons';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';

// Inputs stay at 16px on phones because iOS Safari zooms the page into anything smaller.
const fieldClass =
  'block h-[52px] w-full rounded-[7px] border border-[#353941] bg-[#05080b] px-4 text-base font-normal text-white placeholder:text-[#a6abb2] hover:border-[#68717d] focus:border-[#d4ff24] sm:text-sm';

const labelClass = 'block text-label font-medium';

const tabClass =
  'flex min-h-[38px] items-center justify-center rounded-[5px] px-2 py-1 leading-tight';

const accountTypes = [
  { type: 'customer', Icon: PersonIcon },
  { type: 'supplier', Icon: CrateIcon },
] as const;

export function AuthForm({ locale, mode }: { locale: Locale; mode: 'login' | 'signup' }) {
  const t = getT(locale);
  const signup = mode === 'signup';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setError('');
    if (signup && String(data.get('password')) !== String(data.get('confirmPassword'))) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/auth/${signup ? 'sign-up' : 'sign-in'}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: String(data.get('email')).trim(),
          password: String(data.get('password')),
          ...(signup
            ? { name: String(data.get('name')).trim(), accountType: data.get('accountType') }
            : {}),
        }),
      });
      if (response.status >= 500) {
        setError(t('auth.unavailable'));
        return;
      }
      const result = await response.json();
      if (!response.ok || !result.success) {
        setError(
          t(
            response.status === 429
              ? 'auth.rateLimited'
              : signup
                ? 'auth.signupError'
                : 'auth.loginError'
          )
        );
        return;
      }
      window.location.assign(`/${locale}`);
    } catch {
      setError(t('auth.networkError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="auth-heading"
      className="min-w-0 rounded-xl border border-[#292d35] bg-[#0d1015] p-6 text-[#f4f5ef] sm:px-[39px] sm:py-[35px]"
    >
      <h1 id="auth-heading" className="text-center text-heading-md sm:text-3xl sm:leading-10">
        {t(signup ? 'auth.createHeading' : 'auth.loginHeading')}
      </h1>
      <p className="mt-2 text-center text-sm text-[#a6abb2]">
        {t(signup ? 'auth.createDescription' : 'auth.loginDescription')}
      </p>
      <nav
        aria-label={t('auth.account')}
        className="mt-[22px] grid min-h-11 grid-cols-2 rounded-[7px] border border-[#292d35] bg-[#05080b] p-0.5 text-center text-label font-semibold"
      >
        <Link
          href={`/${locale}/signup`}
          aria-current={signup ? 'page' : undefined}
          className={`${tabClass} ${signup ? 'bg-[#292d35] text-white' : 'text-[#a6abb2] hover:text-white'}`}
        >
          {t('nav.signup')}
        </Link>
        <Link
          href={`/${locale}/login`}
          aria-current={!signup ? 'page' : undefined}
          className={`${tabClass} ${!signup ? 'bg-[#292d35] text-white' : 'text-[#a6abb2] hover:text-white'}`}
        >
          {t('auth.login')}
        </Link>
      </nav>
      <form onSubmit={submit} className="mt-[22px]" aria-busy={pending}>
        <fieldset disabled={pending} className="min-w-0 space-y-[22px] disabled:opacity-70">
          {signup && (
            <fieldset className="min-w-0">
              <legend className="mb-2 text-label font-medium">{t('auth.accountType')}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {accountTypes.map(({ type, Icon }) => (
                  <label
                    key={type}
                    className="flex min-w-0 cursor-pointer flex-col gap-2 rounded-[7px] border border-[#68717d] bg-[#05080b] p-4 hover:border-[#d4ff24] has-checked:border-[#d4ff24] has-checked:ring-1 has-checked:ring-[#d4ff24] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#d4ff24] has-disabled:cursor-wait"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="flex size-9 items-center justify-center rounded-lg bg-[#292d35] text-[#d4ff24]">
                        <Icon />
                      </span>
                      <input
                        type="radio"
                        name="accountType"
                        value={type}
                        defaultChecked={type === 'customer'}
                        required
                        className="size-4 shrink-0 accent-[#d4ff24] focus-visible:outline-none"
                      />
                    </span>
                    <span className="text-label font-semibold">{t(`auth.${type}`)}</span>
                    <span className="text-xs font-normal hyphens-auto text-[#b8c1ce]">
                      {t(`auth.${type}Hint`)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {signup && (
            <label className={labelClass} htmlFor="name">
              {t('auth.name')}
              <input
                id="name"
                name="name"
                autoComplete="name"
                required
                maxLength={100}
                pattern=".*\S.*"
                className={`mt-2 ${fieldClass}`}
              />
            </label>
          )}
          <label className={labelClass} htmlFor="email">
            {t('auth.email')}
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder={t('auth.emailPlaceholder')}
              required
              maxLength={254}
              className={`mt-2 ${fieldClass}`}
            />
          </label>
          <div>
            <label className={labelClass} htmlFor="password">
              {t('auth.password')}
            </label>
            <div className="relative mt-2">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={signup ? 'new-password' : 'current-password'}
                required
                minLength={signup ? 8 : undefined}
                maxLength={128}
                aria-describedby={signup ? 'password-hint' : undefined}
                placeholder={t('auth.passwordPlaceholder')}
                className={`${fieldClass} pr-20`}
              />
              <button
                type="button"
                aria-controls={signup ? 'password confirmPassword' : 'password'}
                aria-label={t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')}
                title={t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute top-1 right-[5px] flex h-11 items-center justify-center rounded px-3 text-xs font-medium text-[#b8c1ce] hover:text-white"
              >
                {t(showPassword ? 'auth.hide' : 'auth.show')}
              </button>
            </div>
            {signup && (
              <p id="password-hint" className="mt-2 text-xs text-[#b8c1ce]">
                {t('auth.passwordHint')}
              </p>
            )}
          </div>
          {signup && (
            <label className={labelClass} htmlFor="confirmPassword">
              {t('auth.confirmPassword')}
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                className={`mt-2 ${fieldClass}`}
              />
            </label>
          )}
          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
            >
              <AlertIcon />
              {error}
            </p>
          )}
          <button
            type="submit"
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[7px] bg-[#d4ff24] px-4 py-3 text-sm font-semibold text-[#05080b] hover:bg-[#c2ed16] disabled:cursor-wait disabled:opacity-70"
          >
            {pending && <SpinnerIcon className="size-5 motion-safe:animate-spin" />}
            {t(pending ? 'auth.pending' : signup ? 'auth.signup' : 'auth.login')}
          </button>
        </fieldset>
      </form>
      <p className="mt-[22px] text-center text-xs leading-5 text-[#b8c1ce]">
        {t(signup ? 'auth.haveAccount' : 'auth.noAccount')}{' '}
        <Link
          href={`/${locale}/${signup ? 'login' : 'signup'}`}
          className="rounded font-semibold text-[#d4ff24] underline-offset-4 hover:underline"
        >
          {t(signup ? 'auth.login' : 'auth.signup')}
        </Link>
      </p>
    </section>
  );
}
