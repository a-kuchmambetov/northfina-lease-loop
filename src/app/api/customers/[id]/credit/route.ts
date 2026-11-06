// GET /api/customers/:id/credit — a customer's current credit balance
// (src/server/customer-credit.ts), e.g. earned from a pass_on bonus.
import { ok, handleRoute } from '@/server/api-response';
import { db } from '@/server/db';
import { getCustomerCreditBalanceCents } from '@/server/customer-credit';

export const GET = handleRoute(
  async (_request, { params }: RouteContext<'/api/customers/[id]/credit'>) => {
    const { id } = await params;
    const balanceCents = await getCustomerCreditBalanceCents(db, id);
    return ok({ customerId: id, balanceCents });
  }
);
