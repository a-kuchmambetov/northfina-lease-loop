'use client';

import { useState } from 'react';
import type { AssetPassport as Passport } from '@/server/features/second-life/get-asset-passport';
import { formatEuro } from '@/domain/money';
import { formatIsoDateShort, formatNumber } from '@/i18n/format';
import { getT, type MessageKey } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { CatalogueDialog } from './catalogue-dialog';
import { useApiQuery } from './use-api-query';

/** An item's history across lives and the CO₂ it has saved, from
 *  `GET /api/assets/:id/passport`. The file is only fetched once the dialog is opened. */
export function AssetPassportButton({
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
      <button type="button" className="supplier-action" onClick={() => setOpen(true)}>
        {t('passport.button')}
      </button>
      {open && (
        <CatalogueDialog
          title={t('passport.title', { item: name })}
          closeLabel={t('catalogue.close')}
          onClose={() => setOpen(false)}
        >
          <PassportBody assetId={assetId} locale={locale} />
        </CatalogueDialog>
      )}
    </>
  );
}

function PassportBody({ assetId, locale }: { assetId: string; locale: Locale }) {
  const t = getT(locale);
  const query = useApiQuery<Passport>(`/api/assets/${assetId}/passport`);
  if (query.status === 'loading') return <p className="catalogue-muted">{t('passport.loading')}</p>;
  if (query.status === 'error') return <p role="alert">{t('passport.failed')}</p>;

  const { lives, totalCo2SavedKg, totalMoneySavedCents } = query.data;
  const money = (cents: number) => formatEuro(cents, intlLocale[locale]);
  return (
    <>
      <dl className="supplier-contract-details">
        <div>
          <dt>{t('passport.lives')}</dt>
          <dd>{formatNumber(lives.length, locale)}</dd>
        </div>
        <div>
          <dt>{t('passport.co2')}</dt>
          <dd>{t('passport.kg', { value: formatNumber(totalCo2SavedKg, locale) })}</dd>
        </div>
        <div>
          <dt>{t('passport.money')}</dt>
          <dd>{money(totalMoneySavedCents)}</dd>
        </div>
      </dl>
      {lives.length === 0 ? (
        <p className="catalogue-muted">{t('passport.empty')}</p>
      ) : (
        <table className="passport-lives">
          <thead>
            <tr>
              <th scope="col">{t('passport.column.life')}</th>
              <th scope="col">{t('passport.column.started')}</th>
              <th scope="col">{t('passport.column.status')}</th>
              <th scope="col">{t('passport.column.co2')}</th>
              <th scope="col">{t('passport.column.money')}</th>
            </tr>
          </thead>
          <tbody>
            {lives.map((life, index) => (
              <tr key={life.contractId}>
                <th scope="row">
                  {index + 1}
                  {life.wasRefurbished && <span> · {t('passport.refurbished')}</span>}
                </th>
                <td>
                  {formatIsoDateShort(life.startDate, locale)}
                  <span> · {t('estimate.months', { count: life.termMonths })}</span>
                </td>
                {/* Every contract status has a message; src/i18n/messages.test.ts checks them. */}
                <td>{t(`account.status.${life.status}` as MessageKey)}</td>
                <td>{t('passport.kg', { value: formatNumber(life.co2SavedKg, locale) })}</td>
                <td>{money(life.moneySavedCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="catalogue-muted">{t('passport.note')}</p>
    </>
  );
}
