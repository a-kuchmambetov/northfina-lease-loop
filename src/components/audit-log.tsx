'use client';

import { useState } from 'react';
import { getT } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import type { SupplierAuditEntry } from '@/server/features/audit-log/get-audit-log';
import { useApiQuery } from './use-api-query';

/** Refreshing changes the query URL so useApiQuery fetches the newest rows again. */
export function AuditLog({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [refresh, setRefresh] = useState(0);
  const query = useApiQuery<SupplierAuditEntry[]>(`/api/audit-log?refresh=${refresh}`);
  const loading = query.status === 'loading';
  const timestamp = new Intl.DateTimeFormat(intlLocale[locale], {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Europe/Helsinki',
  });

  return (
    <section className="application-panel operations-section" aria-labelledby="audit-log-title">
      <div className="operations-section-heading">
        <h2 id="audit-log-title">{t('auditLog.title')}</h2>
        <button
          type="button"
          className="supplier-action"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {t('auditLog.refresh')}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {loading && <p className="catalogue-muted">{t('auditLog.loading')}</p>}
        {query.status === 'ok' && query.data.length === 0 && (
          <p className="catalogue-muted">{t('auditLog.empty')}</p>
        )}
      </div>
      {query.status === 'error' && <p role="alert">{t('auditLog.failed')}</p>}
      {query.status === 'ok' && query.data.length > 0 && (
        <div
          className="operations-table-scroll"
          role="region"
          aria-labelledby="audit-log-title"
          tabIndex={0}
        >
          <table className="operations-audit-table">
            <caption>{t('auditLog.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('auditLog.column.time')}</th>
                <th scope="col">{t('auditLog.column.actor')}</th>
                <th scope="col">{t('auditLog.column.action')}</th>
                <th scope="col">{t('auditLog.column.entity')}</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((row) => (
                <tr key={row.id}>
                  <td>
                    <time dateTime={row.created_at}>
                      {timestamp.format(new Date(row.created_at))}
                    </time>
                  </td>
                  <td>{row.actor}</td>
                  <td>{row.action}</td>
                  <td>
                    <span>{row.entity_type}</span>
                    <span className="operations-entity-id">{row.entity_id}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
