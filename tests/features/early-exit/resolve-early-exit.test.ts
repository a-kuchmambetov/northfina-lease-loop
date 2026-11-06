// Mirrors src/server/features/early-exit/resolve-early-exit.ts — see AGENTS.md and
// src/server/README.md for why tests for src/server/features/** live here.
// Runs against the real data pack and a real, migrated SQLite database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAssets, loadCustomers } from '@/data/load';
import { resolveContractEarlyExit } from '@/server/features/early-exit/resolve-early-exit';
import { signContract } from '@/server/features/contracts/sign-contract';
import { issueDueInvoices } from '@/server/features/contracts/issue-invoices';
import { seedAssets } from '@/server/assets';
import { seedCustomers } from '@/server/customers';
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
// Each test signs the same asset from scratch — a prior test's own signing or wear
// assessment must not carry over into the next one.
beforeEach(async () => {
  await db.asset.updateMany({
    data: { status: 'available', condition: 'new', usage_value: 0, lifetime_usage_value: 0 },
  });
});

// Scenario card 8: Aino leases ebike-003, 36 months, no down payment, signed 5 Nov 2026,
// ends the lease in month 7.
async function signAinosContract() {
  const signed = await signContract(db, {
    assetId: 'ebike-003',
    customerId: 'cust-aino',
    termMonths: 36,
    downPaymentCents: 0,
    signDate: '2026-11-05',
  });
  if (!signed.ok) throw new Error('setup: signing failed');
  return signed.contract;
}

