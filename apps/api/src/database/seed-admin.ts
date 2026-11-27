import { Role, UserRole } from '../modules/identity/domain/rbac.entity.js';
import { User } from '../modules/identity/domain/user.entity.js';
import { KratosService } from '../modules/identity/infrastructure/kratos.service.js';
import { acquireAdvisoryLock } from './context.js';
import { withMaintenanceOrm } from './orm.js';

const marker = 'fleet-development-admin-v1';

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development admin bootstrap is disabled in production.');
  }
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD in the root .env.',
    );
  }
  const first = process.env.BOOTSTRAP_ADMIN_FIRST_NAME || 'Patrick';
  const last = process.env.BOOTSTRAP_ADMIN_LAST_NAME || 'Keletso';

  await withMaintenanceOrm(async (orm) => {
    await orm.em.fork().transactional(async (tx) => {
      await acquireAdvisoryLock(tx, 'fleet-development-admin-v1');
      const kratos = new KratosService();
      const identities = await kratos.request<
        Array<{
          id: string;
          metadata_admin?: { bootstrap?: string };
          traits: { email: string };
        }>
      >(
        `admin/identities?credentials_identifier=${encodeURIComponent(email)}`,
        {},
        true,
      );
      let identity = identities.find(
        (i) => i.traits.email.toLowerCase() === email,
      );
      const existing = await tx.findOne(User, { email });
      if (identity && identity.metadata_admin?.bootstrap !== marker) {
        throw new Error(
          'Refusing to adopt an unrelated identity with the bootstrap email.',
        );
      }
      if (existing) {
        if (!identity || existing.kratosIdentityId !== identity.id) {
          throw new Error('Bootstrap identity and local account do not match.');
        }
        console.log(
          'Default administrator already exists; credentials and access were not changed.',
        );
        return;
      }
      if (!identity) {
        identity = await kratos.createIdentity({
          schema_id: 'fleet-user-v1',
          state: 'active',
          traits: { email, name: { first, last } },
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
        });
      }
      const user = tx.create(User, {
        kratosIdentityId: identity.id,
        email,
        firstName: first,
        lastName: last,
        isActive: true,
        createdBy: null,
        lastLoginAt: null,
      });
      await tx.persist(user).flush();
      const owner = await tx.findOneOrFail(Role, { key: 'owner' });
      await tx.insert(UserRole, { user: user.id, role: owner.id });
      console.log('Default administrator is ready.');
    });
  });
}

seed().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Administrator bootstrap failed.',
  );
  process.exitCode = 1;
});
