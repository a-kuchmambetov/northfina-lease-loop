// POST /api/applications/:id/answers — answer one application question (CHALLENGE.md
// Spine #3 / Smart Problem #4). Returns the next question, or the final decision once
// nothing is left to ask. Body: { questionId, answer, answerDate? }
import { z } from 'zod';
import { isoDateSchema } from '@/data/schemas';
import { fail, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { answerApplicationQuestion } from '@/server/features/application/answer-application-question';
import { todayIso } from '@/server/today';

const bodySchema = z.strictObject({
  questionId: z.string().min(1),
  answer: z.union([z.string(), z.number(), z.array(z.string())]),
  answerDate: isoDateSchema.optional(),
});

const NOT_FOUND_REASONS = new Set(['unknown_application']);

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/applications/[id]/answers'>) => {
    const { id } = await params;
    const body = await readJsonBody(request, bodySchema);

    const result = await answerApplicationQuestion(db, {
      applicationId: id,
      questionId: body.questionId,
      answer: body.answer,
      answerDate: body.answerDate ?? todayIso(),
    });

    if (!result.ok) {
      const status = NOT_FOUND_REASONS.has(result.reason) ? 404 : 422;
      const details = result.reason === 'invalid_answer_format' ? { hint: result.hint } : undefined;
      return fail(status, result.reason.toUpperCase(), 'The answer could not be recorded', details);
    }
    if (result.status === 'in_progress') {
      return ok({ status: result.status, nextQuestion: result.nextQuestion ?? null });
    }
    return ok({ status: result.status, decision: result.decision });
  }
);
