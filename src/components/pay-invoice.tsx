'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';

/** Pays an issued invoice (`POST /api/invoices/:id/pay`), then reloads the page's data. */
export function PayInvoice({ invoiceId, locale }: { invoiceId: string; locale: Locale }) {
  const t = getT(locale);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function pay() {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pay`, { method: 'POST' });
      const result = await response.json();
      if (!result.success) throw new Error();
      router.refresh();
    } catch {
      setFailed(true);
      // The invoice may have been paid or cancelled meanwhile, so show what it is now.
      router.refresh();
    }
    setPending(false);
  }

  return (
    <>
      <button type="button" className="lease-button" disabled={pending} onClick={() => void pay()}>
        {t(pending ? 'pay.paying' : 'pay.button')}
      </button>
      {failed && (
        <span role="alert" className="application-error">
          {t('pay.failed')}
        </span>
      )}
    </>
  );
}
