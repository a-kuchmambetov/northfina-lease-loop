// Orchestration for a customer's account page: their applications and their contracts, with
// the equipment's name and where each active lease stands (src/domain/customer-overview.ts).
// Read-only: it works from the projected invoice schedule, unlike
// contracts/get-invoices.ts, which issues whatever is due. No business rules live here.
import { loadAssets, loadVatRates } from '@/data/load';
import type { Asset } from '@/data/schemas';
import { leaseGroup, leaseSchedule, type LeaseSchedule } from '@/domain/customer-overview';
import type { PrismaClient } from '@/generated/prisma/client';
import { todayIso } from '@/server/today';

type Equipment = { assetName: string; category: Asset['category'] | null };

export type CustomerApplication = Equipment & {
  id: string;
  decision: string;
  decisionReason: string | null;
  termMonths: number;
  monthlyRentWithVatCents: number;
  /** `YYYY-MM-DD`, in Finnish time like every other date the customer sees. */
  appliedOn: string;
};

export type CustomerLease = Equipment & {
  id: string;
  status: string;
  startDate: string;
  termMonths: number;
  monthlyNetRentCents: number;
  /** What buying the item costs at the end of the term, excl. VAT. */
  buyoutCents: number;
};

export type CustomerOverview = {
  customerId: string;
  applications: CustomerApplication[];
  activeLeases: (CustomerLease & LeaseSchedule)[];
  pastLeases: CustomerLease[];
};

export async function getCustomerOverview(
  db: PrismaClient,
  customerId: string,
  today: string
): Promise<CustomerOverview> {
  const [applications, contracts, assets, vatRates] = await Promise.all([
    db.application.findMany({
      where: { customer_id: customerId },
      orderBy: { created_at: 'desc' },
    }),
    db.contract.findMany({
      where: { customer_id: customerId },
      orderBy: [{ start_date: 'desc' }, { signed_at: 'desc' }],
    }),
    loadAssets(),
    loadVatRates(),
  ]);

  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  // A row stays on the page even if its asset has left the data pack: it is still the
  // customer's application or lease.
  function equipment(assetId: string): Equipment {
    const asset = assetsById.get(assetId);
    return asset
      ? { assetName: `${asset.make} ${asset.model}`, category: asset.category }
      : { assetName: assetId, category: null };
  }

  const leases = contracts.map((contract) => ({
    ...equipment(contract.asset_id),
    id: contract.id,
    status: contract.status,
    startDate: contract.start_date,
    termMonths: contract.term_months,
    monthlyNetRentCents: contract.monthly_net_rent_cents,
    buyoutCents: contract.buyout_cents,
  }));

  return {
    customerId,
    applications: applications.map((application) => ({
      ...equipment(application.asset_id),
      id: application.id,
      decision: application.decision,
      decisionReason: application.decision_reason,
      termMonths: application.term_months,
      monthlyRentWithVatCents: application.monthly_rent_with_vat_cents,
      appliedOn: todayIso(application.created_at),
    })),
    activeLeases: leases
      .filter((lease) => leaseGroup(lease.status) === 'active')
      .map((lease) => ({
        ...lease,
        ...leaseSchedule(vatRates, toSchedule(lease), today, lease.status),
      })),
    pastLeases: leases.filter((lease) => leaseGroup(lease.status) === 'past'),
  };
}

function toSchedule({ startDate, termMonths, monthlyNetRentCents }: CustomerLease) {
  return { startDate, termMonths, monthlyNetRentCents };
}
