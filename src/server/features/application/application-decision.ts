// Shared by starting and answering an application: reaching a decision from the collected
// answers, and storing it. No business rules live here — they are src/domain/eligibility.ts's.
import type { CoefficientTable, Customer } from '@/data/schemas';
import {
  applicantFromAnswers,
  resolveEligibility,
  type EligibilityResult,
} from '@/domain/eligibility';
import type { Answers } from '@/domain/question-flow';
import { withAudit } from '@/server/audit';
import type { PrismaClient } from '@/generated/prisma/client';

export type DecideApplicationInput = {
  customerType: Customer['type'];
  answers: Answers;
  coefficientTable: CoefficientTable;
  /** `YYYY-MM-DD`, the `min_age` check's reference date. */
  decisionDate: string;
  financedAmountCents: number;
  termMonths: number;
  monthlyRentWithVatCents: number;
};

/** The final decision once nothing is left to ask. */
export function decideApplication(input: DecideApplicationInput): EligibilityResult {
  return resolveEligibility({
    customer: applicantFromAnswers(input.customerType, input.answers),
    coefficientTable: input.coefficientTable,
    contractStartDate: input.decisionDate,
    financedAmountCents: input.financedAmountCents,
    termMonths: input.termMonths,
    monthlyRentWithVatCents:
      'q_monthly_income' in input.answers ? input.monthlyRentWithVatCents : undefined,
  });
}

export async function persistDecision(
  db: PrismaClient,
  applicationId: string,
  answers: Answers,
  decision: EligibilityResult
): Promise<void> {
  await withAudit(
    db,
    {
      actor: 'customer',
      action: 'application.decided',
      entityType: 'application',
      entityId: applicationId,
      details: decision,
    },
    (tx) =>
      tx.application.update({
        where: { id: applicationId },
        data: {
          answers_json: JSON.stringify(answers),
          decision: decision.decision,
          decision_reason: 'reason' in decision ? decision.reason : null,
          decided_at: new Date(),
        },
      })
  );
}
