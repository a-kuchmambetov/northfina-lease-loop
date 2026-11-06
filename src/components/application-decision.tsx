import Link from 'next/link';
import type { ReactNode } from 'react';
import { getT, type MessageKey } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';

/** The application's outcome, with the reason in plain words. */
export function ApplicationDecision({
  decision,
  reason,
  locale,
  children,
}: {
  decision: string;
  reason: string | null;
  locale: Locale;
  /** What to do next, shown above the way back (e.g. the button that forms the contract). */
  children?: ReactNode;
}) {
  const t = getT(locale);
  return (
    <section className="application-panel application-decision" data-decision={decision}>
      {/* Every decision and reason has a message; src/i18n/messages.test.ts checks them. */}
      <h2 tabIndex={-1}>{t(`application.decision.${decision}` as MessageKey)}</h2>
      <p role="status">
        {t(reason ? (`application.reason.${reason}` as MessageKey) : 'application.approvedNext')}
      </p>
      <div className="application-actions application-decision-actions">
        {children}
        {decision === 'signed' && (
          <Link href={`/${locale}/leases?view=active`} className="lease-button">
            {t('application.viewLeases')}
          </Link>
        )}
        <Link href={`/${locale}`} className="info-button">
          {t('application.backToEquipment')}
        </Link>
      </div>
    </section>
  );
}
