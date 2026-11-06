'use client';

import { useEffect, useState } from 'react';

export type ApiQueryState<T> =
  { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error'; code: string };

type Settled<T> = { url: string; state: Exclude<ApiQueryState<T>, { status: 'loading' }> };

/**
 * GETs an API route (`src/app/api`, response shape `{ success, data | error }`) and keeps
 * the answer for that exact `url`. Changing `url` shows `loading` until the new answer
 * arrives, and an answer to an older `url` is never shown. Pass `null` to not fetch yet.
 * `delayMs` waits before fetching, so a slider being dragged sends one request, not many.
 */
export function useApiQuery<T>(url: string | null, delayMs = 0): ApiQueryState<T> {
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        const body = await response.json();
        setSettled({
          url,
          state: body.success
            ? { status: 'ok', data: body.data as T }
            : { status: 'error', code: String(body.error?.code ?? 'UNKNOWN') },
        });
      } catch {
        if (!controller.signal.aborted)
          setSettled({ url, state: { status: 'error', code: 'NETWORK' } });
      }
    }, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [url, delayMs]);

  return url && settled?.url === url ? settled.state : { status: 'loading' };
}
