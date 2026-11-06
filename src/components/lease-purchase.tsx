'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatEuro } from '@/domain/money';
import { getT, type MessageKey } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { CatalogueDialog } from './catalogue-dialog';

async function postJson(path: string, body: unknown): Promise<{ amountCents?: number } | null> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Buys the leased item. After the term the price is the locked buyout
 * (`POST /api/contracts/:id/end-of-term`); before it, the price is worked out for today
 * (`POST /api/contracts/:id/early-exit`) and shown first with `dryRun`, which changes nothing.
 */
export function BuyLease({
  leaseId,
  termOver,
  buyoutCents,
  locale,
}: {
  leaseId: string;
  termOver: boolean;
  buyoutCents: number;
  locale: Locale;
}) {
  const t = getT(locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);
  const money = (cents: number) => formatEuro(cents, intlLocale[locale]);

  async function openDialog() {
    setOpen(true);
    setError(null);
    if (termOver) {
      setAmountCents(buyoutCents);
      return;
    }
    setAmountCents(null);
    const quote = await postJson(`/api/contracts/${leaseId}/early-exit`, {
      action: 'buy',
      dryRun: true,
    });
    if (quote?.amountCents === undefined) setError('buy.quoteFailed');
    else setAmountCents(quote.amountCents);
  }

  async function confirm() {
    setPending(true);
    setError(null);
    const done = termOver
      ? await postJson(`/api/contracts/${leaseId}/end-of-term`, { action: 'buy' })
      : await postJson(`/api/contracts/${leaseId}/early-exit`, { action: 'buy' });
    setPending(false);
    if (!done) {
      setError('buy.failed');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  function close() {
    if (!pending) setOpen(false);
  }

  return (
    <>
      <button type="button" className="info-button" onClick={() => void openDialog()}>
        {t('buy.button')}
      </button>
      {open && (
        <CatalogueDialog title={t('buy.title')} closeLabel={t('catalogue.close')} onClose={close}>
          {amountCents === null && !error && <p className="catalogue-muted">{t('buy.loading')}</p>}
          {amountCents !== null && (
            <>
              <p>
                {t(termOver ? 'buy.endPrice' : 'buy.earlyPrice', { amount: money(amountCents) })}
              </p>
              <p className="catalogue-muted">{t('buy.whatNext')}</p>
            </>
          )}
          {error && (
            <p role="alert" className="application-error">
              {t(error)}
            </p>
          )}
          <div className="application-actions">
            <button type="button" className="info-button" disabled={pending} onClick={close}>
              {t('buy.cancel')}
            </button>
            <button
              type="button"
              className="lease-button"
              disabled={pending || amountCents === null}
              onClick={() => void confirm()}
            >
              {t(pending ? 'buy.buying' : 'buy.confirm')}
            </button>
          </div>
        </CatalogueDialog>
      )}
    </>
  );
}

/** Keeps the item for another term once this one is over
 *  (`POST /api/contracts/:id/end-of-term` with `extend`). */
export function ExtendLease({
  leaseId,
  terms,
  locale,
}: {
  leaseId: string;
  /** The lease terms on offer, in months. */
  terms: number[];
  locale: Locale;
}) {
  const t = getT(locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState(terms[0] ?? 12);
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    setError(null);
    const done = await postJson(`/api/contracts/${leaseId}/end-of-term`, {
      action: 'extend',
      additionalTermMonths: months,
    });
    setPending(false);
    if (!done) {
      setError('extend.failed');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  function close() {
    if (!pending) setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="info-button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {t('extend.button')}
      </button>
      {open && (
        <CatalogueDialog
          title={t('extend.title')}
          closeLabel={t('catalogue.close')}
          onClose={close}
        >
          <p>{t('extend.intro')}</p>
          <label htmlFor={`extend-${leaseId}`}>
            {t('extend.months')}
            <select
              id={`extend-${leaseId}`}
              value={months}
              onChange={(event) => setMonths(Number(event.target.value))}
            >
              {terms.map((term) => (
                <option key={term} value={term}>
                  {t('estimate.months', { count: term })}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="application-error">
              {t(error)}
            </p>
          )}
          <div className="application-actions">
            <button type="button" className="info-button" disabled={pending} onClick={close}>
              {t('buy.cancel')}
            </button>
            <button
              type="button"
              className="lease-button"
              disabled={pending}
              onClick={() => void confirm()}
            >
              {t(pending ? 'extend.extending' : 'extend.confirm')}
            </button>
          </div>
        </CatalogueDialog>
      )}
    </>
  );
}
