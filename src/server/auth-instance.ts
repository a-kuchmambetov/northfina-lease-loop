import { createAuth } from './auth';
import { db } from './db';

let instance: ReturnType<typeof createAuth> | undefined;
// Validate deployment configuration on first use, not during static build.
export function getAuth() {
  return (instance ??= createAuth(db));
}
