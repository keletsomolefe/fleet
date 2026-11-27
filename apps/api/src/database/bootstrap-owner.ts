import { Role, UserRole } from '../modules/identity/domain/rbac.entity.js';
import { User } from '../modules/identity/domain/user.entity.js';
import { acquireAdvisoryLock } from './context.js';
import { withMaintenanceOrm } from './orm.js';

const marker = 'fleet-initial-owner-v1';

async function kratos<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(new URL(path, process.env.KRATOS_ADMIN_URL), {
    ...options,
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `Initial owner identity operation failed (${response.status}).`,
    );
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

/**
 * Bootstraps the first Fleet owner identity in a fresh deployment.
 * Idempotent: does nothing when an owner already exists. Never resets data.
 */
export async function bootstrapInitialOwner(): Promise<void> {
  const email = process.env.INITIAL_OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_OWNER_PASSWORD;
  if (!email || !password || password.length < 16) {
    throw new Error('Initial owner credentials are missing or too short.');
  }

  let created: string | undefined;
  try {
    await withMaintenanceOrm(async (orm) => {
      await orm.em.fork().transactional(async (tx) => {
        await acquireAdvisoryLock(tx, 'fleet-initial-owner-v1');
        const owner = await tx.findOneOrFail(Role, { key: 'owner' });
        if ((await tx.count(UserRole, { role: owner.id })) > 0) {
          console.log(
            'Owner already configured; credentials and access unchanged.',
          );
          return;
        }
        if ((await tx.count(User, { email })) > 0) {
          throw new Error(
            'Refusing to replace an existing application account.',
          );
        }

        const identities = await kratos<
          Array<{
            id: string;
            metadata_admin?: { bootstrap?: string };
            traits: { email: string; name: { first: string; last: string } };
          }>
        >(`admin/identities?credentials_identifier=${encodeURIComponent(email)}`);
        let identity = identities.find(
          (item) => item.traits.email.toLowerCase() === email,
        );
        if (identity && identity.metadata_admin?.bootstrap !== marker) {
          throw new Error('Refusing to adopt an unrelated identity.');
        }
        if (!identity) {
          identity = await kratos<{
            id: string;
            metadata_admin?: { bootstrap?: string };
            traits: { email: string; name: { first: string; last: string } };
          }>('admin/identities', {
            method: 'POST',
            body: JSON.stringify({
              schema_id: 'fleet-user-v1',
              state: 'active',
              traits: {
                email,
                name: {
                  first: process.env.INITIAL_OWNER_FIRST_NAME || 'Fleet',
                  last: process.env.INITIAL_OWNER_LAST_NAME || 'Owner',
                },
              },
              metadata_admin: { bootstrap: marker },
              credentials: { password: { config: { password } } },
              verifiable_addresses: [
                {
                  value: email,
                  via: 'email',
                  verified: true,
                  status: 'completed',
                  verified_at: new Date().toISOString(),
                },
              ],
            }),
          });
          created = identity.id;
        }

        const user = tx.create(User, {
          kratosIdentityId: identity.id,
          email,
          firstName: identity.traits.name.first,
          lastName: identity.traits.name.last,
          isActive: true,
          createdBy: null,
          lastLoginAt: null,
        });
        await tx.persist(user).flush();
        await tx.insert(UserRole, { user: user.id, role: owner.id });
        console.log('Initial Fleet owner configured.');
      });
    });
  } catch (error) {
    if (created) {
      await kratos(`admin/identities/${created}`, { method: 'DELETE' }).catch(
        () => undefined,
      );
    }
    throw error;
  }
}