describe('resolveContractEarlyExit', () => {
  it("rejects early exit on a leap-day lease's clamped end date", async () => {
    const signed = await signContract(db, {
      assetId: 'laptop-001',
      customerId: 'cust-aino',
      termMonths: 24,
      downPaymentCents: 0,
      signDate: '2028-02-29',
    });
    if (!signed.ok) throw new Error('setup: signing failed');
    const auditBefore = await db.auditLog.count();

    expect(
      await resolveContractEarlyExit(db, {
        contractId: signed.contract.id,
        action: 'buy',
        asOfDate: '2030-02-28',
      })
    ).toEqual({ ok: false, reason: 'term_already_over' });
    expect(await db.auditLog.count()).toBe(auditBefore);
  });

  it('buys out month 7 of 36 for less than the full financed amount, more than the end-of-term buyout', async () => {
    const contract = await signAinosContract();

    const result = await resolveContractEarlyExit(db, {
      contractId: contract.id,
      action: 'buy',
      asOfDate: '2027-06-05', // 7 months after signing
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'bought_early') throw new Error('expected a buy result');
    expect(result.amountCents).toBeLessThan(contract.financedCents);
    expect(result.amountCents).toBeGreaterThan(contract.buyoutCents);

    const row = await db.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(row.status).toBe('bought');

    const asset = await db.asset.findUniqueOrThrow({ where: { id: contract.assetId } });
    expect(asset.status).toBe('sold'); // leaves the fleet for good
  });

  it('returns month 7 of 36 for a fee, and frees the asset', async () => {
    const contract = await signAinosContract();

    const result = await resolveContractEarlyExit(db, {
      contractId: contract.id,
      action: 'return',
      asOfDate: '2027-06-05',
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'returned_early')
      throw new Error('expected a return result');
    expect(result.feeCents).toBeGreaterThan(0);

    const row = await db.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(row.status).toBe('returned');
    const asset = await db.asset.findUniqueOrThrow({ where: { id: contract.assetId } });
    expect(asset.status).toBe('returned');
    // Only 7 months of wear, not the full 36 — 400 km/month x 7 = 2800, still under the
    // 3000 km "new" ceiling.
    expect(asset.usage_value).toBe(2_800);
    expect(asset.lifetime_usage_value).toBe(2_800);
    expect(asset.condition).toBe('new');
  });

  it('prices the return fee off the wear this lease actually added, not the pre-lease baseline', async () => {
    const contract = await signAinosContract();

    const result = await resolveContractEarlyExit(db, {
      contractId: contract.id,
      action: 'return',
      asOfDate: '2028-11-05', // 24 months in: 9600 km, crosses into 'good'
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== 'returned_early')
      throw new Error('expected a return result');
    // Computed with the wear-adjusted residual value at both ends (see
    // src/server/features/early-exit/resolve-early-exit.ts): condition 'good', 9600 km.
    expect(result.feeCents).toBe(96_700);

    const asset = await db.asset.findUniqueOrThrow({ where: { id: contract.assetId } });
    expect(asset.usage_value).toBe(9_600);
    expect(asset.lifetime_usage_value).toBe(9_600);
    expect(asset.condition).toBe('good');
  });

  it('rejects an early exit once the term is actually over', async () => {
    const contract = await signAinosContract();

    const result = await resolveContractEarlyExit(db, {
      contractId: contract.id,
      action: 'buy',
      asOfDate: '2029-11-05', // the exact natural end of a 36-month term
    });
    expect(result).toEqual({ ok: false, reason: 'term_already_over' });
  });

  it('rejects exiting a contract that is already settled', async () => {
    const contract = await signAinosContract();
    await resolveContractEarlyExit(db, {
      contractId: contract.id,
      action: 'buy',
      asOfDate: '2027-06-05',
    });

    const result = await resolveContractEarlyExit(db, {
      contractId: contract.id,
      action: 'return',
      asOfDate: '2027-07-05',
    });
    expect(result).toEqual({ ok: false, reason: 'contract_already_settled' });
  });

  it('rejects a contract that is still waiting on a named signatory (scenario card 6)', async () => {
    const pending = await db.contract.create({
      data: {
        id: 'pending-contract-early-exit',
        asset_id: 'ebike-003',
        customer_id: 'cust-norvi',
        start_date: '2026-11-05',
        term_months: 36,
        price_list_version: 1,
        list_price_cents: 389_000,
        down_payment_cents: 0,
        financed_cents: 389_000,
        monthly_net_rent_cents: 10_730,
        buyout_cents: 58_350,
        status: 'pending_signature',
        pending_signatory_email: 'someone@norvi.example.com',
      },
    });
    const result = await resolveContractEarlyExit(db, {
      contractId: pending.id,
      action: 'buy',
      asOfDate: '2027-06-05',
    });
    expect(result).toEqual({ ok: false, reason: 'contract_pending_signature' });
  });

  it('reports a contract that does not exist', async () => {
    const result = await resolveContractEarlyExit(db, {
      contractId: 'nope',
      action: 'buy',
      asOfDate: '2026-12-05',
    });
    expect(result).toEqual({ ok: false, reason: 'contract_not_found' });
  });

  it('stops issuing new invoices once a contract exits early', async () => {
    const contract = await signAinosContract();
    await resolveContractEarlyExit(db, {
      contractId: contract.id,
      action: 'return',
      asOfDate: '2027-06-05',
    });

    const invoices = await issueDueInvoices(db, contract.id, '2028-01-05');
    expect(invoices.ok).toBe(true);
    if (!invoices.ok) return;
    // Only rent invoice #1 (issued at signing) exists — nothing was ever issued for the
    // other invoice dates between signing and the exit, and the exit itself stops any more.
    // The fee invoice is not a rent invoice.
    expect(invoices.invoices.filter((invoice) => invoice.kind === 'rent')).toHaveLength(1);
  });

  it.each(['buy', 'return'] as const)(
    'quotes a %s without changing anything when asked for a dry run',
    async (action) => {
      const contract = await signAinosContract();
      const auditBefore = await db.auditLog.count();

      const quote = await resolveContractEarlyExit(db, {
        contractId: contract.id,
        action,
        asOfDate: '2027-06-05',
        dryRun: true,
      });
      expect(quote.ok).toBe(true);

      expect((await db.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
        'active'
      );
      expect((await db.asset.findUniqueOrThrow({ where: { id: contract.assetId } })).status).toBe(
        'reserved'
      );
      expect(await db.auditLog.count()).toBe(auditBefore);
      expect(await db.invoice.count({ where: { contract_id: contract.id } })).toBe(1);

      // The real thing then costs exactly what was quoted.
      const real = await resolveContractEarlyExit(db, {
        contractId: contract.id,
        action,
        asOfDate: '2027-06-05',
      });
      expect(real).toEqual(quote);
    }
  );

  describe('the invoice for the early-return fee', () => {
    async function returnEarly(asOfDate: string) {
      const contract = await signAinosContract();
      const result = await resolveContractEarlyExit(db, {
        contractId: contract.id,
        action: 'return',
        asOfDate,
      });
      if (!result.ok || result.outcome !== 'returned_early') throw new Error('setup: no return');
      return { contract, result };
    }
    const feeRows = (contractId: string) =>
      db.invoice.findMany({ where: { contract_id: contractId, kind: 'early_return_fee' } });

    it('is issued with the fee as net rent, VAT of the return day and the usual payment term', async () => {
      const { contract, result } = await returnEarly('2027-06-05');
      expect(result.feeCents).toBeGreaterThan(0);

      const [fee, ...others] = await feeRows(contract.id);
      expect(others).toEqual([]);
      expect(fee).toMatchObject({
        // After the last rent invoice of the 36-month term, so it can't collide with one.
        sequence_number: 37,
        invoice_date: '2027-06-05',
        payment_deadline: '2027-06-19',
        net_cents: result.feeCents,
        vat_rate_percent: 26,
        status: 'issued',
      });
      expect(fee!.vat_cents).toBe(Math.round((result.feeCents * 26) / 100));
      expect(fee!.gross_cents).toBe(fee!.net_cents + fee!.vat_cents);
      expect(result.feeInvoice).toMatchObject({
        netCents: fee!.net_cents,
        grossCents: fee!.gross_cents,
      });
    });

    it('uses the VAT rate of the day the item is returned', async () => {
      const { contract } = await returnEarly('2026-12-05'); // 25.5 % until 31 Dec 2026
      expect((await feeRows(contract.id))[0]).toMatchObject({ vat_rate_percent: 25.5 });
    });

    it('is written with the return, and its id is in the audit row', async () => {
      const { contract } = await returnEarly('2027-06-05');
      const [fee] = await feeRows(contract.id);

      const audit = await db.auditLog.findMany({
        where: { entity_id: contract.id, action: 'contract.returned_early' },
      });
      expect(audit).toHaveLength(1);
      expect(JSON.parse(audit[0]!.details_json!)).toMatchObject({ feeInvoiceId: fee!.id });
    });

    it('is not written for a quote, and a refused return writes nothing', async () => {
      const contract = await signAinosContract();
      await resolveContractEarlyExit(db, {
        contractId: contract.id,
        action: 'return',
        asOfDate: '2027-06-05',
        dryRun: true,
      });
      expect(await feeRows(contract.id)).toEqual([]);

      await resolveContractEarlyExit(db, {
        contractId: contract.id,
        action: 'return',
        asOfDate: '2029-11-05', // the term is over: not an early exit
      });
      expect(await feeRows(contract.id)).toEqual([]);
    });

    it('is not issued for a second return of the same lease', async () => {
      const { contract } = await returnEarly('2027-06-05');
      await resolveContractEarlyExit(db, {
        contractId: contract.id,
        action: 'return',
        asOfDate: '2027-06-06',
      });
      expect(await feeRows(contract.id)).toHaveLength(1);
    });

    it('is not issued for an early buy', async () => {
      const contract = await signAinosContract();
      await resolveContractEarlyExit(db, {
        contractId: contract.id,
        action: 'buy',
        asOfDate: '2027-06-05',
      });
      expect(await feeRows(contract.id)).toEqual([]);
    });
  });

  describe('the unpaid invoice of the month in progress', () => {
    // The fee charges the rent for the months still to run, the month in progress included,
    // so an unpaid invoice for one of those months must not be charged a second time.
    const statuses = async (contractId: string) =>
      Object.fromEntries(
        (
          await db.invoice.findMany({
            where: { contract_id: contractId, kind: 'rent' },
            orderBy: { sequence_number: 'asc' },
          })
        ).map((invoice) => [invoice.sequence_number, invoice.status])
      );

    it('is cancelled by an early return with a fee, and the audit row names it', async () => {
      const contract = await signAinosContract();
      const first = await db.invoice.findFirstOrThrow({ where: { contract_id: contract.id } });

      const result = await resolveContractEarlyExit(db, {
        contractId: contract.id,
        action: 'return',
        asOfDate: '2026-11-20', // 0 months used: invoice 1 is the month in progress
      });

      expect(result).toMatchObject({
        ok: true,
        feeInvoice: expect.anything(),
        cancelledInvoices: [{ id: first.id, sequenceNumber: 1, grossCents: first.gross_cents }],
      });
      expect(await statuses(contract.id)).toEqual({ 1: 'cancelled' });
      const audit = await db.auditLog.findFirstOrThrow({
        where: { entity_id: contract.id, action: 'contract.returned_early' },
      });
      expect(JSON.parse(audit.details_json!)).toMatchObject({ cancelledInvoiceIds: [first.id] });
    });

    it('cancels only the month in progress, and leaves the months already used payable', async () => {
      const contract = await signAinosContract();
      // The sweep has issued every invoice due by the return: 1 to 8 (7 months used).
      await issueDueInvoices(db, contract.id, '2027-06-05');

      await resolveContractEarlyExit(db, {
        contractId: contract.id,
        action: 'return',
        asOfDate: '2027-06-05',
      });

      expect(await statuses(contract.id)).toEqual({
        1: 'issued',
        2: 'issued',
        3: 'issued',
        4: 'issued',
        5: 'issued',
        6: 'issued',
        7: 'issued',
        8: 'cancelled',
      });
    });

    it('is not cancelled when it has already been paid', async () => {
      const contract = await signAinosContract();
      const first = await db.invoice.findFirstOrThrow({ where: { contract_id: contract.id } });
      await db.invoice.update({ where: { id: first.id }, data: { status: 'paid' } });

      const result = await resolveContractEarlyExit(db, {
        contractId: contract.id,
        action: 'return',
        asOfDate: '2026-11-20',
      });

      expect(result).toMatchObject({ ok: true, cancelledInvoices: [] });
      expect(await statuses(contract.id)).toEqual({ 1: 'paid' });
    });

    it('is not cancelled by a quote, nor by an early buy', async () => {
      const quoted = await signAinosContract();
      const quote = await resolveContractEarlyExit(db, {
        contractId: quoted.id,
        action: 'return',
        asOfDate: '2026-11-20',
        dryRun: true,
      });
      expect(quote).toMatchObject({ ok: true, cancelledInvoices: [{ sequenceNumber: 1 }] });
      expect(await statuses(quoted.id)).toEqual({ 1: 'issued' });

      await db.asset.updateMany({ data: { status: 'available' } });
      const bought = await signAinosContract();
      await resolveContractEarlyExit(db, {
        contractId: bought.id,
        action: 'buy',
        asOfDate: '2026-11-20',
      });
      expect(await statuses(bought.id)).toEqual({ 1: 'issued' });
    });

    it('is cancelled together with the creation of the fee invoice, never one without the other', async () => {
      const contract = await signAinosContract();
      await resolveContractEarlyExit(db, {
        contractId: contract.id,
        action: 'return',
        asOfDate: '2026-11-20',
      });

      expect(
        await db.invoice.count({ where: { contract_id: contract.id, kind: 'early_return_fee' } })
      ).toBe(1);
      expect(await statuses(contract.id)).toEqual({ 1: 'cancelled' });
    });
  });

  describe('a consumer withdrawing within 14 days of signing', () => {
    // cust-aino is a consumer; signAinosContract signs on 2026-11-05.
    it('is free on the day of signing, with no fee invoice', async () => {
      const contract = await signAinosContract();

      const result = await resolveContractEarlyExit(db, {
        contractId: contract.id,
        action: 'return',
        asOfDate: '2026-11-05',
      });

      expect(result).toMatchObject({ ok: true, outcome: 'returned_early', feeCents: 0 });
      if (!result.ok || result.outcome !== 'returned_early') return;
      expect(result.feeInvoice).toBeNull();
      expect(
        await db.invoice.count({ where: { contract_id: contract.id, kind: 'early_return_fee' } })
      ).toBe(0);
    });

    it('is still free on day 14, and cancels the unpaid invoice of the month in progress', async () => {
      const contract = await signAinosContract();
      const first = await db.invoice.findFirstOrThrow({ where: { contract_id: contract.id } });

      const result = await resolveContractEarlyExit(db, {
        contractId: contract.id,
        action: 'return',
        asOfDate: '2026-11-19', // 14 days after 2026-11-05
      });

      expect(result).toMatchObject({ ok: true, feeCents: 0 });
      expect((await db.invoice.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(
        'cancelled'
      );
    });

    it('charges the ordinary early-exit fee from day 15 onward', async () => {
      const contract = await signAinosContract();

      const result = await resolveContractEarlyExit(db, {
        contractId: contract.id,
        action: 'return',
        asOfDate: '2026-11-20', // 15 days after 2026-11-05
      });

      expect(result.ok).toBe(true);
      if (!result.ok || result.outcome !== 'returned_early') return;
      expect(result.feeCents).toBeGreaterThan(0);
    });

    it('does not apply to a business customer (sole_trader/company)', async () => {
      const signed = await signContract(db, {
        assetId: 'ebike-003',
        customerId: 'cust-norvi', // company
        termMonths: 36,
        downPaymentCents: 0,
        signDate: '2026-11-05',
      });
      if (!signed.ok) throw new Error('setup: signing failed');

      const result = await resolveContractEarlyExit(db, {
        contractId: signed.contract.id,
        action: 'return',
        asOfDate: '2026-11-05', // same day as signing
      });

      expect(result.ok).toBe(true);
      if (!result.ok || result.outcome !== 'returned_early') return;
      expect(result.feeCents).toBeGreaterThan(0);
    });
  });
});
