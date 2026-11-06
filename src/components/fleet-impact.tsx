'use client';

import Link from 'next/link';
import { formatEuro } from '@/domain/money';
import { formatNumber } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import type { FleetImpact as Impact } from '@/server/features/second-life/get-fleet-impact';
import { useApiQuery } from './use-api-query';

/** CO₂ and money saved by second and third lives across the whole fleet, from
 *  `GET /api/fleet/impact`. Items that have had only one life saved nothing and are left out. */
export function FleetImpact({
  locale,
  itemNames,
}: {
  locale: Locale;
  /** Asset id → "Make Model", for the rows. */
  itemNames: Record<string, string>;
}) {
  const t = getT(locale);
  const query = useApiQuery<Impact>('/api/fleet/impact');
  const money = (cents: number) => formatEuro(cents, intlLocale[locale]);

  return (
    <div className="application-page account-page">
      <Link href={`/${locale}`} className="application-back">
        ← {t('application.backToEquipment')}
      </Link>
      <div className="application-heading">
        <h1>{t('fleet.title')}</h1>
        <p>{t('fleet.intro')}</p>
      </div>
      {query.status === 'loading' && <p className="catalogue-muted">{t('fleet.loading')}</p>}
      {query.status === 'error' && (
        <p role="alert" className="application-panel">
          {t('fleet.failed')}
        </p>
      )}
      {query.status === 'ok' && (
        <FleetBody impact={query.data} itemNames={itemNames} locale={locale} money={money} />
      )}
    </div>
  );
}

function FleetBody({
  impact,
  itemNames,
  locale,
  money,
}: {
  impact: Impact;
  itemNames: Record<string, string>;
  locale: Locale;
  money: (cents: number) => string;
}) {
  const t = getT(locale);
  const saving = impact.items.filter((item) => item.co2SavedKg > 0 || item.moneySavedCents > 0);
  return (
    <>
      <ul className="supplier-overview">
        <li>
          <strong>
            {t('passport.kg', { value: formatNumber(impact.totalCo2SavedKg, locale) })}
          </strong>
          {t('passport.co2')}
        </li>
        <li>
          <strong>{money(impact.totalMoneySavedCents)}</strong>
          {t('passport.money')}
        </li>
        <li>
          <strong>{formatNumber(saving.length, locale)}</strong>
          {t('fleet.itemsSaving')}
        </li>
      </ul>
      {saving.length === 0 ? (
        <div className="application-panel account-empty">
          <p>{t('fleet.empty')}</p>
        </div>
      ) : (
        <table className="account-table">
          <thead>
            <tr>
              <th scope="col">{t('account.column.equipment')}</th>
              <th scope="col">{t('passport.column.co2')}</th>
              <th scope="col">{t('passport.column.money')}</th>
            </tr>
          </thead>
          <tbody>
            {saving.map((item) => (
              <tr key={item.assetId}>
                <td>
                  <strong>{itemNames[item.assetId] ?? item.assetId}</strong>
                </td>
                <td>{t('passport.kg', { value: formatNumber(item.co2SavedKg, locale) })}</td>
                <td>{money(item.moneySavedCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="catalogue-muted">{t('passport.note')}</p>
    </>
  );
}
