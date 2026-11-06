'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { assetCategorySchema, assetConditionSchema, type CoefficientTable } from '@/data/schemas';
import {
  selectCatalogue,
  type CatalogueFilters,
  type CatalogueItem,
  type LeaseAccess,
} from '@/domain/catalogue';
import { formatIsoDate } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { AssetCard } from './asset-card';
import { CatalogueDialog } from './catalogue-dialog';
import { CatalogueSelect } from './catalogue-select';
import { EquipmentDetails } from './equipment-details';

const pageSize = 6;
const defaults: CatalogueFilters = {
  category: 'all',
  condition: 'all',
  sort: 'recommended',
};

export function EquipmentCatalogue({
  items,
  table,
  locale,
  today,
  access,
  applicantId,
}: {
  items: CatalogueItem[];
  table: CoefficientTable;
  locale: Locale;
  today: string;
  access: LeaseAccess;
  applicantId: string | undefined;
}) {
  const t = getT(locale);
  const router = useRouter();
  const [filters, setFilters] = useState(defaults);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{
    item: CatalogueItem;
    mode: 'details' | 'estimate';
  } | null>(null);
  const [customerOnly, setCustomerOnly] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const filtered = selectCatalogue(items, filters);
  const pages = Math.ceil(filtered.length / pageSize);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Undefined for customers, who go on to the estimate. A logged-in supplier can't be sent
  // to the login page, because it redirects anyone with a session straight back here.
  const leaseBlocked = {
    customer: undefined,
    guest: () => router.push(`/${locale}/login`),
    not_customer: () => {
      setSelected(null);
      setCustomerOnly(true);
    },
  }[access];

  function updateFilters(change: Partial<CatalogueFilters>) {
    setFilters({ ...filters, ...change });
    setPage(1);
  }
  function changePage(next: number) {
    setPage(next);
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: 'start' });
  }

  return (
    <div className="catalogue-container">
      <div className="catalogue-heading">
        <h1 ref={heading} tabIndex={-1}>
          {t('catalogue.findNext')}
        </h1>
        <p role="status">{t('catalogue.listings', { count: filtered.length })}</p>
      </div>
      <nav className="category-tabs" aria-label={t('catalogue.categories')}>
        {(['all', ...assetCategorySchema.options] as const).map((category) => (
          <button
            type="button"
            key={category}
            aria-pressed={filters.category === category}
            onClick={() => updateFilters({ category })}
          >
            {category === 'all' ? t('catalogue.allEquipment') : t(`category.${category}`)}
            <span>
              {category === 'all'
                ? items.length
                : items.filter(({ asset }) => asset.category === category).length}
            </span>
          </button>
        ))}
      </nav>
      <div className="catalogue-filters">
        <CatalogueSelect
          label={
            filters.condition === 'all' ? t('condition.label') : t(`condition.${filters.condition}`)
          }
          value={filters.condition}
          onChange={(condition) => updateFilters({ condition })}
          options={[
            { value: 'all', label: t('catalogue.anyCondition') },
            ...assetConditionSchema.options.map((value) => ({
              value,
              label: t(`condition.${value}`),
            })),
          ]}
        />
        <div className="filter-spacer" />
        <CatalogueSelect
          label={t('catalogue.sortLabel', { value: t(`catalogue.sort.${filters.sort}`) })}
          value={filters.sort}
          onChange={(sort) => updateFilters({ sort })}
          options={(['recommended', 'condition'] as const).map((value) => ({
            value,
            label: t(`catalogue.sort.${value}`),
          }))}
        />
      </div>
      {visible.length ? (
        <ul className="equipment-grid">
          {visible.map((item) => (
            <li key={item.asset.id}>
              <AssetCard
                item={item}
                locale={locale}
                t={t}
                onDetails={() => setSelected({ item, mode: 'details' })}
                onStart={leaseBlocked ?? (() => setSelected({ item, mode: 'estimate' }))}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="catalogue-empty">
          <p>{t(items.length ? 'catalogue.noResults' : 'catalogue.empty')}</p>
          {items.length > 0 && (
            <button
              type="button"
              className="info-button"
              onClick={() => {
                setFilters(defaults);
                setPage(1);
              }}
            >
              {t('catalogue.reset')}
            </button>
          )}
        </div>
      )}
      {pages > 1 && (
        <nav className="catalogue-pagination" aria-label={t('catalogue.pagination')}>
          <button type="button" disabled={page === 1} onClick={() => changePage(page - 1)}>
            ← {t('catalogue.previous')}
          </button>
          <div>
            {Array.from({ length: pages }, (_, i) => i + 1).map((number) => (
              <button
                type="button"
                key={number}
                aria-current={page === number ? 'page' : undefined}
                aria-label={t('catalogue.page', { number })}
                onClick={() => changePage(number)}
              >
                {number}
              </button>
            ))}
          </div>
          <button type="button" disabled={page === pages} onClick={() => changePage(page + 1)}>
            {t('catalogue.next')} →
          </button>
        </nav>
      )}
      <p className="catalogue-note">
        {t('catalogue.priceNote')}{' '}
        <time dateTime={today}>
          {t('catalogue.pricesOn', { date: formatIsoDate(today, locale) })}
        </time>
      </p>
      {selected && (
        <EquipmentDetails
          key={`${selected.item.asset.id}-${selected.mode}`}
          item={selected.item}
          mode={selected.mode}
          table={table}
          locale={locale}
          applicantId={applicantId}
          onClose={() => setSelected(null)}
          onLeaseBlocked={leaseBlocked}
        />
      )}
      {customerOnly && (
        <CatalogueDialog
          title={t('catalogue.customerOnlyTitle')}
          closeLabel={t('catalogue.close')}
          onClose={() => setCustomerOnly(false)}
        >
          <p className="catalogue-muted">{t('catalogue.customerOnlyDescription')}</p>
        </CatalogueDialog>
      )}
    </div>
  );
}
