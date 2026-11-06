import Link from 'next/link';
import { formatIsoDate } from '@/i18n/format';
import { getT, type MessageKey } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { AssetPassportButton } from './asset-passport';
import { SecondLifeReview } from './second-life-review';
import type { ReturnRequest } from '@/server/features/return-requests/get-return-requests';

/** The leases whose item has come back, in the table style of the account page. */
export function ReturnRequests({
  requests,
  locale,
}: {
  requests: ReturnRequest[];
  locale: Locale;
}) {
  const t = getT(locale);
  const date = (isoDate: string) => formatIsoDate(isoDate, locale);

  return (
    <div className="application-page account-page">
      <Link href={`/${locale}`} className="application-back">
        ← {t('application.backToEquipment')}
      </Link>
      <div className="application-heading">
        <h1>{t('requests.title')}</h1>
        <p>{t('requests.intro')}</p>
      </div>
      {requests.length === 0 ? (
        <div className="application-panel account-empty">
          <p>{t('requests.empty')}</p>
          <Link href={`/${locale}`} className="info-button">
            {t('account.browse')}
          </Link>
        </div>
      ) : (
        <table className="account-table">
          <thead>
            <tr>
              <th scope="col">{t('account.column.equipment')}</th>
              <th scope="col">{t('requests.column.renter')}</th>
              <th scope="col">{t('requests.column.lease')}</th>
              <th scope="col">{t('requests.column.returned')}</th>
              <th scope="col">{t('account.column.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.contractId}>
                <td>
                  <strong>{request.assetName}</strong>
                  {request.category && <span>{t(`category.${request.category}`)}</span>}
                </td>
                <td>
                  <strong>{request.renter}</strong>
                </td>
                <td>
                  <strong>{t('account.startedOn', { date: date(request.startDate) })}</strong>
                  <span>{t('estimate.months', { count: request.termMonths })}</span>
                </td>
                <td>
                  {request.returnedOn && (
                    <strong>{t('requests.returnedOn', { date: date(request.returnedOn) })}</strong>
                  )}
                  {/* Every kind has a message; src/i18n/messages.test.ts checks them. */}
                  {request.kind && <span>{t(`requests.kind.${request.kind}` as MessageKey)}</span>}
                </td>
                <td>
                  <div className="supplier-actions">
                    <SecondLifeReview
                      assetId={request.assetId}
                      name={request.assetName}
                      locale={locale}
                    />
                    <AssetPassportButton
                      assetId={request.assetId}
                      name={request.assetName}
                      locale={locale}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
