// Draws an invoice (src/domain/invoice-document.ts) as a one-page A4 PDF. This is layout
// only: every figure comes from the document as given, and every word from the locale's
// messages. The standard Helvetica fonts are built into PDF readers, so no font files
// are needed; they cover Finnish, Swedish and Estonian letters and the euro sign.
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { InvoiceDocument } from '@/domain/invoice-document';
import { formatEuro } from '@/domain/money';
import { formatIsoDate, formatNumber } from '@/i18n/format';
import type { MessageKey, Translate } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const RIGHT = PAGE.width - MARGIN;
const INK = rgb(0.1, 0.11, 0.13);
const MUTED = rgb(0.4, 0.43, 0.48);
const LINE = rgb(0.85, 0.86, 0.88);
const HEADER_FILL = rgb(0.95, 0.96, 0.97);
const PAID = rgb(0.09, 0.5, 0.27);
const EXPIRED = rgb(0.75, 0.2, 0.17);

type Fonts = { regular: PDFFont; bold: PDFFont };

/** The text as the standard fonts can draw it: spaces and minus signs that locales use
 *  become plain ones, and any letter the font has no glyph for (a name typed in another
 *  alphabet) becomes "?" instead of making the whole PDF fail. */
export function printable(font: PDFFont, text: string): string {
  const drawable = new Set(font.getCharacterSet());
  // `\s` also matches the no-break and narrow spaces that locales put in amounts.
  return [...text.replace(/\s+/g, ' ').replace(/\u2212/g, '-')]
    .map((character) => (drawable.has(character.codePointAt(0)!) ? character : '?'))
    .join('');
}

