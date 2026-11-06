'use client';

import Link from 'next/link';
import { useState } from 'react';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { CatalogueDialog } from './catalogue-dialog';

export function NavigationInfo({ locale }: { locale: Locale }) {
  const [view, setView] = useState<'loop' | 'business' | null>(null);
  const t = getT(locale);
  return (
    <>
      <button type="button" className="nav-info-button" onClick={() => setView('loop')}>
        {t('nav.howItWorks')}
      </button>
      <button type="button" className="nav-info-button" onClick={() => setView('business')}>
        {t('nav.businesses')}
      </button>
      {view && (
        <CatalogueDialog
          title={t(view === 'loop' ? 'auth.loopTitle' : 'nav.businesses')}
          closeLabel={t('catalogue.close')}
          onClose={() => setView(null)}
        >
          {view === 'loop' ? (
            <ol className="loop-steps">
              {(
                ['auth.loopLease', 'auth.loopUse', 'auth.loopReturn', 'auth.loopRenew'] as const
              ).map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ol>
          ) : (
            <>
              <p className="catalogue-muted">{t('catalogue.businessInfo')}</p>
              <Link
                className="lease-button dialog-action"
                href={`/${locale}/signup`}
                onClick={() => setView(null)}
              >
                {t('auth.signup')}
              </Link>
            </>
          )}
        </CatalogueDialog>
      )}
    </>
  );
}
