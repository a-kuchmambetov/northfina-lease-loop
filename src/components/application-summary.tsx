import type { Asset } from '@/data/schemas';
import { formatEuro } from '@/domain/money';
import { getT } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import type { ApplicationView } from '@/server/features/application/get-application';

export function ApplicationSummary({
  application,
  asset,
  locale,
}: {
  application: ApplicationView;
  asset: Pick<Asset, 'make' | 'model' | 'category'>;
  locale: Locale;
}) {
  const t = getT(locale);
  const money = (cents: number) => formatEuro(cents, intlLocale[locale]);
  return (
    <aside
      className="application-panel application-summary"
      aria-label={t('application.yourLease')}
    >
      <p className="application-eyebrow">{t('application.yourLease')}</p>
      <h2>
        {asset.make} {asset.model}
      </h2>
      <p className="application-muted">{t(`category.${asset.category}`)}</p>
      <p className="application-rent">
        <strong>{money(application.monthlyRentWithVatCents)}</strong>{' '}
        {t('application.perMonthWithVat')}
      </p>
      <dl>
        <div>
          <dt>{t('estimate.term')}</dt>
          <dd>{t('estimate.months', { count: application.termMonths })}</dd>
        </div>
        <div>
          <dt>{t('estimate.financed')}</dt>
          <dd>{money(application.financedAmountCents)}</dd>
        </div>
      </dl>
      <p className="application-muted">{t('application.priceLocked')}</p>
    </aside>
  );
}
