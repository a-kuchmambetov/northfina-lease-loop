import Link from 'next/link';
import { hasVatRateChange } from '@/domain/customer-overview';
import { formatEuro } from '@/domain/money';
import { formatIsoDate, formatNumber } from '@/i18n/format';
import { getT, type MessageKey } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import type { CustomerInvoices } from '@/server/features/contracts/get-customer-invoices';

/** A lease's invoices with the VAT shown separately, so the locked net rent and the VAT
 *  charged on each invoice's own date can be told apart. */
export function LeaseInvoices({ lease, invoices, locale }: CustomerInvoices & { locale: Locale }) {
  const t = getT(locale);
  const money = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const date = (isoDate: string) => formatIsoDate(isoDate, locale);

  return (
    <div className="application-page account-page">
      <Link
        href={`/${locale}/account?view=${lease.status === 'active' ? 'active' : 'past'}`}
        className="application-back"
      >
        ← {t('invoices.back')}
      </Link>
      <div className="application-heading">
        <h1>{t('invoices.title', { item: lease.assetName })}</h1>
        <p>{t('invoices.intro', { rent: money(lease.monthlyNetRentCents) })}</p>
        <p>{t('invoices.issuedOnly')}</p>
      </div>
      {hasVatRateChange(invoices) && (
        <p className="application-panel invoices-note" role="note">
          {t('invoices.vatChanged')}
        </p>
      )}
      <table className="account-table invoices-table">
        <thead>
          <tr>
            <th scope="col">{t('invoices.column.number')}</th>
            <th scope="col">{t('invoices.column.due')}</th>
            <th scope="col">{t('invoices.column.net')}</th>
            <th scope="col">{t('invoices.column.vat')}</th>
            <th scope="col">{t('invoices.column.total')}</th>
            <th scope="col">{t('account.column.status')}</th>
            <th scope="col">{t('invoices.column.document')}</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.sequenceNumber}>
              <td>
                <strong>{t('invoices.number', { number: invoice.sequenceNumber })}</strong>
              </td>
              <td>
                <strong>{date(invoice.dueDate)}</strong>
                <span>{t('invoices.payBy', { date: date(invoice.paymentDeadline) })}</span>
              </td>
              <td>{money(invoice.netCents)}</td>
              <td>
                {money(invoice.vatCents)}
                <span>
                  {t('invoices.vatRate', { rate: formatNumber(invoice.vatRatePercent, locale) })}
                </span>
              </td>
              <td>
                <strong>{money(invoice.grossCents)}</strong>
              </td>
              <td>
                {/* Every status has a message; src/i18n/messages.test.ts checks them. */}
                <span className="account-status" data-status={invoice.status}>
                  {t(`invoices.status.${invoice.status}` as MessageKey)}
                </span>
              </td>
              <td>
                <a
                  href={`/api/invoices/${invoice.id}/pdf?locale=${locale}`}
                  className="info-button"
                  download
                >
                  {t('invoicePdf.download')}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
