'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatEuro } from '@/domain/money';
import { getT, type MessageKey } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import type { SecondLifeMatchComputation } from '@/server/features/second-life/compute-second-life-match';
import { CatalogueDialog } from './catalogue-dialog';
import { useApiQuery } from './use-api-query';

/**
 * The second-life decision for a returned item: refurbish or not, who on the waiting list
 * gets it and at what rent. Opening the dialog previews it (`GET
 * /api/assets/:id/second-life-match`, nothing changes); the confirm button applies it
 * (`POST` to the same path), which makes the item available again.
 */
export function SecondLifeReview({
  assetId,
  name,
  locale,
}: {
  assetId: string;
  name: string;
  locale: Locale;
}) {
  const t = getT(locale);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="supplier-action primary" onClick={() => setOpen(true)}>
        {t('secondLife.button')}
      </button>
      {open && (
        <CatalogueDialog
          title={t('secondLife.title', { item: name })}
          closeLabel={t('catalogue.close')}
          onClose={() => setOpen(false)}
        >
          <ReviewBody assetId={assetId} locale={locale} onClose={() => setOpen(false)} />
        </CatalogueDialog>
      )}
    </>
  );
}

function ReviewBody({
  assetId,
  locale,
  onClose,
}: {
  assetId: string;
  locale: Locale;
  onClose: () => void;
}) {
  const t = getT(locale);
  const router = useRouter();
  const url = `/api/assets/${assetId}/second-life-match`;
  const query = useApiQuery<SecondLifeMatchComputation>(url);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const money = (cents: number) => formatEuro(cents, intlLocale[locale]);

  async function apply() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const result = await response.json();
      if (!result.success) throw new Error();
      onClose();
      router.refresh();
    } catch {
      setError('secondLife.failed');
      setPending(false);
    }
  }

  if (query.status === 'loading') {
    return <p className="catalogue-muted">{t('secondLife.loading')}</p>;
  }
  if (query.status === 'error') {
    const message: MessageKey =
      query.code === 'ASSET_NOT_RETURNED'
        ? 'secondLife.handled'
        : query.code === 'ASSET_CONTRACT_NOT_FOUND'
          ? 'secondLife.noContract'
          : 'secondLife.loadFailed';
    return <p role="alert">{t(message)}</p>;
  }

  const {
    outcome,
    refurbishPlan,
    mandatoryCostCents,
    winner,
    candidatesAsIs,
    candidatesRefurbished,
  } = query.data;
  const ranked = outcome === 'refurbish' ? candidatesRefurbished : candidatesAsIs;
  return (
    <>
      <p>
        <strong>{t(`secondLife.outcome.${outcome}` as MessageKey)}</strong>
      </p>
      <dl className="supplier-contract-details">
        {refurbishPlan && (
          <div>
            <dt>{t('secondLife.refurbishCost')}</dt>
            <dd>{money(refurbishPlan.totalCostCents)}</dd>
          </div>
        )}
        {mandatoryCostCents > 0 && (
          <div>
            <dt>{t('secondLife.mandatoryCost')}</dt>
            <dd>{money(mandatoryCostCents)}</dd>
          </div>
        )}
        {winner && (
          <>
            <div>
              <dt>{t('secondLife.winner')}</dt>
              <dd>{winner.request.who}</dd>
            </div>
            <div>
              <dt>{t('secondLife.rent')}</dt>
              <dd>
                {money(winner.rentCents)} ·{' '}
                {t('estimate.months', { count: winner.request.preferred_term_months })}
              </dd>
            </div>
            <div>
              <dt>{t('secondLife.revenue')}</dt>
              <dd>{money(winner.totalRevenueCents)}</dd>
            </div>
          </>
        )}
      </dl>
      {ranked.length > 1 && (
        <p className="catalogue-muted">
          {t('secondLife.others', {
            count: ranked.length - 1,
            who: ranked
              .slice(1)
              .map((candidate) => candidate.request.who)
              .join(', '),
          })}
        </p>
      )}
      <p className="catalogue-muted">{t('secondLife.notice')}</p>
      {error && (
        <p role="alert" className="application-error">
          {t(error)}
        </p>
      )}
      <div className="application-actions">
        <button type="button" className="info-button" disabled={pending} onClick={onClose}>
          {t('buy.cancel')}
        </button>
        <button
          type="button"
          className="lease-button"
          disabled={pending}
          onClick={() => void apply()}
        >
          {t(pending ? 'secondLife.applying' : 'secondLife.apply')}
        </button>
      </div>
    </>
  );
}
