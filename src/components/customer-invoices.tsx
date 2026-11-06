import Link from 'next/link';
import { invoiceNumber } from '@/domain/invoice-document';
import { invoiceDisplayStatus } from '@/domain/invoice-status';
import { formatEuro } from '@/domain/money';
import { formatIsoDate, formatNumber } from '@/i18n/format';
import { getT, type MessageKey } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { InvoicePreview } from './invoice-preview';
import { PayInvoice } from './pay-invoice';
import type { AllCustomerInvoices } from '@/server/features/customer-invoices/get-all-customer-invoices';

/** Every invoice of every lease in one table, in the style of a lease's own invoice page
 *  (lease-invoices.tsx), with the equipment added so the rows can be told apart. */
export function CustomerInvoices({
  rows,
  unavailableLeases,
  locale,
  today,
}: AllCustomerInvoices & { locale: Locale; today: string }) {
  const t = getT(locale);
  const money = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const date = (isoDate: string) => formatIsoDate(isoDate, locale);

  return (
    <div className="application-page account-page">
      <div className="application-heading">
        <h1>{t('invoices.all.title')}</h1>
        <p>{t('invoices.all.intro')}</p>
        <p>{t('invoices.issuedOnly')}</p>
      </div>
      {unavailableLeases > 0 && (
        <p className="application-panel invoices-note" role="note">
          {t('invoices.all.unavailable')}
        </p>
      )}
      {rows.length === 0 ? (
        <div className="application-panel account-empty">
          <p>{t('invoices.all.empty')}</p>
          <Link href={`/${locale}`} className="info-button">
            {t('account.browse')}
          </Link>
        </div>
      ) : (
        <table className="account-table invoices-table">
          <thead>
            <tr>
              <th scope="col">{t('invoices.column.number')}</th>
              <th scope="col">{t('account.column.equipment')}</th>
              <th scope="col">{t('invoices.column.dueDate')}</th>
              <th scope="col">{t('invoices.column.vat')}</th>
              <th scope="col">{t('invoices.column.total')}</th>
              <th scope="col">{t('account.column.status')}</th>
              <th scope="col">{t('invoices.column.document')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ lease, invoice }) => {
              const status = invoiceDisplayStatus(invoice.status, invoice.paymentDeadline, today);
              return (
                <tr key={invoice.id}>
                  <td>
                    <strong>
                      {invoice.kind === 'early_return_fee'
                        ? t('invoices.feeLabel')
                        : t('invoices.number', { number: invoice.sequenceNumber })}
                    </strong>
                  </td>
                  <td>
                    <strong>{lease.assetName}</strong>
                    <span>
                      <Link href={`/${locale}/leases/${lease.id}/invoices`} className="underline">
                        {t('invoices.all.lease')}
                      </Link>
                    </span>
                  </td>
                  <td>
                    <strong>{date(invoice.paymentDeadline)}</strong>
                    <span>{t('invoices.invoicedOn', { date: date(invoice.invoiceDate) })}</span>
                  </td>
                  <td>
                    {money(invoice.vatCents)}
                    <span>
                      {t('invoices.vatRate', {
                        rate: formatNumber(invoice.vatRatePercent, locale),
                      })}
                    </span>
                  </td>
                  <td>
                    <strong>{money(invoice.grossCents)}</strong>
                    <span>{t('invoices.all.net', { amount: money(invoice.netCents) })}</span>
                  </td>
                  <td>
                    {/* Every status has a message; src/i18n/messages.test.ts checks them. */}
                    <span className="account-status" data-status={status}>
                      {t(`invoices.status.${status}` as MessageKey)}
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
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
