'use client';

import { useState, type FormEvent } from 'react';
import { isoDateSchema } from '@/data/schemas';
import { formatIsoDate, formatNumber } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import type { ApiEnvelope } from '@/server/api-response';
import type { IssueAllDueInvoicesResult } from '@/server/features/contracts/issue-all-due-invoices';

type RunState =
  | { status: 'idle' | 'running' | 'invalid' | 'error' | 'unavailable' }
  | { status: 'ok'; date: string; result: IssueAllDueInvoicesResult };

/** Runs only on submission: the GET endpoint changes data and must never be prefetched. */
export function InvoiceRun({ locale, today }: { locale: Locale; today: string }) {
  const t = getT(locale);
  const [date, setDate] = useState(today);
  const [run, setRun] = useState<RunState>({ status: 'idle' });
  const running = run.status === 'running';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running) return;
    // Reuse the route's calendar-date validation, including leap years and month lengths.
    const parsed = isoDateSchema.safeParse(date);
    if (!parsed.success) {
      setRun({ status: 'invalid' });
      return;
    }

    setRun({ status: 'running' });
    try {
      const response = await fetch(
        `/api/system/issue-due-invoices?asOf=${encodeURIComponent(parsed.data)}`,
        { cache: 'no-store' }
      );
      if (response.status === 401) {
        setRun({ status: 'unavailable' });
        return;
      }
      const body: ApiEnvelope<IssueAllDueInvoicesResult> = await response.json();
      setRun(
        response.ok && body.success
          ? { status: 'ok', date: parsed.data, result: body.data }
          : { status: 'error' }
      );
    } catch {
      setRun({ status: 'error' });
    }
  }

  return (
    <section className="application-panel operations-section" aria-labelledby="invoice-run-title">
      <h2 id="invoice-run-title">{t('invoiceRun.title')}</h2>
      <p id="invoice-run-note" className="catalogue-muted">
        {t('invoiceRun.note')}
      </p>
      <form className="operations-run-form" onSubmit={submit} noValidate aria-busy={running}>
        <div className="operations-date-field">
          <label htmlFor="invoice-run-date">{t('invoiceRun.date')}</label>
          <input
            id="invoice-run-date"
            name="asOf"
            type="date"
            required
            max="9999-12-31"
            value={date}
            disabled={running}
            aria-invalid={run.status === 'invalid'}
            aria-describedby={`invoice-run-note${run.status === 'invalid' ? ' invoice-run-invalid' : ''}`}
            onChange={(event) => {
              setDate(event.target.value);
              setRun({ status: 'idle' });
            }}
          />
        </div>
        <button type="submit" className="supplier-action primary" disabled={running}>
          {t(running ? 'invoiceRun.running' : 'invoiceRun.run')}
        </button>
      </form>
      {run.status === 'invalid' && (
        <p id="invoice-run-invalid" role="alert">
          {t('invoiceRun.invalidDate')}
        </p>
      )}
      {run.status === 'error' && <p role="alert">{t('invoiceRun.failed')}</p>}
      <div role="status" aria-live="polite">
        {running && <p>{t('invoiceRun.running')}</p>}
        {run.status === 'unavailable' && <p>{t('invoiceRun.unavailable')}</p>}
        {run.status === 'ok' && (
          <div className="operations-run-result">
            <p>{t('invoiceRun.completed', { date: formatIsoDate(run.date, locale) })}</p>
            <dl className="operations-counts">
              <div>
                <dt>{t('invoiceRun.contractsChecked')}</dt>
                <dd>{formatNumber(run.result.contractsChecked, locale)}</dd>
              </div>
              <div>
                <dt>{t('invoiceRun.invoicesIssued')}</dt>
                <dd>{formatNumber(run.result.invoicesIssued, locale)}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}
