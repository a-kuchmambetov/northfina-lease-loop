import Link from 'next/link';
import { canCancelApplication } from '@/domain/application-cancellation';
import type { OverviewView } from '@/domain/customer-overview';
import { overviewViews } from '@/domain/customer-overview';
import { formatEuro } from '@/domain/money';
import { formatIsoDate } from '@/i18n/format';
import { getT, type MessageKey, type Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { CancelApplication } from './cancel-application';
import { ConfirmSignature } from './confirm-signature';
import { CreditBalance } from './credit-balance';
import { BuyLease, ExtendLease } from './lease-purchase';
import { ReturnLease } from './return-lease';
import type {
  CustomerApplication,
  CustomerLease,
  CustomerOverview as Overview,
} from '@/server/features/customer-overview/get-customer-overview';

type Format = {
  t: Translate;
  money: (cents: number) => string;
  date: (isoDate: string) => string;
};

/** The customer's applications and leases, in the table style of Figma's supplier
 *  "My equipment" (29:262). Figma has no customer version of this screen. */
export function CustomerOverview({
  overview,
  view,
  locale,
  extendTerms,
}: {
  overview: Overview;
  view: OverviewView;
  locale: Locale;
  /** The lease terms an ended lease can be extended by, in months. */
  extendTerms: number[];
}) {
  const t = getT(locale);
  const format: Format = {
    t,
    money: (cents) => formatEuro(cents, intlLocale[locale]),
    date: (isoDate) => formatIsoDate(isoDate, locale),
  };
  const { applications, activeLeases, pastLeases } = overview;
  const counts: Record<OverviewView, number> = {
    all: applications.length + activeLeases.length + pastLeases.length,
    applications: applications.length,
    active: activeLeases.length,
    past: pastLeases.length,
  };
  const shows = (group: OverviewView) => view === 'all' || view === group;

  return (
    <div className="application-page account-page">
      <div className="application-heading">
        <h1>{t('account.title')}</h1>
        <p>{t('account.intro')}</p>
      </div>
      {/* Refetch credit after a lease action, such as passing an item on, changes its status. */}
      <CreditBalance
        key={`${overview.customerId}:${[...activeLeases, ...pastLeases]
          .map((lease) => `${lease.id}:${lease.status}`)
          .join(',')}`}
        customerId={overview.customerId}
        locale={locale}
      />
      <nav className="account-views" aria-label={t('account.filter')}>
        {overviewViews
          .filter((option) => option !== 'applications')
          .map((option) => (
            <Link
              key={option}
              href={option === 'all' ? `/${locale}/leases` : `/${locale}/leases?view=${option}`}
              aria-current={option === view ? 'page' : undefined}
            >
              {t(`account.view.${option}`)} <span>{counts[option]}</span>
            </Link>
          ))}
      </nav>
      {counts[view] === 0 ? (
        <div className="application-panel account-empty">
          <p>{t(`account.empty.${view}`)}</p>
          <Link href={`/${locale}`} className="info-button">
            {t('account.browse')}
          </Link>
        </div>
      ) : (
        <table className="account-table">
          <thead>
            <tr>
              <th scope="col">{t('account.column.equipment')}</th>
              <th scope="col">{t('account.column.status')}</th>
              <th scope="col">{t('account.column.rent')}</th>
              <th scope="col">{t('account.column.details')}</th>
              <th scope="col">{t('account.column.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {shows('applications') &&
              applications.map((application) => (
                <ApplicationRow
                  key={application.id}
                  application={application}
                  format={format}
                  locale={locale}
                />
              ))}
            {shows('active') &&
              activeLeases.map((lease) => (
                <LeaseRow
                  key={lease.id}
                  lease={lease}
                  format={format}
                  locale={locale}
                  returnable
                  termOver={lease.termOver}
                  extendTerms={extendTerms}
                  details={
                    lease.status === 'pending_signature' ? (
                      <>
                        <strong>{t('signature.waiting')}</strong>
                        <span>{t('signature.next')}</span>
                      </>
                    ) : (
                      <>
                        <strong>
                          {t(lease.termOver ? 'account.termEnded' : 'account.endsOn', {
                            date: format.date(lease.endDate),
                          })}
                        </strong>
                        {lease.nextInvoice && (
                          <span>
                            {t('account.nextInvoice', {
                              date: format.date(lease.nextInvoice.invoiceDate),
                              amount: format.money(lease.nextInvoice.grossCents),
                            })}
                          </span>
                        )}
                      </>
                    )
                  }
                />
              ))}
            {shows('past') &&
              pastLeases.map((lease) => (
                <LeaseRow
                  key={lease.id}
                  lease={lease}
                  format={format}
                  locale={locale}
                  details={
                    <>
                      <strong>
                        {t('account.startedOn', { date: format.date(lease.startDate) })}
                      </strong>
                      {lease.status === 'extended' && <span>{t('account.extendedNext')}</span>}
                    </>
                  }
                />
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ApplicationRow({
  application,
  format: { t, money, date },
  locale,
}: {
  application: CustomerApplication;
  format: Format;
  locale: Locale;
}) {
  const pending = application.decision === 'pending';
  // Every reason has a message; src/i18n/messages.test.ts checks them.
  const next: MessageKey = pending
    ? 'account.pendingNext'
    : application.decisionReason
      ? (`application.reason.${application.decisionReason}` as MessageKey)
      : 'application.approvedNext';
  return (
    <tr>
      <EquipmentCell item={application} t={t} />
      <StatusCell status={application.decision} t={t} />
      <td>
        <strong>
          {money(application.monthlyRentWithVatCents)} {t('application.perMonthWithVat')}
        </strong>
        <span>{t('estimate.months', { count: application.termMonths })}</span>
      </td>
      <td>
        <strong>{t('account.appliedOn', { date: date(application.appliedOn) })}</strong>
        <span>{t(next)}</span>
      </td>
      <td>
        <div className="account-actions">
          <Link
            href={`/${locale}/applications/${application.id}`}
            className={pending ? 'lease-button' : 'info-button'}
          >
            {t(pending ? 'account.continue' : 'account.viewDecision')}
          </Link>
          {canCancelApplication(application.decision) && (
            <CancelApplication applicationId={application.id} locale={locale} />
          )}
        </div>
      </td>
    </tr>
  );
}

function LeaseRow({
  lease,
  format: { t, money },
  locale,
  returnable = false,
  termOver = false,
  extendTerms = [],
  details,
}: {
  lease: CustomerLease;
  format: Format;
  locale: Locale;
  /** Only a lease that is still running can be returned. */
  returnable?: boolean;
  /** Once the term is over the lease can also be extended, and buying costs the locked buyout. */
  termOver?: boolean;
  extendTerms?: number[];
  details: React.ReactNode;
}) {
  return (
    <tr>
      <EquipmentCell item={lease} t={t} />
      <StatusCell status={lease.status} t={t} />
      <td>
        <strong>
          {money(lease.monthlyNetRentCents)} {t('account.perMonthWithoutVat')}
        </strong>
        <span>{t('estimate.months', { count: lease.termMonths })}</span>
      </td>
      <td>{details}</td>
      <td>
        <div className="account-actions">
          {lease.status === 'pending_signature' ? (
            <ConfirmSignature leaseId={lease.id} locale={locale} />
          ) : (
            <Link href={`/${locale}/leases/${lease.id}/invoices`} className="lease-button">
              {t('account.invoices')}
            </Link>
          )}
          {returnable && lease.status === 'active' && (
            <>
              <BuyLease
                leaseId={lease.id}
                termOver={termOver}
                buyoutCents={lease.buyoutCents}
                locale={locale}
              />
              {termOver && <ExtendLease leaseId={lease.id} terms={extendTerms} locale={locale} />}
              <ReturnLease leaseId={lease.id} locale={locale} />
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function EquipmentCell({
  item,
  t,
}: {
  item: Pick<CustomerLease, 'assetName' | 'category'>;
  t: Translate;
}) {
  return (
    <td>
      <strong>{item.assetName}</strong>
      {item.category && <span>{t(`category.${item.category}`)}</span>}
    </td>
  );
}

function StatusCell({ status, t }: { status: string; t: Translate }) {
  return (
    <td>
      {/* Every status has a message; src/i18n/messages.test.ts checks them. */}
      <span className="account-status" data-status={status}>
        {t(`account.status.${status}` as MessageKey)}
      </span>
    </td>
  );
}
