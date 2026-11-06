import Link from 'next/link';
import { hasVatRateChange } from '@/domain/customer-overview';
import { invoiceNumber } from '@/domain/invoice-document';
import { invoiceDisplayStatus } from '@/domain/invoice-status';
import { formatEuro } from '@/domain/money';
import { formatIsoDate, formatNumber } from '@/i18n/format';
import { getT, type MessageKey } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { InvoicePreview } from './invoice-preview';
import { PayInvoice } from './pay-invoice';
import type { CustomerInvoices } from '@/server/features/contracts/get-customer-invoices';

/** A lease's invoices with the VAT shown separately, so the locked net rent and the VAT
 *  charged on each invoice's own date can be told apart. */
export function LeaseInvoices({
  lease,
  invoices,
  locale,
  today,
}: CustomerInvoices & { locale: Locale; today: string }) {
  const t = getT(locale);
  const money = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const date = (isoDate: string) => formatIsoDate(isoDate, locale);
  // Unpaid and past its payment deadline: expired (src/domain/invoice-status.ts).
  const status = (invoice: CustomerInvoices['invoices'][number]) =>
    invoiceDisplayStatus(invoice.status, invoice.paymentDeadline, today);

  return (
    <div className="application-page account-page">
      <Link
        href={`/${locale}/leases?view=${lease.status === 'active' ? 'active' : 'past'}`}
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
            <th scope="col">{t('invoices.column.dueDate')}</th>
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
                <strong>
                  {invoice.kind === 'early_return_fee'
                    ? t('invoices.feeLabel')
                    : t('invoices.number', { number: invoice.sequenceNumber })}
                </strong>
              </td>
              <td>
                <strong>{date(invoice.paymentDeadline)}</strong>
                <span>{t('invoices.invoicedOn', { date: date(invoice.invoiceDate) })}</span>
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
                <span className="account-status" data-status={status(invoice)}>
                  {t(`invoices.status.${status(invoice)}` as MessageKey)}
                </span>
                {invoice.status === 'cancelled' && <span>{t('invoices.cancelledNote')}</span>}
              </td>
              <td>
                <div className="account-actions">
                  {invoice.status === 'issued' && (
                    <PayInvoice invoiceId={invoice.id} locale={locale} />
                  )}
                  <InvoicePreview
                    invoiceId={invoice.id}
                    number={invoiceNumber(lease.id, invoice.sequenceNumber, invoice.kind)}
                    locale={locale}
                  />
                  <a
                    href={`/api/invoices/${invoice.id}/pdf?locale=${locale}`}
                    className="info-button"
                    download
                  >
                    {t('invoicePdf.download')}
                  </a>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
