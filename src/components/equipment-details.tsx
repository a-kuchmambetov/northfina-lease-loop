'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { CoefficientTable } from '@/data/schemas';
import type { CatalogueItem } from '@/domain/catalogue';
import { downPaymentRange, estimateLease } from '@/domain/lease-estimate';
import { formatEuro } from '@/domain/money';
import { formatNumber } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { Fact } from './asset-card';
import { CatalogueDialog } from './catalogue-dialog';

export function EquipmentDetails({
  item,
  mode,
  table,
  locale,
  onClose,
}: {
  item: CatalogueItem;
  mode: 'details' | 'estimate';
  table: CoefficientTable;
  locale: Locale;
  onClose: () => void;
}) {
  const t = getT(locale);
  const [view, setView] = useState(mode);
  const [term, setTerm] = useState(36);
  const { asset, price } = item;
  const priceCents = price.ok ? price.priceCents : 0;
  const { min: minDown, max: maxDown } = downPaymentRange(table, priceCents);
  const [downCents, setDownCents] = useState(minDown);
  const [downInput, setDownInput] = useState((minDown / 100).toFixed(2));
  const estimate = price.ok ? estimateLease(table, price.priceCents, term, downCents) : null;
  const money = (cents: number) => formatEuro(cents, intlLocale[locale]);
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
            <Fact label={t('asset.serialNumber')} value={asset.serial_number} />
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
            disabled={asset.status !== 'available' || !price.ok}
            onClick={() => setView('estimate')}
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
          <div>
            {estimate?.ok ? (
              <>
                <p className="estimate-monthly">
                  <strong>{money(estimate.monthlyNetCents)}</strong> {t('catalogue.monthly')}
                </p>
                <dl className="equipment-facts detail-facts">
                  <Fact
                    label={t('asset.listPrice')}
                    value={price.ok ? money(price.priceCents) : t('asset.noPrice')}
                  />
                  <Fact label={t('estimate.financed')} value={money(estimate.financedCents)} />
                  <Fact
                    label={t('estimate.factor')}
                    value={new Intl.NumberFormat(intlLocale[locale], {
                      maximumFractionDigits: 6,
                    }).format(estimate.factor)}
                  />
                  <Fact label={t('estimate.totalRent')} value={money(estimate.totalRentNetCents)} />
                  <Fact label={t('estimate.buyout')} value={money(estimate.buyoutNetCents)} />
                </dl>
              </>
            ) : (
              <p role="status">{t(estimate ? `estimate.${estimate.reason}` : 'asset.noPrice')}</p>
            )}
          </div>
          <p className="estimate-notice">{t('estimate.notice')}</p>
        </>
      )}
    </CatalogueDialog>
  );
}
