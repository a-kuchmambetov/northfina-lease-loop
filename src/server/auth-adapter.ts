import { authOperation, trackAuthFailure } from './auth-operation';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { withAudit, type AuditEntry } from './audit';
import type { PrismaClient } from './prisma-client';

// SQLite has one writer. Queue before opening a transaction, so waiting does
// not consume Prisma's transaction timeout while another signup hashes.
let pending: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = pending.then(work, work);
  pending = result.catch(() => {});
  return trackAuthFailure(() => result);
}

export function auditedAuthAdapter(db: PrismaClient) {
  const factory = prismaAdapter(db, { provider: 'sqlite' });
  return ((options) => {
    const adapter = factory(options);
    type Adapter = typeof adapter;
    const mutations = new Set(['create', 'update', 'delete', 'deleteMany', 'updateMany']);
    function wrap(target: Adapter, entry?: AuditEntry): Adapter {
      return new Proxy(target, {
        get(target, property, receiver) {
          if (property === 'transaction') {
            return (callback: Parameters<Adapter['transaction']>[0]) =>
              serialize(() => {
                const audit: AuditEntry = { actor: '', action: '', entityType: '', entityId: '' };
                return withAudit(db, audit, (tx) =>
                  callback(wrap(prismaAdapter(tx, { provider: 'sqlite' })(options), audit))
                );
              });
          }
          if (typeof property === 'string' && mutations.has(property)) {
            return (input: { model: string; where?: unknown }) => {
              if (property === 'deleteMany' || property === 'updateMany')
                return trackAuthFailure(async () => {
                  throw new Error('Bulk auth mutations are unsupported');
                });
              const work = async (transactional: Adapter, audit: AuditEntry) => {
                const method = Reflect.get(transactional, property) as (
                  arg: typeof input
                ) => Promise<unknown>;
                const previous = input.where
                  ? await transactional.findOne(input as Parameters<Adapter['findOne']>[0])
                  : null;
                const result = await method(input);
                const row = (
                  property === 'delete' || property === 'deleteMany' ? previous : result
                ) as { id?: string; userId?: string; expiresAt?: Date } | null;
                if (!row?.id) throw new Error('Missing auth audit identity');
                // Signup is one atomic user/account/session change. Retain the
                // user identity when subsequent account and session writes occur.
                if (audit.action !== 'auth.signup') {
                  audit.actor = row.userId ?? row.id;
                  audit.entityType = input.model;
                  audit.entityId = row.id;
                  audit.action =
                    input.model === 'user' && property === 'create'
                      ? 'auth.signup'
                      : input.model === 'session' && property === 'create'
                        ? 'auth.login'
                        : input.model === 'session' && property.startsWith('delete')
                          ? authOperation.getStore()?.path === 'sign-out'
                            ? 'auth.logout'
                            : row.expiresAt && row.expiresAt.getTime() <= Date.now()
                              ? 'auth.session_expired'
                              : 'auth.session_deleted'
                          : `auth.${input.model}.${property}`;
                }
                if (
                  audit.action === 'auth.session_expired' ||
                  audit.action === 'auth.session_deleted'
                )
                  audit.actor = 'system';
                return result;
              };
              if (entry) return work(target, entry);
              return serialize(() => {
                const audit: AuditEntry = { actor: '', action: '', entityType: '', entityId: '' };
                return withAudit(db, audit, (tx) =>
                  work(prismaAdapter(tx, { provider: 'sqlite' })(options), audit)
                );
              });
            };
          }
          const value = Reflect.get(target, property, receiver);
          if (typeof value === 'function')
            return (...args: unknown[]) => trackAuthFailure(() => value.apply(target, args));
          return value;
        },
      });
    }
    return wrap(adapter);
  }) satisfies typeof factory;
}
