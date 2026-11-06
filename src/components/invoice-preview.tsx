'use client';

import { useState } from 'react';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';
import { CatalogueDialog } from './catalogue-dialog';

/** Shows an invoice's PDF in a dialog, using the browser's own PDF viewer. The file is only
 *  fetched once the dialog is opened. */
export function InvoicePreview({
  invoiceId,
  number,
  locale,
}: {
  invoiceId: string;
  number: string;
  locale: Locale;
}) {
  const t = getT(locale);
  const [open, setOpen] = useState(false);
  const file = `/api/invoices/${invoiceId}/pdf?locale=${locale}`;

  return (
    <>
      <button type="button" className="lease-button" onClick={() => setOpen(true)}>
        {t('invoicePdf.preview')}
      </button>
      {open && (
        <CatalogueDialog
          title={t('invoicePdf.previewTitle', { number })}
          closeLabel={t('catalogue.close')}
          onClose={() => setOpen(false)}
          className="pdf-dialog"
        >
          {/* Browsers without a built-in PDF viewer (most phones) show the fallback instead. */}
          <object
            data={`${file}&disposition=inline`}
            type="application/pdf"
            className="invoice-preview"
            aria-label={t('invoicePdf.previewTitle', { number })}
          >
            <div className="invoice-preview-fallback">
              <p>{t('invoicePdf.previewFallback')}</p>
              <a href={file} className="lease-button" download>
                {t('invoicePdf.download')}
              </a>
            </div>
          </object>
        </CatalogueDialog>
      )}
    </>
  );
}
