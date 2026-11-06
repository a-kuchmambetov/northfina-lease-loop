'use client';

import { useState } from 'react';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { CatalogueDialog } from './catalogue-dialog';

export function NavigationInfo({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const t = getT(locale);
  return (
    <>
      <button type="button" className="nav-info-button" onClick={() => setOpen(true)}>
        {t('nav.howItWorks')}
      </button>
      {open && (
        <CatalogueDialog
          title={t('auth.loopTitle')}
          closeLabel={t('catalogue.close')}
          onClose={() => setOpen(false)}
        >
          <ol className="loop-steps">
            {(['auth.loopLease', 'auth.loopUse', 'auth.loopReturn', 'auth.loopRenew'] as const).map(
              (key) => (
                <li key={key}>{t(key)}</li>
              )
            )}
          </ol>
        </CatalogueDialog>
      )}
    </>
  );
}
