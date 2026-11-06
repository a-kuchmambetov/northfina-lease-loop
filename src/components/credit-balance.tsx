'use client';

import { formatEuro } from '@/domain/money';
import { getT } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { useApiQuery } from './use-api-query';

/** Shows the customer's credit, including bonuses earned by passing an item on. */
export function CreditBalance({ customerId, locale }: { customerId: string; locale: Locale }) {
  const t = getT(locale);
  const balance = useApiQuery<{ customerId: string; balanceCents: number }>(
    `/api/customers/${encodeURIComponent(customerId)}/credit`
  );

  return (
    <div className="account-credit" role="status" aria-live="polite">
      {balance.status === 'loading' ? (
        <span>{t('credit.loading')}</span>
      ) : balance.status === 'error' ? (
        <span>{t('credit.failed')}</span>
      ) : balance.data.balanceCents === 0 ? (
        <span>{t('credit.empty')}</span>
      ) : (
        <>
          <span>{t('credit.label')}</span>
          <strong>{formatEuro(balance.data.balanceCents, intlLocale[locale])}</strong>
        </>
      )}
    </div>
  );
}
