'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { normalizeSignature } from '@/domain/application-contract';
import { getT, type MessageKey } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { CatalogueDialog } from './catalogue-dialog';

/** Forms a contract from an approved application: shows the deal, signs with a typed name,
 *  then re-renders the page it sits on, which then shows the signed application. */
export function SignContract({
  applicationId,
  locale,
  item,
  termMonths,
  rent,
}: {
  applicationId: string;
  locale: Locale;
  item: string;
  termMonths: number;
  /** The monthly rent including VAT, already formatted for the locale. */
  rent: string;
}) {
  const t = getT(locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  async function sign(event: FormEvent) {
    event.preventDefault();
    const signature = normalizeSignature(name);
    if (!signature.ok) {
      setError(
        signature.reason === 'signature_too_long' ? 'contract.nameTooLong' : 'contract.nameRequired'
      );
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/applications/${applicationId}/contract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedName: name }),
      });
      if (response.ok) {
        setOpen(false);
        router.refresh();
        return;
      }
      const code: unknown = (await response.json().catch(() => null))?.error?.code;
      // Signed or cancelled in another tab: the refreshed page shows where it stands now.
      if (code === 'ALREADY_SIGNED' || code === 'NOT_APPROVED') {
        setOpen(false);
        router.refresh();
        return;
      }
      setError(code === 'ASSET_NOT_AVAILABLE' ? 'contract.unavailable' : 'contract.failed');
    } catch {
      setError('contract.failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className="lease-button" onClick={() => setOpen(true)}>
        {t('contract.form')}
      </button>
      {open && (
        <CatalogueDialog
          title={t('contract.title')}
          closeLabel={t('catalogue.close')}
          onClose={close}
        >
          <form className="contract-form" onSubmit={(event) => void sign(event)} noValidate>
            <p className="catalogue-muted">{t('contract.intro')}</p>
            <p>{t('contract.terms', { item, months: termMonths, rent })}</p>
            <p className="catalogue-muted">{t('contract.firstInvoice')}</p>
            <label htmlFor="contract-name">{t('contract.nameLabel')}</label>
            <input
              id="contract-name"
              type="text"
              value={name}
              autoComplete="name"
              autoFocus
              aria-invalid={error === 'contract.nameRequired' || error === 'contract.nameTooLong'}
              aria-describedby={error ? 'contract-error' : 'contract-hint'}
              onChange={(event) => setName(event.target.value)}
            />
            <p id="contract-hint" className="catalogue-muted">
              {t('contract.nameHint')}
            </p>
            {error && (
              <p id="contract-error" role="alert" className="application-error">
                {t(error)}
              </p>
            )}
            <div className="application-actions">
              <button type="button" className="info-button" disabled={pending} onClick={close}>
                {t('contract.notYet')}
              </button>
              <button type="submit" className="lease-button" disabled={pending}>
                {t(pending ? 'contract.signing' : 'contract.sign')}
              </button>
            </div>
          </form>
        </CatalogueDialog>
      )}
    </>
  );
}
