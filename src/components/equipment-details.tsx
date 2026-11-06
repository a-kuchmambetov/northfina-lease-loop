'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CoefficientTable } from '@/data/schemas';
import type { CatalogueItem } from '@/domain/catalogue';
import { downPaymentRange } from '@/domain/lease-estimate';
import { formatEuro } from '@/domain/money';
import type { PriceQuote } from '@/domain/pricing';
import { formatNumber } from '@/i18n/format';
import { getT, type MessageKey } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { Fact } from './asset-card';
import { CatalogueDialog } from './catalogue-dialog';
import { PriceComparison } from './price-comparison';
import { useApiQuery } from './use-api-query';

/** What `GET /api/pricing/quote` answers with. */
type Quote = PriceQuote & { priceListVersion: number };

/** The message for a quote the API refused, by its error code. */
function quoteErrorKey(code: string): MessageKey {
  switch (code) {
    case 'DOWN_PAYMENT_NEGATIVE':
    case 'DOWN_PAYMENT_EXCEEDS_LIST_PRICE':
      return 'estimate.invalid_down_payment';
    case 'BELOW_MINIMUM':
      return 'estimate.below_minimum';
    case 'ABOVE_MAXIMUM':
      return 'estimate.above_maximum';
    case 'UNKNOWN_TERM':
      return 'estimate.unknown_term';
    default:
      return 'estimate.quoteFailed';
  }
}

