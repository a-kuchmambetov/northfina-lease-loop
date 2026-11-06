// Mirrors src/server/features/return-requests/get-return-requests.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { seedAssets } from '@/server/assets';
import { seedCustomers } from '@/server/customers';
import { signContract } from '@/server/features/contracts/sign-contract';
import { getReturnRequests } from '@/server/features/return-requests/get-return-requests';
import { returnLease } from '@/server/features/return-lease/return-lease';
import { createTestDb } from '../../helpers/test-db';
import type { PrismaClient } from '@/server/prisma-client';

let db: PrismaClient;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  await seedAssets(db, await loadAssets());
  await seedCustomers(db, await loadCustomers());
});
afterAll(async () => {
  await cleanup();
});
beforeEach(async () => {
  await db.invoice.deleteMany();
  await db.contract.deleteMany();
  await db.auditLog.deleteMany();
  await db.asset.updateMany({
    data: { status: 'available', condition: 'new', usage_value: 0, lifetime_usage_value: 0 },
  });
});

async function lease(assetId: string, signDate = '2026-11-05') {
  const signed = await signContract(db, {
    assetId,
    customerId: 'cust-aino',
    termMonths: 36,
    downPaymentCents: 0,
    signDate,
  });
  if (!signed.ok) throw new Error(signed.reason);
  return signed.contract;
}
const giveBack = (contractId: string, asOfDate: string) =>
  returnLease(db, { contractId, customerId: 'cust-aino', asOfDate, confirm: true });

describe('getReturnRequests', () => {
  it('is empty while nothing has been returned', async () => {
    await lease('ebike-003');

    expect(await getReturnRequests(db)).toEqual([]);
  });

  it('lists a returned lease with its equipment, renter and how it came back', async () => {
    const contract = await lease('ebike-003');
    await giveBack(contract.id, '2027-06-05');

    const [request, ...others] = await getReturnRequests(db);

    expect(others).toEqual([]);
    expect(request).toMatchObject({
      contractId: contract.id,
      category: 'e_bike',
      renter: 'Aino Virtanen',
      startDate: '2026-11-05',
      termMonths: 36,
      kind: 'early',
    });
    expect(request!.assetName).not.toBe('ebike-003');
    expect(request!.returnedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('tells an end-of-term return from an early one', async () => {
    const early = await lease('ebike-003');
    const atEnd = await lease('ebike-004');
    await giveBack(early.id, '2027-06-05');
    await giveBack(atEnd.id, '2029-11-05');

    const kinds = Object.fromEntries(
      (await getReturnRequests(db)).map((request) => [request.contractId, request.kind])
    );
    expect(kinds).toEqual({ [early.id]: 'early', [atEnd.id]: 'end_of_term' });
  });

  it('names the renter after the name typed at signing when there is one', async () => {
    const contract = await lease('ebike-003');
    await db.contract.update({ where: { id: contract.id }, data: { signed_name: 'Artem K.' } });
    await giveBack(contract.id, '2027-06-05');

    expect((await getReturnRequests(db))[0]).toMatchObject({ renter: 'Artem K.' });
  });

  it('leaves out leases that are still running or were bought', async () => {
    await lease('ebike-003');
    const bought = await lease('ebike-004');
    await db.contract.update({ where: { id: bought.id }, data: { status: 'bought' } });

    expect(await getReturnRequests(db)).toEqual([]);
  });

  it('keeps a returned lease that has no audit row, and lists it last', async () => {
    const recorded = await lease('ebike-003');
    await giveBack(recorded.id, '2027-06-05');
    const unrecorded = await lease('ebike-004');
    await db.contract.update({ where: { id: unrecorded.id }, data: { status: 'returned' } });

    const requests = await getReturnRequests(db);

    expect(requests.map((request) => request.contractId)).toEqual([recorded.id, unrecorded.id]);
    expect(requests[1]).toMatchObject({ returnedOn: null, kind: null });
  });
});
