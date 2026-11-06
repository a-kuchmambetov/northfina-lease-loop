'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  filterEquipment,
  pageWindow,
  summarizeEquipment,
  SUPPLIER_ITEM_STATUSES,
  type EquipmentFilter,
  type SupplierItemStatus,
} from '@/domain/supplier-equipment';
import { formatIsoDateShort } from '@/i18n/format';
import { getT, type MessageKey, type Translate } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import type { SupplierEquipmentItem } from '@/server/features/supplier-equipment/get-supplier-equipment';
import { CatalogueSelect } from './catalogue-select';
import { AssetPassportButton } from './asset-passport';
import { AssetStatusToggle } from './asset-status-toggle';
import { SecondLifeReview } from './second-life-review';
import { SupplierContractDialog } from './supplier-contract-dialog';

const PAGE_SIZE = 6;

/** The supplier's "Your equipment" page, from Figma's "Suppliers / My equipment" (29:262). */
export function SupplierEquipment({
  items,
  locale,
  supplierName,
}: {
  items: SupplierEquipmentItem[];
  locale: Locale;
  supplierName: string;
}) {
  const t = getT(locale);
  const [filter, setFilter] = useState<EquipmentFilter>('all');
  const [status, setStatus] = useState<SupplierItemStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<SupplierEquipmentItem | null>(null);

  const summary = summarizeEquipment(items.map((item) => item.status));
  const searchable = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        searchText: [item.name, item.serialNumber, item.contract?.code, item.contract?.renter]
          .filter(Boolean)
          .join(' '),
      })),
    [items]
  );
  const filtered = filterEquipment(searchable, { filter, status, query });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  function change<T>(set: (value: T) => void, value: T) {
    set(value);
    setPage(1);
  }
  const count = (key: 'items' | 'activeLeases' | 'contractsEnded' | 'requests', n: number) =>
    t(`supplier.count.${key}.${n === 1 ? 'one' : 'other'}` as MessageKey);
  const quickFilters: [EquipmentFilter, MessageKey, number][] = [
    ['all', 'supplier.filter.all', summary.items],
    ['needs_action', 'supplier.filter.needsAction', summary.needsAction],
    ['active_leases', 'supplier.filter.activeLeases', summary.activeLeases],
  ];

  return (
    <div className="supplier-page">
      <div className="supplier-heading">
        <h1>{t('supplier.title')}</h1>
        <p>{t('supplier.intro')}</p>
      </div>
      <ul className="supplier-overview" aria-label={t('supplier.overview')}>
        {[
          [summary.items, count('items', summary.items)],
          [summary.activeLeases, count('activeLeases', summary.activeLeases)],
          [summary.contractsEnded, count('contractsEnded', summary.contractsEnded)],
          [summary.requestsToReview, count('requests', summary.requestsToReview)],
        ].map(([number, label]) => (
          <li key={label}>
            <strong>{number}</strong> <span>{label}</span>
          </li>
        ))}
      </ul>
      <div className="supplier-filters" role="group" aria-label={t('supplier.filter.label')}>
        {quickFilters.map(([value, label, number]) => (
          <button
            type="button"
            key={value}
            className="supplier-filter"
            aria-pressed={filter === value}
            onClick={() => change(setFilter, value)}
          >
            {t(label)} {number}
          </button>
        ))}
        <input
          type="search"
          className="supplier-search"
          placeholder={t('supplier.search')}
          aria-label={t('supplier.search')}
          value={query}
          onChange={(event) => change(setQuery, event.target.value)}
        />
        <div className="supplier-status-filter">
          <CatalogueSelect
            label={
              status === 'all'
                ? t('supplier.statusFilter')
                : t(`supplier.status.${status}` as MessageKey)
            }
            value={status}
            onChange={(value) => change(setStatus, value)}
            options={[
              { value: 'all', label: t('supplier.statusAll') },
              ...SUPPLIER_ITEM_STATUSES.map((value) => ({
                value,
                label: t(`supplier.status.${value}` as MessageKey),
              })),
            ]}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="catalogue-empty">
          <p>
            {items.length
              ? t('catalogue.noResults')
              : t('catalogue.supplierEmpty', { name: supplierName })}
          </p>
          {items.length > 0 && (
            <button
              type="button"
              className="info-button"
              onClick={() => {
                setFilter('all');
                setStatus('all');
                setQuery('');
                setPage(1);
              }}
            >
              {t('catalogue.reset')}
            </button>
          )}
        </div>
      ) : (
        <table className="supplier-table">
          <thead>
            <tr>
              <th scope="col">{t('account.column.equipment')}</th>
              <th scope="col">{t('account.column.status')}</th>
              <th scope="col">{t('supplier.column.contract')}</th>
              <th scope="col">{t('supplier.column.details')}</th>
              <th scope="col">{t('account.column.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.assetId}>
                <td>
                  <strong>{item.name}</strong>
                  <span>
                    {item.serialNumber} · {t(`category.one.${item.category}`)}
                  </span>
                </td>
                <td>
                  <span className="supplier-status" data-status={item.status}>
                    {t(`supplier.status.${item.status}` as MessageKey)}
                  </span>
                </td>
                <td>{contractCell(item, t, (isoDate) => formatIsoDateShort(isoDate, locale))}</td>
                <td>
                  <strong className="supplier-next-title">
                    {t(`supplier.next.${item.status}.title` as MessageKey)}
                  </strong>
                  <span>{t(`supplier.next.${item.status}.text` as MessageKey)}</span>
                </td>
                <td>
                  <div className="supplier-actions">
                    {item.status === 'returned' && (
                      <Link href={`/${locale}/requests`} className="supplier-action primary">
                        {t('supplier.openRequest')}
                      </Link>
                    )}
                    {item.status === 'returned' && (
                      <SecondLifeReview assetId={item.assetId} name={item.name} locale={locale} />
                    )}
                    {(item.status === 'available' || item.status === 'reserved') && (
                      <AssetStatusToggle
                        assetId={item.assetId}
                        reserved={item.status === 'reserved'}
                        actor={supplierName}
                        locale={locale}
                      />
                    )}
                    <AssetPassportButton assetId={item.assetId} name={item.name} locale={locale} />
                    {item.contract && (
                      <button
                        type="button"
                        className="supplier-action"
                        onClick={() => setOpen(item)}
                      >
                        {t('supplier.viewContract')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pages > 1 && (
        <nav className="catalogue-pagination" aria-label={t('supplier.pagination')}>
          <button type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>
            ← {t('catalogue.previous')}
          </button>
          <div>
            {pageWindow(current, pages).map((entry, index) =>
              entry === 'gap' ? (
                <span key={`gap-${index}`} aria-hidden="true" className="supplier-page-gap">
                  …
                </span>
              ) : (
                <button
                  type="button"
                  key={entry}
                  aria-current={current === entry ? 'page' : undefined}
                  aria-label={t('catalogue.page', { number: entry })}
                  onClick={() => setPage(entry)}
                >
                  {entry}
                </button>
              )
            )}
          </div>
          <button type="button" disabled={current === pages} onClick={() => setPage(current + 1)}>
            {t('catalogue.next')} →
          </button>
        </nav>
      )}
      <p className="catalogue-note">{t('supplier.note')}</p>

      {open?.contract && (
        <SupplierContractDialog
          item={open}
          contract={open.contract}
          locale={locale}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/** The contract's code with a line under it saying where it stands. */
function contractCell(
  item: SupplierEquipmentItem,
  t: Translate,
  date: (isoDate: string) => string
) {
  const { contract, application } = item;
  if (!contract && !application) {
    return <span className="supplier-muted">{t('supplier.contract.none')}</span>;
  }
  if (!contract && application) {
    return (
      <>
        <strong>{application.code}</strong>
        <span>{t('supplier.contract.pending')}</span>
      </>
    );
  }
  if (!contract) return null;
  const line =
    item.status === 'leased'
      ? t('supplier.contract.ends', { date: date(contract.endDate) })
      : item.status === 'contract_ended'
        ? t('supplier.contract.ended', { date: date(contract.endDate) })
        : item.status === 'returned' && contract.returnedOn
          ? t('supplier.contract.returned', { date: date(contract.returnedOn) })
          : t('supplier.contract.started', { date: date(contract.startDate) });
  return (
    <>
      <strong>{contract.code}</strong>
      <span>{line}</span>
    </>
  );
}
