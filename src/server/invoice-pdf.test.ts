import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildInvoiceDocument, type InvoiceDocumentInput } from '@/domain/invoice-document';
import { getT } from '@/i18n/get-t';
import { locales } from '@/i18n/locales';
import { printable, renderInvoicePdf } from './invoice-pdf';

const input: InvoiceDocumentInput = {
  contractId: '3f2a9c1d-0000-4000-8000-000000000000',
  sequenceNumber: 7,
  kind: 'rent',
  termMonths: 36,
  contractStartDate: '2026-11-05',
  assetName: 'Trek FX 2',
  customerName: 'Åsa Öberg',
  invoiceDate: '2027-05-05',
  paymentDeadline: '2027-05-19',
  netCents: 10_730,
  vatRatePercent: 26,
  vatCents: 2_790,
  grossCents: 13_520,
  status: 'issued',
  paidOn: null,
};

function documentOf(overrides: Partial<InvoiceDocumentInput> = {}) {
  const result = buildInvoiceDocument({ ...input, ...overrides });
  if (!result.ok) throw new Error(result.reason);
  return result.document;
}

const header = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 5));

describe('renderInvoicePdf', () => {
  it.each(locales)('makes a one-page PDF in %s', async (locale) => {
    const bytes = await renderInvoicePdf(documentOf(), getT(locale), locale);

    expect(header(bytes)).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe(`${getT(locale)('invoicePdf.title')} 3F2A9C1D-007`);
  });

  it('makes a paid invoice too', async () => {
    const bytes = await renderInvoicePdf(
      documentOf({ status: 'paid', paidOn: '2027-05-06' }),
      getT('en'),
      'en'
    );
    expect(header(bytes)).toBe('%PDF-');
  });

  it('makes a fee invoice, an expired invoice and a cancelled one', async () => {
    for (const overrides of [
      { kind: 'early_return_fee' as const, sequenceNumber: 37 },
      { status: 'expired' as const },
      { status: 'cancelled' as const },
    ]) {
      for (const locale of locales) {
        const bytes = await renderInvoicePdf(documentOf(overrides), getT(locale), locale);
        expect(header(bytes)).toBe('%PDF-');
      }
    }
  });

  it('gives the same bytes for the same invoice', async () => {
    const [first, second] = await Promise.all([
      renderInvoicePdf(documentOf(), getT('fi'), 'fi'),
      renderInvoicePdf(documentOf(), getT('fi'), 'fi'),
    ]);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it('differs between two invoices', async () => {
    const [first, second] = await Promise.all([
      renderInvoicePdf(documentOf(), getT('en'), 'en'),
      renderInvoicePdf(documentOf({ sequenceNumber: 8 }), getT('en'), 'en'),
    ]);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
  });

  it('does not fail on a name in another alphabet or a very long one', async () => {
    for (const customerName of ['Анна Иванова', '山田 太郎', '😀', 'x'.repeat(300)]) {
      const bytes = await renderInvoicePdf(documentOf({ customerName }), getT('en'), 'en');
      expect(header(bytes)).toBe('%PDF-');
    }
  });
});

describe('printable', () => {
  it('keeps what the font can draw and replaces what it cannot', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    expect(printable(font, 'Åsa Öberg, Õie, Šnitt €')).toBe('Åsa Öberg, Õie, Šnitt €');
    expect(printable(font, 'Анна')).toBe('????');
    expect(printable(font, 'a😀b')).toBe('a?b');
  });

  it('turns the spaces and minus signs of locales into plain ones', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    expect(printable(font, '135,20 €')).toBe('135,20 €');
    expect(printable(font, '1 000−')).toBe('1 000-');
  });
});
