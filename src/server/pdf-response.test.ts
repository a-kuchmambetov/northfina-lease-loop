import { describe, expect, it } from 'vitest';
import { pdfDisposition, pdfResponse } from './pdf-response';

describe('pdfDisposition', () => {
  it('shows the file in the page only when asked to', () => {
    expect(pdfDisposition('inline')).toBe('inline');
  });

  it.each([null, '', 'attachment', 'INLINE', 'nope'])('downloads for %j', (value) => {
    expect(pdfDisposition(value)).toBe('attachment');
  });
});

describe('pdfResponse', () => {
  const bytes = new TextEncoder().encode('%PDF-1.7 test');

  it('sends the bytes as a private PDF', async () => {
    const response = pdfResponse(bytes, 'invoice-ABC-001.pdf', 'inline');

    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it.each(['inline', 'attachment'] as const)('names the file when it is %s', (disposition) => {
    const response = pdfResponse(bytes, 'invoice-ABC-001.pdf', disposition);

    expect(response.headers.get('Content-Disposition')).toBe(
      `${disposition}; filename="invoice-ABC-001.pdf"`
    );
  });
});