export async function renderInvoicePdf(
  invoice: InvoiceDocument,
  t: Translate,
  locale: Locale
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const page = pdf.addPage([PAGE.width, PAGE.height]);
  const money = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const date = (isoDate: string) => formatIsoDate(isoDate, locale);
  const rate = formatNumber(invoice.vatRatePercent, locale);

  const draw = (
    text: string,
    x: number,
    y: number,
    options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; right?: boolean } = {}
  ) => {
    const font = options.bold ? fonts.bold : fonts.regular;
    const size = options.size ?? 10;
    const safe = printable(font, text);
    page.drawText(safe, {
      x: options.right ? x - font.widthOfTextAtSize(safe, size) : x,
      y,
      size,
      font,
      color: options.color ?? INK,
    });
  };
  const rule = (y: number, color = LINE) =>
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: RIGHT, y },
      thickness: 0.75,
      color,
    });

  // Header
  draw(t('nav.brand'), MARGIN, 780, { size: 20, bold: true });
  draw(t('invoicePdf.title').toUpperCase(), RIGHT, 780, { size: 20, bold: true, right: true });
  rule(762);

  // Billed to (left) and the invoice's details (right)
  draw(t('invoicePdf.billedTo'), MARGIN, 735, { size: 8, color: MUTED });
  draw(invoice.customerName, MARGIN, 719, { size: 12, bold: true });
  const details: [MessageKey, string][] = [
    ['invoicePdf.number', invoice.number],
    ['invoices.column.invoiceDate', date(invoice.invoiceDate)],
    ['invoices.column.dueDate', date(invoice.paymentDeadline)],
    ['account.column.status', t(`invoices.status.${invoice.status}` as MessageKey)],
  ];
  details.forEach(([label, value], index) => {
    const y = 735 - index * 16;
    draw(t(label), 330, y, { size: 9, color: MUTED });
    draw(value, RIGHT, y, { size: 10, bold: true, right: true });
  });

  // The lease the invoice belongs to
  draw(t('invoicePdf.lease'), MARGIN, 665, { size: 8, color: MUTED });
  draw(
    t('invoicePdf.leaseValue', { item: invoice.assetName, date: date(invoice.contractStartDate) }),
    MARGIN,
    650,
    { size: 10 }
  );

  // Table: one row, because an invoice is one month's rent.
  // The amount before VAT is rent on a rent invoice and the fee on a fee invoice.
  const netLabel = t(
    invoice.kind === 'early_return_fee' ? 'invoicePdf.feeNet' : 'invoices.column.net'
  );
  const columns = { net: 372, vat: 460, total: RIGHT } as const;
  page.drawRectangle({
    x: MARGIN,
    y: 600,
    width: RIGHT - MARGIN,
    height: 24,
    color: HEADER_FILL,
  });
  draw(t('invoicePdf.description'), MARGIN + 8, 608, { size: 9, bold: true });
  draw(netLabel, columns.net, 608, { size: 9, bold: true, right: true });
  draw(t('invoices.column.vat'), columns.vat, 608, { size: 9, bold: true, right: true });
  draw(t('invoices.column.total'), columns.total - 8, 608, { size: 9, bold: true, right: true });

  draw(
    invoice.kind === 'early_return_fee'
      ? t('invoicePdf.feeDescription')
      : t('invoicePdf.rent', { number: invoice.sequenceNumber, months: invoice.termMonths }),
    MARGIN + 8,
    578,
    { size: 10 }
  );
  draw(invoice.assetName, MARGIN + 8, 564, { size: 8.5, color: MUTED });
  draw(money(invoice.netCents), columns.net, 578, { right: true });
  draw(money(invoice.vatCents), columns.vat, 578, { right: true });
  draw(t('invoices.vatRate', { rate }), columns.vat, 564, { size: 8.5, color: MUTED, right: true });
  draw(money(invoice.grossCents), columns.total - 8, 578, { right: true });
  rule(548);

  // Totals
  const totals: [string, string][] = [
    [netLabel, money(invoice.netCents)],
    [t('invoicePdf.vatLabel', { rate }), money(invoice.vatCents)],
  ];
  totals.forEach(([label, value], index) => {
    const y = 522 - index * 16;
    draw(label, 330, y, { size: 9.5, color: MUTED });
    draw(value, RIGHT - 8, y, { size: 10, right: true });
  });
  rule(486, INK);
  draw(t('invoicePdf.totalDue'), 330, 466, { size: 12, bold: true });
  draw(money(invoice.grossCents), RIGHT - 8, 466, { size: 14, bold: true, right: true });

  if (invoice.status === 'paid' && invoice.paidOn) {
    drawStamp(
      page,
      fonts,
      t('invoices.status.paid'),
      PAID,
      t('invoicePdf.paidOn', { date: date(invoice.paidOn) })
    );
  } else if (invoice.status === 'cancelled') {
    drawStamp(page, fonts, t('invoices.status.cancelled'), MUTED, t('invoicePdf.cancelledNote'));
  } else if (invoice.status === 'expired') {
    drawStamp(
      page,
      fonts,
      t('invoices.status.expired'),
      EXPIRED,
      t('invoicePdf.expiredNote', { date: date(invoice.paymentDeadline) })
    );
  }

  // Why the total can differ from one rent invoice to the next while the rent is locked, or
  // what a fee invoice is for.
  const note = invoice.kind === 'early_return_fee' ? 'invoicePdf.feeNote' : 'invoicePdf.vatNote';
  wrap(printable(fonts.regular, t(note)), fonts.regular, 9, RIGHT - MARGIN).forEach((line, index) =>
    draw(line, MARGIN, 96 - index * 13, { size: 9, color: MUTED })
  );

  // Fixed dates (the invoice date), so the same invoice always produces the same bytes.
  const created = new Date(`${invoice.invoiceDate}T00:00:00Z`);
  pdf.setTitle(`${t('invoicePdf.title')} ${invoice.number}`);
  pdf.setAuthor(t('nav.brand'));
  pdf.setCreator(t('nav.brand'));
  pdf.setProducer(t('nav.brand'));
  pdf.setLanguage(locale);
  pdf.setCreationDate(created);
  pdf.setModificationDate(created);
  return pdf.save();
}

/** A bordered label under the invoice's details, with a line of explanation below it. */
function drawStamp(
  page: PDFPage,
  fonts: Fonts,
  text: string,
  color: ReturnType<typeof rgb>,
  caption: string
) {
  const label = printable(fonts.bold, text.toUpperCase());
  const width = fonts.bold.widthOfTextAtSize(label, 16) + 24;
  page.drawRectangle({
    x: MARGIN,
    y: 434,
    width,
    height: 34,
    borderColor: color,
    borderWidth: 1.5,
  });
  page.drawText(label, { x: MARGIN + 12, y: 446, size: 16, font: fonts.bold, color });
  page.drawText(printable(fonts.regular, caption), {
    x: MARGIN,
    y: 418,
    size: 9,
    font: fonts.regular,
    color: MUTED,
  });
}

/** Breaks `text` into lines no wider than `maxWidth`, at spaces. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const next = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}
