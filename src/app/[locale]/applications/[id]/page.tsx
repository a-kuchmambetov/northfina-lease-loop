// One application: the question to answer now, or the decision once there is one.
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ApplicationDecision } from '@/components/application-decision';
import { ApplicationQuestion } from '@/components/application-question';
import { ApplicationSummary } from '@/components/application-summary';
import { CancelApplication } from '@/components/cancel-application';
import { SignContract } from '@/components/sign-contract';
import { canCancelApplication } from '@/domain/application-cancellation';
import { canFormContract } from '@/domain/application-contract';
import { leaseAccess } from '@/domain/catalogue';
import { formatEuro } from '@/domain/money';
import { getT } from '@/i18n/get-t';
import { intlLocale, isLocale } from '@/i18n/locales';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { getApplicationFlow } from '@/server/features/application/get-application-flow';

export default async function ApplicationPage({
  params,
  searchParams,
}: PageProps<'/[locale]/applications/[id]'>) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();

  const session = await getAuth().api.getSession({
    headers: await headers(),
    query: { disableRefresh: true },
  });
  const access = leaseAccess(session?.user.accountType);
  if (access === 'guest') redirect(`/${locale}/login`);
  if (access !== 'customer') redirect(`/${locale}`);

  const { question: requested } = await searchParams;
  const result = await getApplicationFlow(
    db,
    id,
    typeof requested === 'string' ? requested : undefined
  );
  if (!result.ok) notFound();

  const { application, asset, question, previousQuestionId, progress } = result.flow;
  const t = getT(locale);

  return (
    <div className="application-page">
      <Link href={`/${locale}`} className="application-back">
        ← {t('application.backToEquipment')}
      </Link>
      <div className="application-heading">
        <h1>{t(question ? 'application.title' : 'application.decidedTitle')}</h1>
        {question && <p>{t('application.intro')}</p>}
      </div>
      <div className="application-columns">
        {question ? (
          <ApplicationQuestion
            key={question.id}
            applicationId={application.id}
            locale={locale}
            question={{
              id: question.id,
              type: question.type,
              text: question.text[locale],
              why: question.why_we_ask[locale] ?? question.why_we_ask.en,
              options: question.options,
              isBusinessId: question.validation?.format === 'finnish_business_id',
            }}
            answer={application.answers[question.id]}
            contactDefault={
              question.id === 'q_full_name'
                ? session?.user.name
                : question.id === 'q_email'
                  ? session?.user.email
                  : undefined
            }
            previousQuestionId={previousQuestionId}
            progress={progress}
            canCancel={canCancelApplication(application.decision)}
          />
        ) : (
          <ApplicationDecision
            decision={application.decision}
            reason={application.decisionReason}
            locale={locale}
          >
            {canFormContract(application.decision) && (
              <SignContract
                applicationId={application.id}
                locale={locale}
                item={`${asset.make} ${asset.model}`}
                termMonths={application.termMonths}
                rent={formatEuro(application.monthlyRentWithVatCents, intlLocale[locale])}
              />
            )}
          </ApplicationDecision>
        )}
        <ApplicationSummary application={application} asset={asset} locale={locale} />
      </div>
      {!question && canCancelApplication(application.decision) && (
        <CancelApplication applicationId={application.id} locale={locale} />
      )}
    </div>
  );
}
