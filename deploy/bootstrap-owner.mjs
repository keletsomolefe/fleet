// Use the API's own TypeORM dependency and compiled entities.
const { default: db } =
  await import("../apps/api/dist/database/data-source.js");
const { User } = await import("../apps/api/dist/users/user.entity.js");
const { Role, UserRole } = await import("../apps/api/dist/rbac/rbac.entity.js");
const email = process.env.INITIAL_OWNER_EMAIL?.trim().toLowerCase();
const password = process.env.INITIAL_OWNER_PASSWORD;
if (!email || !password || password.length < 16)
  throw new Error("Initial owner credentials are missing or too short.");
const kratos = async (path, options = {}) => {
  const r = await fetch(new URL(path, process.env.KRATOS_ADMIN_URL), {
    ...options,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok)
    throw new Error(`Initial owner identity operation failed (${r.status}).`);
  return r.status === 204 ? null : r.json();
};
let created;
await db.initialize();
try {
  await db.transaction(async (m) => {
    await m.query(
      "SELECT pg_advisory_xact_lock(hashtext('fleet-initial-owner-v1'))",
    );
    const owner = await m.findOneByOrFail(Role, { key: "owner" });
    if (await m.existsBy(UserRole, { roleId: owner.id })) {
      console.log(
        "Owner already configured; credentials and access unchanged.",
      );
      return;
    }
    if (await m.existsBy(User, { email }))
      throw new Error("Refusing to replace an existing application account.");
    const identities = await kratos(
      `admin/identities?credentials_identifier=${encodeURIComponent(email)}`,
    );
    let identity = identities.find(
      (i) => i.traits.email.toLowerCase() === email,
    );
    if (
      identity &&
      identity.metadata_admin?.bootstrap !== "fleet-initial-owner-v1"
    )
      throw new Error("Refusing to adopt an unrelated identity.");
    if (!identity) {
      identity = await kratos("admin/identities", {
        method: "POST",
        body: JSON.stringify({
          schema_id: "fleet-user-v1",
          state: "active",
          traits: {
            email,
            name: {
              first: process.env.INITIAL_OWNER_FIRST_NAME || "Fleet",
              last: process.env.INITIAL_OWNER_LAST_NAME || "Owner",
            },
          },
          metadata_admin: { bootstrap: "fleet-initial-owner-v1" },
          credentials: { password: { config: { password } } },
          verifiable_addresses: [
            {
              value: email,
              via: "email",
              verified: true,
              status: "completed",
              verified_at: new Date().toISOString(),
            },
          ],
        }),
      });
      created = identity.id;
    }
    const user = await m.save(
      User,
      m.create(User, {
        kratosIdentityId: identity.id,
        email,
        firstName: identity.traits.name.first,
        lastName: identity.traits.name.last,
        isActive: true,
        createdById: null,
      }),
    );
    await m.insert(UserRole, { userId: user.id, roleId: owner.id });
    console.log("Initial Fleet owner configured.");
  });
} catch (e) {
  if (created)
    await kratos(`admin/identities/${created}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  throw e;
} finally {
  await db.destroy();
}
