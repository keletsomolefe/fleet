import type { DataSource } from 'typeorm';
import { KratosService } from '../auth/kratos.service.js';
import { User } from '../users/user.entity.js';

export const repairAuditEmail = 'whatsapp-repairs@fleet.invalid';
const marker = 'fleet-whatsapp-repair-audit-v1';
// This disabled, credential-free identity records automation in the existing FK.
// It has no role grants and cannot sign in. Actual mechanic attribution is in the receipt.
export async function configureRepairAudit(db: DataSource) {
  const kratos = new KratosService();
  await db.transaction(async (m) => {
    await m.query(
      "SELECT pg_advisory_xact_lock(hashtext('fleet-repair-audit-v1'))",
    );
    const existing = await m.findOneBy(User, { email: repairAuditEmail });
    type Identity = {
      id: string;
      state: string;
      metadata_admin?: { purpose?: string };
      traits: { email: string };
    };
    let identity: Identity | undefined;
    if (existing) {
      identity = await kratos.request<Identity>(
        `admin/identities/${existing.kratosIdentityId}`,
        {},
        true,
      );
      if (
        existing.isActive ||
        identity.state !== 'inactive' ||
        identity.metadata_admin?.purpose !== marker
      )
        throw new Error('Repair audit identity must remain disabled.');
      return;
    }
    const matches = await kratos.request<Identity[]>(
      `admin/identities?credentials_identifier=${encodeURIComponent(repairAuditEmail)}`,
      {},
      true,
    );
    identity = matches.find((i) => i.traits.email === repairAuditEmail);
    if (
      identity &&
      (identity.state !== 'inactive' ||
        identity.metadata_admin?.purpose !== marker)
    )
      throw new Error('Refusing to reuse an unrelated repair audit identity.');
    if (!identity)
      identity = (await kratos.createIdentity({
        schema_id: 'fleet-user-v1',
        state: 'inactive',
        traits: {
          email: repairAuditEmail,
          name: { first: 'WhatsApp', last: 'repairs' },
        },
        metadata_admin: { purpose: marker },
      })) as Identity;
    await m.save(
      User,
      m.create(User, {
        kratosIdentityId: identity.id,
        email: repairAuditEmail,
        firstName: 'WhatsApp',
        lastName: 'repairs',
        isActive: false,
      }),
    );
  });
}
