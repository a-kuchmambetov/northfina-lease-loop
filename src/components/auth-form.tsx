'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  AlertIcon,
  CrateIcon,
  EyeIcon,
  EyeOffIcon,
  PersonIcon,
  SpinnerIcon,
} from '@/components/auth-icons';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';

// Borders use stone-500 so a field's edge keeps 3:1 contrast against the card in both themes.
const fieldClass =
  'block h-12 w-full rounded-xl border border-stone-500 bg-white px-4 text-base font-normal transition-colors hover:border-stone-700 focus:border-emerald-700 motion-reduce:transition-none dark:bg-stone-950 dark:hover:border-stone-300 dark:focus:border-emerald-400';

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
      className="min-w-0 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-8 dark:border-stone-800 dark:bg-stone-900"
    >
      <h1 id="auth-heading" className="text-2xl font-semibold tracking-tight">
        {t(signup ? 'auth.signup' : 'auth.login')}
      </h1>
      <form onSubmit={submit} className="mt-6" aria-busy={pending}>
        <fieldset disabled={pending} className="min-w-0 space-y-5 disabled:opacity-70">
          {signup && (
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-medium">{t('auth.accountType')}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {accountTypes.map(({ type, Icon }) => (
                  <label
                    key={type}
                    className="flex min-w-0 cursor-pointer flex-col gap-2 rounded-xl border border-stone-500 bg-white p-4 transition-colors hover:border-emerald-700 hover:bg-emerald-50 has-checked:border-emerald-700 has-checked:bg-emerald-50 has-checked:ring-1 has-checked:ring-emerald-700 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-emerald-600 has-disabled:cursor-wait motion-reduce:transition-none dark:bg-stone-950 dark:hover:border-emerald-400 dark:hover:bg-emerald-950 dark:has-checked:border-emerald-400 dark:has-checked:bg-emerald-950 dark:has-checked:ring-emerald-400 dark:has-[:focus-visible]:outline-emerald-400"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                        <Icon />
                      </span>
                      <input
                        type="radio"
                        name="accountType"
                        value={type}
                        required
                        className="size-4 shrink-0 accent-emerald-700 focus-visible:outline-none dark:accent-emerald-400"
                      />
                    </span>
                    <span className="text-sm font-semibold">{t(`auth.${type}`)}</span>
                    <span className="text-sm font-normal hyphens-auto text-stone-600 dark:text-stone-300">
                      {t(`auth.${type}Hint`)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {signup && (
            <label className="block text-sm font-medium" htmlFor="name">
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
          <label className="block text-sm font-medium" htmlFor="email">
            {t('auth.email')}
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              className={`mt-2 ${fieldClass}`}
            />
          </label>
          <div>
            <label className="block text-sm font-medium" htmlFor="password">
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
                className={`${fieldClass} pr-13`}
              />
              <button
                type="button"
                aria-controls={signup ? 'password confirmPassword' : 'password'}
                aria-label={t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')}
                title={t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute top-1 right-1 flex size-10 items-center justify-center rounded-lg text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 motion-reduce:transition-none dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            {signup && (
              <p id="password-hint" className="mt-2 text-sm text-stone-600 dark:text-stone-400">
                {t('auth.passwordHint')}
              </p>
            )}
          </div>
          {signup && (
            <label className="block text-sm font-medium" htmlFor="confirmPassword">
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
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:cursor-wait motion-reduce:transition-none"
          >
            {pending && <SpinnerIcon className="size-5 motion-safe:animate-spin" />}
            {t(pending ? 'auth.pending' : signup ? 'auth.signup' : 'auth.login')}
          </button>
        </fieldset>
      </form>
      <p className="mt-6 border-t border-stone-200 pt-6 text-center text-sm text-stone-600 dark:border-stone-800 dark:text-stone-400">
        {t(signup ? 'auth.haveAccount' : 'auth.noAccount')}{' '}
        <Link
          href={`/${locale}/${signup ? 'login' : 'signup'}`}
          className="rounded font-semibold text-emerald-700 underline underline-offset-4 dark:text-emerald-400"
        >
          {t(signup ? 'auth.login' : 'auth.signup')}
        </Link>
      </p>
    </section>
  );
}
