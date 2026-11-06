'use client';

import { formatEuro } from '@/domain/money';
import { getT } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import type { TermQuote } from '@/server/features/pricing/compare-quotes';
import { useApiQuery } from './use-api-query';

type Comparison = { priceListVersion: number; quotes: TermQuote[] };

/** Every lease term for the same item and down payment side by side, from
 *  `GET /api/pricing/compare`. A longer term lowers the monthly rent but raises the total. */
export function PriceComparison({
  assetId,
  downPaymentCents,
  selectedTerm,
  locale,
}: {
  assetId: string;
  downPaymentCents: number;
  selectedTerm: number;
  locale: Locale;
}) {
  const t = getT(locale);
  const money = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const query = useApiQuery<Comparison>(
    `/api/pricing/compare?${new URLSearchParams({
      assetId,
      downPaymentCents: String(downPaymentCents),
    })}`,
    150
  );

  if (query.status === 'loading') return <p className="catalogue-muted">{t('compare.loading')}</p>;
  if (query.status === 'error') return <p role="status">{t('compare.failed')}</p>;

  return (
    <section aria-labelledby="compare-title" className="price-comparison">
      <h3 id="compare-title">{t('compare.title')}</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('estimate.term')}</th>
            <th scope="col">{t('compare.monthlyWithVat')}</th>
            <th scope="col">{t('compare.totalCost')}</th>
          </tr>
        </thead>
        <tbody>
          {query.data.quotes.map((entry) => (
            <tr key={entry.termMonths} aria-current={entry.termMonths === selectedTerm}>
              <th scope="row">{t('estimate.months', { count: entry.termMonths })}</th>
              {entry.ok ? (
                <>
                  <td>{money(entry.quote.monthlyRentWithVatCents)}</td>
                  <td>{money(entry.quote.totalCostWithVatCents)}</td>
                </>
              ) : (
                <td colSpan={2}>{t('compare.unavailable')}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="catalogue-muted">{t('compare.note')}</p>
    </section>
  );
}
