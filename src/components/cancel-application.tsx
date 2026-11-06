'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { CatalogueDialog } from './catalogue-dialog';

/** Cancels an application after asking first, then re-renders the page it sits on. */
export function CancelApplication({
  applicationId,
  locale,
  disabled = false,
}: {
  applicationId: string;
  locale: Locale;
  disabled?: boolean;
}) {
  const t = getT(locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function cancel() {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/applications/${applicationId}/cancel`, { method: 'POST' });
      if (!response.ok) throw new Error();
      setOpen(false);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  function close() {
    if (pending) return;
    setOpen(false);
    setFailed(false);
  }

  return (
    <>
      <button
        type="button"
        className="info-button cancel-application"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {t('account.cancel')}
      </button>
      {open && (
        <CatalogueDialog
          title={t('account.cancelTitle')}
          closeLabel={t('catalogue.close')}
          onClose={close}
        >
          <p className="catalogue-muted">{t('account.cancelWarning')}</p>
          {failed && (
            <p role="alert" className="application-error">
              {t('account.cancelFailed')}
            </p>
          )}
          <div className="application-actions">
            <button type="button" className="info-button" disabled={pending} onClick={close}>
              {t('account.cancelKeep')}
            </button>
            <button
              type="button"
              className="lease-button"
              disabled={pending}
              onClick={() => void cancel()}
            >
              {t(pending ? 'account.cancelling' : 'account.cancelConfirm')}
            </button>
          </div>
        </CatalogueDialog>
      )}
    </>
  );
}
