// The frame around the login and signup forms. A server component: the brand panel
// renders to HTML and ships no JavaScript; only the form inside it is interactive.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowIcon } from '@/components/auth-icons';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';

const loopSteps = ['auth.loopLease', 'auth.loopUse', 'auth.loopReturn', 'auth.loopRenew'] as const;

type AuthShellProps = {
  locale: Locale;
  mode: 'login' | 'signup';
  children: ReactNode;
};

export function AuthShell({ locale, mode, children }: AuthShellProps) {
  const t = getT(locale);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 sm:px-6 sm:py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-8 lg:py-14">
      <div className="relative isolate flex flex-col justify-between gap-10 overflow-hidden rounded-3xl bg-linear-to-br from-emerald-800 to-emerald-950 p-6 text-white shadow-sm sm:p-10 dark:from-emerald-900 dark:to-stone-950 dark:ring-1 dark:ring-emerald-800 dark:ring-inset">
        <LoopBackdrop />
        <div>
          <p className="text-sm font-semibold tracking-wide text-emerald-200 uppercase">
            {t('auth.eyebrow')}
          </p>
          <h1 className="mt-3 text-heading-lg hyphens-auto sm:mt-4 sm:text-5xl sm:leading-tight">
            {t(mode === 'signup' ? 'auth.signupTitle' : 'auth.loginTitle')}
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-emerald-50 sm:mt-5 sm:text-lg">
            {t('auth.intro')}
          </p>
        </div>

        {/* Below lg this panel sits above the form, so the extras step aside for it. */}
        <div className="hidden lg:block">
          <h2 className="font-sans text-sm text-emerald-200">{t('auth.loopTitle')}</h2>
          <ol className="mt-4">
            {loopSteps.map((step, index) => (
              <li
                key={step}
                className="relative flex items-center gap-3 pb-4 not-last:before:absolute not-last:before:top-8 not-last:before:bottom-0 not-last:before:left-4 not-last:before:w-px not-last:before:bg-white/30 last:pb-0"
              >
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold ring-1 ring-white/40 ring-inset"
                >
                  {index + 1}
                </span>
                <span>{t(step)}</span>
              </li>
            ))}
          </ol>
        </div>

        <Link
          href={`/${locale}`}
          className="inline-flex min-h-11 items-center gap-2 self-start rounded font-semibold underline underline-offset-4 focus-visible:outline-white"
        >
          {t('auth.browse')}
          <ArrowIcon className="size-4" />
        </Link>
      </div>

      {children}
    </div>
  );
}

/** The brand's two chasing arrows, enlarged into a quiet watermark behind the panel. */
function LoopBackdrop() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      className="pointer-events-none absolute -top-16 -right-20 -z-10 size-80 text-white/10 lg:top-auto lg:-right-32 lg:-bottom-32 lg:size-[34rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 13a9 9 0 0 1 15.5-4.5L26 11" />
      <path d="M26 5v6h-6" />
      <path d="M24 19a9 9 0 0 1-15.5 4.5L6 21" />
      <path d="M6 27v-6h6" />
    </svg>
  );
}
