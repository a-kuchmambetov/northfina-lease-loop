'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getT, type MessageKey } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { CatalogueDialog } from './catalogue-dialog';

/** Confirms the authorised signatory's signature, then reloads the lease's status. */
export function ConfirmSignature({ leaseId, locale }: { leaseId: string; locale: Locale }) {
  const t = getT(locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/contracts/${encodeURIComponent(leaseId)}/confirm-signature`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        switch (result.error?.code) {
          case 'NOT_PENDING_SIGNATURE':
            setError('signature.notPending');
            break;
          case 'CONTRACT_NOT_FOUND':
            setError('signature.notFound');
            break;
          default:
            setError('signature.failed');
        }
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('signature.failed');
    } finally {
      setPending(false);
    }
  }

  function close() {
    if (!pending) setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="lease-button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {t('signature.button')}
      </button>
      {open && (
        <CatalogueDialog
          title={t('signature.title')}
          closeLabel={t('catalogue.close')}
          onClose={close}
        >
          <p>{t('signature.intro')}</p>
          {error && (
            <p role="alert" className="application-error">
              {t(error)}
            </p>
          )}
          <div className="application-actions">
            <button type="button" className="info-button" disabled={pending} onClick={close}>
              {t('signature.cancel')}
            </button>
            <button
              type="button"
              className="lease-button"
              disabled={pending}
              onClick={() => void confirm()}
            >
              {t(pending ? 'signature.confirming' : 'signature.button')}
            </button>
          </div>
        </CatalogueDialog>
      )}
    </>
  );
}
