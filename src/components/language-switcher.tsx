'use client';

// Links to the same page in each language: /fi/anything → /en/anything.
// A client component only because it needs the current path.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { localeNames, locales, type Locale } from '@/i18n/locales';

export function LanguageSwitcher({ current, label }: { current: Locale; label: string }) {
  const pathname = usePathname();
  const rest = pathname.split('/').slice(2).join('/');

  return (
    <nav aria-label={label}>
      <ul className="flex items-center gap-2">
        {locales.map((locale) => {
          const active = locale === current;
          return (
            <li key={locale}>
              <Link
                href={rest ? `/${locale}/${rest}` : `/${locale}`}
                hrefLang={locale}
                lang={locale}
                aria-current={active ? 'page' : undefined}
                className={
                  'block py-2 text-xs font-semibold uppercase transition-colors ' +
                  (active ? 'text-[#2563eb]' : 'text-[#a6abb2] hover:text-white')
                }
              >
                <span aria-hidden="true">{locale}</span>
                <span className="sr-only">{localeNames[locale]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
