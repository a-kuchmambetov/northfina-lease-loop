// The root layout. Every page lives under /[locale] (/en, /fi, /sv, /et), so the
// <html lang> attribute is always right for the page.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { bodyFont, headingFont } from '@/app/fonts';
import { AuthNav } from '@/components/auth-nav';
import { LanguageSwitcher } from '@/components/language-switcher';
import { NavigationInfo } from '@/components/navigation-info';
import { getT } from '@/i18n/get-t';
import { isLocale } from '@/i18n/locales';
import '../globals.css';
import '../catalogue.css';
import '../application.css';
import '../account.css';
import '../supplier.css';
import '../profile.css';
import '../operations.css';

export async function generateMetadata({ params }: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getT(locale);
  return { title: t('meta.title'), description: t('meta.description') };
}

export default async function LocaleLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);

  return (
    <html lang={locale} className={`${bodyFont.variable} ${headingFont.variable}`}>
      <body className="flex min-h-dvh flex-col bg-[#030407] text-[#f4f5ef] antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-10 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-stone-900 focus:shadow"
        >
          {t('nav.skipToContent')}
        </a>

        <header className="bg-[#03060d] text-[#f4f5ef]">
          <div className="bg-gradient-to-b from-transparent via-[rgba(0,90,255,0.03)] to-[rgba(0,90,255,0.18)]">
            <div className="mx-auto flex min-h-[90px] max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 sm:px-8 lg:px-16 lg:py-6">
              <Link
                href={`/${locale}`}
                className="flex shrink-0 items-center gap-2.5 font-bold leading-ui"
              >
                <span aria-hidden="true" className="text-heading-lg text-[#d4ff24]">
                  ↗
                </span>
                <span className="text-heading-md text-[#1558c9]">{t('nav.brand')}</span>
              </Link>
              <nav
                aria-label={t('nav.primary')}
                className="order-last flex w-full flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm leading-ui lg:order-none lg:w-auto lg:flex-1"
              >
                <Link href={`/${locale}`} className="font-semibold text-[#d4ff24]">
                  {t('nav.explore')}
                </Link>
                <NavigationInfo locale={locale} />
              </nav>
              <div className="ml-auto flex flex-wrap items-center gap-6 lg:ml-0">
                <AuthNav locale={locale} />
                <LanguageSwitcher current={locale} label={t('nav.language')} />
              </div>
            </div>
          </div>
          <div
            aria-hidden="true"
            className="h-0.5 bg-gradient-to-r from-transparent via-[#0099ff] to-transparent"
          />
        </header>

        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>

        <footer className="site-footer">
          <div>
            <span>{t('footer.keepMoving')}</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
