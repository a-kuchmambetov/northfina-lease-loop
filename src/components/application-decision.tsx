import Link from 'next/link';
import { getT, type MessageKey } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';

/** The application's outcome, with the reason in plain words. */
export function ApplicationDecision({
  decision,
  reason,
  locale,
}: {
  decision: string;
  reason: string | null;
  locale: Locale;
}) {
  const t = getT(locale);
  return (
    <section className="application-panel application-decision" data-decision={decision}>
      {/* Every decision and reason has a message; src/i18n/messages.test.ts checks them. */}
      <h2 tabIndex={-1}>{t(`application.decision.${decision}` as MessageKey)}</h2>
      <p role="status">
        {t(reason ? (`application.reason.${reason}` as MessageKey) : 'application.approvedNext')}
      </p>
      <Link href={`/${locale}`} className="info-button">
        {t('application.backToEquipment')}
      </Link>
    </section>
  );
}
