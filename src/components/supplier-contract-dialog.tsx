'use client';

import { formatEuro } from '@/domain/money';
import { formatIsoDate } from '@/i18n/format';
import { getT, type MessageKey } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import type {
  SupplierContract,
  SupplierEquipmentItem,
} from '@/server/features/supplier-equipment/get-supplier-equipment';
import { CatalogueDialog } from './catalogue-dialog';

/** A contract's terms, read-only, for the supplier whose item it is. */
export function SupplierContractDialog({
  item,
  contract,
  locale,
  onClose,
}: {
  item: SupplierEquipmentItem;
  contract: SupplierContract;
  locale: Locale;
  onClose: () => void;
}) {
  const t = getT(locale);
  const money = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const date = (isoDate: string) => formatIsoDate(isoDate, locale);
  const rows: [string, string][] = [
    [t('supplier.contract.renter'), contract.renter],
    [t('account.column.equipment'), item.name],
    // Every contract status has a message; src/i18n/messages.test.ts checks them.
    [t('supplier.contract.status'), t(`account.status.${contract.status}` as MessageKey)],
    [t('supplier.contract.start'), date(contract.startDate)],
    [t('supplier.contract.end'), date(contract.endDate)],
    [t('estimate.term'), t('estimate.months', { count: contract.termMonths })],
    [t('supplier.contract.rent'), money(contract.monthlyNetRentCents)],
    [t('supplier.contract.downPayment'), money(contract.downPaymentCents)],
    [t('supplier.contract.agreedTotal'), money(contract.agreedNetCents)],
    [t('supplier.contract.paidInvoices'), money(contract.paidInvoicesCents)],
    [t('estimate.buyout'), money(contract.buyoutCents)],
  ];

  return (
    <CatalogueDialog
      title={t('supplier.contractTitle', { code: contract.code })}
      closeLabel={t('catalogue.close')}
      onClose={onClose}
    >
      <dl className="supplier-contract-details">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </CatalogueDialog>
  );
}
