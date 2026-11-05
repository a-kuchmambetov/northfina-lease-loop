import { AsyncLocalStorage } from 'node:async_hooks';

// Better Auth intentionally catches logout deletion errors. Our boundary must
// still report failure and retain cookies when the audited deletion rolls back.
export const authOperation = new AsyncLocalStorage<{ error?: unknown; path?: string }>();
export async function trackAuthFailure<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const operation = authOperation.getStore();
    if (operation) operation.error = error;
    throw error;
  }
}
