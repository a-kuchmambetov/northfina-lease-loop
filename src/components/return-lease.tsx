'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatEuro } from '@/domain/money';
import { getT, type MessageKey } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { CatalogueDialog } from './catalogue-dialog';

type Quote = {
  kind: 'end_of_term' | 'early';
  feeCents: number;
  /** The fee invoice's total with VAT. */
  feeGrossCents: number;
  /** Unpaid rent invoices the fee covers, which returning cancels. */
  cancelledInvoiceCount: number;
  cancelledInvoicesGrossCents: number;
  monthsElapsed: number;
  termMonths: number;
};

/** Gives a leased item back. Opening the dialog asks the server what returning costs today
 *  without changing anything; only the confirm button returns the item. */
export function ReturnLease({ leaseId, locale }: { leaseId: string; locale: Locale }) {
  const t = getT(locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);

  async function post(confirm: boolean) {
    const response = await fetch(`/api/leases/${leaseId}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm }),
    });
    if (!response.ok) throw new Error();
    return (await response.json()).data as Quote;
  }

  async function openDialog() {
    setOpen(true);
    setQuote(null);
    setError(null);
    try {
      setQuote(await post(false));
    } catch {
      setError('return.quoteFailed');
    }
  }

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await post(true);
      setOpen(false);
      router.refresh();
    } catch {
      setError('return.failed');
    } finally {
      setPending(false);
    }
  }

  function close() {
    if (!pending) setOpen(false);
  }

  const fee = quote && formatEuro(quote.feeGrossCents, intlLocale[locale]);
  const feeMessage: MessageKey | null = !quote
    ? null
    : quote.kind === 'end_of_term'
      ? 'return.free'
      : quote.feeCents > 0
        ? 'return.earlyFee'
        : 'return.earlyNoFee';

  return (
    <>
      <button type="button" className="info-button" onClick={() => void openDialog()}>
        {t('return.button')}
      </button>
      {open && (
        <CatalogueDialog
          title={t('return.title')}
          closeLabel={t('catalogue.close')}
          onClose={close}
        >
          {!quote && !error && <p className="catalogue-muted">{t('return.loading')}</p>}
          {quote && feeMessage && (
            <>
              <p>
                {t(feeMessage, {
                  months: quote.monthsElapsed,
                  term: quote.termMonths,
                  fee: fee ?? '',
                })}
              </p>
              {quote.cancelledInvoiceCount > 0 && (
                <p>
                  {t('return.cancelsInvoice', {
                    amount: formatEuro(quote.cancelledInvoicesGrossCents, intlLocale[locale]),
                  })}
                </p>
              )}
              <p className="catalogue-muted">{t('return.whatNext')}</p>
            </>
          )}
          {error && (
            <p role="alert" className="application-error">
              {t(error)}
            </p>
          )}
          <div className="application-actions">
            <button type="button" className="info-button" disabled={pending} onClick={close}>
              {t('return.keep')}
            </button>
            <button
              type="button"
              className="lease-button"
              disabled={pending || !quote}
              onClick={() => void confirm()}
            >
              {t(pending ? 'return.returning' : 'return.confirm')}
            </button>
          </div>
        </CatalogueDialog>
      )}
    </>
  );
}
