'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';

export function AuthForm({ locale, mode }: { locale: Locale; mode: 'login' | 'signup' }) {
  const t = getT(locale);
  const signup = mode === 'signup';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const inputClass =
    'mt-2 block w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base dark:border-stone-600 dark:bg-stone-900';

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
          ...(signup ? { name: String(data.get('name')).trim() } : {}),
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
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center lg:gap-20">
      <aside className="max-w-md">
        <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
          {t('auth.eyebrow')}
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          {t(signup ? 'auth.signupTitle' : 'auth.loginTitle')}
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-stone-600 dark:text-stone-400">
          {t('auth.intro')}
        </p>
        <Link
          href={`/${locale}`}
          className="mt-6 inline-block rounded text-sm font-medium text-emerald-700 underline underline-offset-4 dark:text-emerald-400"
        >
          {t('auth.browse')}
        </Link>
      </aside>
      <section
        aria-label={t(signup ? 'auth.signup' : 'auth.login')}
        className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8 dark:border-stone-800 dark:bg-stone-900"
      >
        <h2 className="text-2xl font-semibold">{t(signup ? 'auth.signup' : 'auth.login')}</h2>
        <form onSubmit={submit} className="mt-6 space-y-5" aria-busy={pending}>
          <fieldset disabled={pending} className="space-y-5 disabled:opacity-70">
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
                  className={inputClass}
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
                className={inputClass}
              />
            </label>
            <div>
              <label className="block text-sm font-medium" htmlFor="password">
                {t('auth.password')}
              </label>
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={signup ? 'new-password' : 'current-password'}
                required
                minLength={signup ? 8 : undefined}
                maxLength={128}
                aria-describedby={signup ? 'password-hint' : undefined}
                className={inputClass}
              />
              {signup && (
                <p id="password-hint" className="mt-2 text-sm text-stone-600 dark:text-stone-400">
                  {t('auth.passwordHint')}
                </p>
              )}
              <button
                type="button"
                aria-controls="password"
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
                className="mt-2 rounded text-sm font-medium text-emerald-700 dark:text-emerald-400"
              >
                {t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')}
              </button>
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
                  className={inputClass}
                />
              </label>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
              >
                {error}
              </p>
            )}
            <button
              type="submit"
              className="w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-wait"
            >
              {t(pending ? 'auth.pending' : signup ? 'auth.signup' : 'auth.login')}
            </button>
          </fieldset>
        </form>
        <p className="mt-6 text-sm text-stone-600 dark:text-stone-400">
          {t(signup ? 'auth.haveAccount' : 'auth.noAccount')}{' '}
          <Link
            href={`/${locale}/${signup ? 'login' : 'signup'}`}
            className="rounded font-semibold text-emerald-700 underline underline-offset-4 dark:text-emerald-400"
          >
            {t(signup ? 'auth.login' : 'auth.signup')}
          </Link>
        </p>
      </section>
    </div>
  );
}
