// Orchestration for comparing every lease term side by side (CHALLENGE.md Smart Problem
// #6, "Explain my price": "Compare options side by side (24 months vs 36 months)"). No
// business rules live here — see src/domain/pricing.ts for those; this just quotes the
// same asset/down payment at every term the coefficient table offers.
import { loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import { listPriceOn, type ListPriceResult } from '@/domain/price-list';
import { quoteMonthlyRent, type PriceQuote } from '@/domain/pricing';

export type GetPriceQuoteComparisonInput = {
  assetId: string;
  downPaymentCents: number;
  /** `YYYY-MM-DD`. The caller decides what "today" is (see src/server/today.ts). */
  quoteDate: string;
};

type ListPriceFailureReason = Extract<ListPriceResult, { ok: false }>['reason'];

export type TermQuote =
  | { termMonths: number; ok: true; quote: PriceQuote }
  | { termMonths: number; ok: false; reason: string };

export type GetPriceQuoteComparisonResult =
  | { ok: true; priceListVersion: number; quotes: TermQuote[] }
  | { ok: false; reason: ListPriceFailureReason };

export async function getPriceQuoteComparison(
  input: GetPriceQuoteComparisonInput
): Promise<GetPriceQuoteComparisonResult> {
  const [priceLists, coefficientTable, vatRates] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
  ]);

  const listPrice = listPriceOn(priceLists, input.assetId, input.quoteDate);
  if (!listPrice.ok) return listPrice;

  // Every band offers the same set of terms (data/coefficient-table.json); reading them
  // off the table instead of hard-coding [12, 24, 36, 48] keeps this in step with it.
  const terms = Object.keys(coefficientTable.bands[0]!.monthly_factor_by_term)
    .map(Number)
    .sort((a, b) => a - b);

  const quotes: TermQuote[] = terms.map((termMonths) => {
    const result = quoteMonthlyRent(coefficientTable, vatRates, {
      listPriceCents: listPrice.priceCents,
      downPaymentCents: input.downPaymentCents,
      termMonths,
      quoteDate: input.quoteDate,
    });
    return result.ok
      ? { termMonths, ok: true, quote: result.quote }
      : { termMonths, ok: false, reason: result.reason };
  });

  return { ok: true, priceListVersion: listPrice.priceListVersion, quotes };
}
