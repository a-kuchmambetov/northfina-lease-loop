'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getT } from '@/i18n/get-t';
import type { Locale } from '@/i18n/locales';

/** Holds an item back from the catalogue ("reserved") or puts it back on offer ("available"),
 *  with `PATCH /api/assets/:id/status`. The supplier's name is recorded as the actor. */
export function AssetStatusToggle({
  assetId,
  reserved,
  actor,
  locale,
}: {
  assetId: string;
  reserved: boolean;
  actor: string;
  locale: Locale;
}) {
  const t = getT(locale);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function change() {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/assets/${assetId}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: reserved ? 'available' : 'reserved', actor }),
      });
      const result = await response.json();
      if (!result.success) throw new Error();
      router.refresh();
    } catch {
      setFailed(true);
    }
    setPending(false);
  }

  return (
    <>
      <button
        type="button"
        className="supplier-action"
        disabled={pending}
        onClick={() => void change()}
      >
        {t(reserved ? 'assetStatus.release' : 'assetStatus.reserve')}
      </button>
      {failed && (
        <span role="alert" className="application-error">
          {t('assetStatus.failed')}
        </span>
      )}
    </>
  );
}
