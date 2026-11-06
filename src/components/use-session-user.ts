'use client';

import { useEffect, useState } from 'react';

export type SessionUser = { name: string; accountType?: string };

/** The signed-in user, or `null` for a guest, once the session has loaded. `undefined`
 *  until then, and also if it could not be loaded: a link that depends on the account type
 *  stays hidden rather than guessing. */
export function useSessionUser(): SessionUser | null | undefined {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/get-session', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((result) => {
        if (!result.success) throw new Error();
        if (active) setUser(result.data?.user ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return user;
}