export function EquipmentDetails({
  item,
  mode,
  table,
  locale,
  applicantId,
  onClose,
  onLeaseBlocked,
}: {
  item: CatalogueItem;
  mode: 'details' | 'estimate';
  table: CoefficientTable;
  locale: Locale;
  applicantId: string | undefined;
  onClose: () => void;
  onLeaseBlocked?: () => void;
}) {
  const t = getT(locale);
  const [view, setView] = useState(mode);
  const [term, setTerm] = useState(36);
  const { asset, price } = item;
  const priceCents = price.ok ? price.priceCents : 0;
  const { min: minDown, max: maxDown } = downPaymentRange(table, priceCents);
  const [downCents, setDownCents] = useState(minDown);
  const [downInput, setDownInput] = useState((minDown / 100).toFixed(2));
  // The price comes from the API, not from a calculation in the browser. The slider is
  // dragged freely, so the request waits for it to settle.
  const quote = useApiQuery<Quote>(
    price.ok && view === 'estimate'
      ? `/api/pricing/quote?${new URLSearchParams({
          assetId: asset.id,
          termMonths: String(term),
          downPaymentCents: String(downCents),
        })}`
      : null,
    150
  );
  const money = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [startFailed, setStartFailed] = useState(false);

  async function startApplication() {
    setStarting(true);
    setStartFailed(false);
    try {
      const response = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: applicantId,
          assetId: asset.id,
          termMonths: term,
          downPaymentCents: downCents,
        }),
      });
      const body = await response.json();
      if (body.success) {
        router.push(`/${locale}/applications/${body.data.applicationId}`);
        return;
      }
    } catch {
      // Reported below, the same as a refused request.
    }
    setStartFailed(true);
    setStarting(false);
  }

  return (
    <CatalogueDialog
      title={`${asset.make} ${asset.model}`}
      closeLabel={t('catalogue.close')}
      onClose={onClose}
    >
      {view === 'details' ? (
        <>
          <Image
            src={item.image}
            width={322}
            height={190}
            alt={t('catalogue.photoAlt', { category: t(`category.${asset.category}`) })}
            className="detail-image"
          />
          <p className="catalogue-muted">{t('catalogue.photosIllustrative')}</p>
          <dl className="equipment-facts detail-facts">
            <Fact label={t('condition.label')} value={t(`condition.${asset.condition}`)} />
            <Fact label={t('asset.modelYear')} value={String(asset.model_year)} />
            <Fact
              label={t('asset.usage')}
              value={t(`usage.${asset.usage.unit}`, {
                value: formatNumber(asset.usage.value, locale),
              })}
            />
            <Fact
              label={t('asset.previousLives')}
              value={formatNumber(asset.previous_lives, locale)}
            />
            <Fact label={t('status.label')} value={t(`status.${asset.status}`)} />
            {asset.serial_number && (
              <Fact label={t('asset.serialNumber')} value={asset.serial_number} />
            )}
            <Fact
              label={t('asset.listPrice')}
              value={price.ok ? money(price.priceCents) : t('asset.noPrice')}
            />
            {price.ok && (
              <Fact label={t('catalogue.priceVersion')} value={String(price.priceListVersion)} />
            )}
          </dl>
          <button
            type="button"
            className="lease-button dialog-action"
            onClick={onLeaseBlocked ?? (() => setView('estimate'))}
          >
            {t('catalogue.startContract')}
          </button>
        </>
      ) : (
        <>
          <p className="catalogue-muted">{t('estimate.intro')}</p>
          <label className="estimate-slider" htmlFor="lease-term">
            <span>
              {t('estimate.term')}
              <strong>{t('estimate.months', { count: term })}</strong>
            </span>
            <input
              id="lease-term"
              type="range"
              min="12"
              max="48"
              step="12"
              value={term}
              onChange={(e) => setTerm(Number(e.target.value))}
              aria-valuetext={t('estimate.months', { count: term })}
            />
          </label>
          <label className="estimate-slider" htmlFor="lease-down-payment">
            <span>
              {t('estimate.downPayment')}
              <strong>{money(downCents)}</strong>
            </span>
            <input
              id="lease-down-payment"
              type="range"
              min={minDown}
              max={maxDown}
              step={Math.max(1, Math.round(priceCents / 100))}
              value={downCents}
              onChange={(e) => {
                const value = Number(e.target.value);
                setDownCents(value);
                setDownInput((value / 100).toFixed(2));
              }}
              aria-valuetext={money(downCents)}
            />
          </label>
          <label>
            {t('estimate.downPayment')} (€)
            <input
              type="number"
              inputMode="decimal"
              min={minDown / 100}
              max={maxDown / 100}
              step="0.01"
              value={downInput}
              onChange={(e) => {
                const value = e.target.value;
                setDownInput(value);
                if (/^\d+(?:\.\d{0,2})?$/.test(value)) {
                  const [euros, cents = ''] = value.split('.');
                  const amount = Number(euros) * 100 + Number(cents.padEnd(2, '0'));
                  if (Number.isSafeInteger(amount) && amount >= minDown && amount <= maxDown)
                    setDownCents(amount);
                }
              }}
              onBlur={() => setDownInput((downCents / 100).toFixed(2))}
            />
          </label>
          <div aria-live="polite">
            {quote.status === 'ok' ? (
              <>
                <p className="estimate-monthly">
                  <strong>{money(quote.data.monthlyNetRentCents)}</strong> {t('catalogue.monthly')}
                </p>
                <dl className="equipment-facts detail-facts">
                  <Fact
                    label={t('estimate.monthlyWithVat')}
                    value={t('estimate.withVatValue', {
                      amount: money(quote.data.monthlyRentWithVatCents),
                      rate: formatNumber(quote.data.vatRatePercent, locale),
                    })}
                  />
                  <Fact label={t('asset.listPrice')} value={money(quote.data.listPriceCents)} />
                  <Fact label={t('estimate.financed')} value={money(quote.data.financedCents)} />
                  <Fact
                    label={t('estimate.factor')}
                    value={new Intl.NumberFormat(intlLocale[locale], {
                      maximumFractionDigits: 6,
                    }).format(quote.data.monthlyFactor)}
                  />
                  <Fact
                    label={t('estimate.totalCost')}
                    value={money(quote.data.totalCostWithVatCents)}
                  />
                  <Fact label={t('estimate.buyout')} value={money(quote.data.buyoutCents)} />
                </dl>
              </>
            ) : quote.status === 'error' ? (
              <p role="status">{t(price.ok ? quoteErrorKey(quote.code) : 'asset.noPrice')}</p>
            ) : (
              <p className="catalogue-muted">{t('estimate.loading')}</p>
            )}
          </div>
          {price.ok && (
            <PriceComparison
              assetId={asset.id}
              downPaymentCents={downCents}
              selectedTerm={term}
              locale={locale}
            />
          )}
          <p className="estimate-notice">{t('estimate.notice')}</p>
          {startFailed && (
            <p className="application-error" role="alert">
              {t('estimate.startFailed')}
            </p>
          )}
          <button
            type="button"
            className="lease-button dialog-action"
            disabled={starting || !applicantId || quote.status !== 'ok'}
            onClick={startApplication}
          >
            {t('estimate.continue')}
          </button>
        </>
      )}
    </CatalogueDialog>
  );
}
