// Orchestration for the catalogue price step (CHALLENGE.md, Spine #2): loads the data pack
// and turns an asset + term + down payment choice into a live price quote. No business
// rules live here — see src/domain/pricing.ts for those; this file only wires data to them.
import { loadCoefficientTable, loadPriceLists, loadVatRates } from '@/data/load';
import { listPriceOn, type ListPriceResult } from '@/domain/price-list';
import { quoteMonthlyRent, type PriceQuote, type PriceQuoteResult } from '@/domain/pricing';

export type GetPriceQuoteInput = {
  assetId: string;
  termMonths: number;
  downPaymentCents: number;
  /** `YYYY-MM-DD`. The caller decides what "today" is (see src/server/today.ts). */
  quoteDate: string;
};

type PriceQuoteFailureReason = Extract<PriceQuoteResult, { ok: false }>['reason'];
type ListPriceFailureReason = Extract<ListPriceResult, { ok: false }>['reason'];

export type GetPriceQuoteResult =
  | { ok: true; quote: PriceQuote & { priceListVersion: number } }
  | { ok: false; reason: PriceQuoteFailureReason | ListPriceFailureReason };

export async function getPriceQuote(input: GetPriceQuoteInput): Promise<GetPriceQuoteResult> {
  const [priceLists, coefficientTable, vatRates] = await Promise.all([
    loadPriceLists(),
    loadCoefficientTable(),
    loadVatRates(),
  ]);

  const listPrice = listPriceOn(priceLists, input.assetId, input.quoteDate);
  if (!listPrice.ok) return listPrice;

  const result = quoteMonthlyRent(coefficientTable, vatRates, {
    listPriceCents: listPrice.priceCents,
    downPaymentCents: input.downPaymentCents,
    termMonths: input.termMonths,
    quoteDate: input.quoteDate,
  });
  if (!result.ok) return result;

  return { ok: true, quote: { ...result.quote, priceListVersion: listPrice.priceListVersion } };
}
