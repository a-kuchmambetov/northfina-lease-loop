// The HTTP response for a PDF file: shown in the page (`inline`, for the preview) or saved
// by the browser (`attachment`, for the download button).

export type PdfDisposition = 'inline' | 'attachment';

/** Reads a `?disposition=` value. Anything but `inline` means a download. */
export function pdfDisposition(value: string | null): PdfDisposition {
  return value === 'inline' ? 'inline' : 'attachment';
}

/** `filename` must be plain ASCII without quotes (an invoice number is). */
export function pdfResponse(
  bytes: Uint8Array,
  filename: string,
  disposition: PdfDisposition
): Response {
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      // A document is personal: never kept by a shared cache.
      'Cache-Control': 'private, no-store',
    },
  });
}
