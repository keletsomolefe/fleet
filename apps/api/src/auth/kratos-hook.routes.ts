import { Repository } from '../database/database.js';
import type { FastifyInstance } from 'fastify';
import { BadRequestError, UnauthorizedError } from '../http/errors.js';
import { header } from '../http/request.js';
import { User } from '../users/user.entity.js';
import { secretEqual } from './auth.service.js';

export async function syncKratosLogin(
  users: Repository<User>,
  secret: string | undefined,
  raw: unknown,
  logger: Pick<Console, 'warn'> = console,
) {
  if (
    !process.env.KRATOS_HOOK_SECRET ||
    !secretEqual(secret ?? '', process.env.KRATOS_HOOK_SECRET)
  )
    throw new UnauthorizedError();
  const body = raw as {
    identity?: {
      id?: string;
      traits?: { email?: string; name?: { first?: string; last?: string } };
    };
    authenticated_at?: string;
  } | null;
  const identity = body?.identity;
  const at = new Date(body?.authenticated_at ?? '');
  const traits = identity?.traits;
  if (
    !identity?.id ||
    !/^[0-9a-f-]{36}$/i.test(identity.id) ||
    !Number.isFinite(at.getTime()) ||
    typeof traits?.email !== 'string' ||
    typeof traits.name?.first !== 'string' ||
    typeof traits.name.last !== 'string' ||
    traits.email.length > 320 ||
    traits.name.first.length > 100 ||
    traits.name.last.length > 100
  )
    throw new BadRequestError('Invalid identity event.');
  try {
    // This event can arrive repeatedly or out of order. Never change access or create a user.
    await users
      .createQueryBuilder()
      .update(User)
      .set({
        email: traits.email.trim().toLowerCase(),
        firstName: traits.name.first,
        lastName: traits.name.last,
        lastLoginAt: at,
      })
      .where('"kratosIdentityId" = :id', { id: identity.id })
      .andWhere('("lastLoginAt" IS NULL OR "lastLoginAt" < :at)', { at })
      .execute();
  } catch {
    logger.warn(
      'Login profile synchronization failed; authorization remains enforced on each request.',
    );
  }
}

export function registerKratosHook(
  app: FastifyInstance,
  users: Repository<User>,
) {
  app.post('/internal/kratos/after-login', async (request, reply) => {
    await syncKratosLogin(
      users,
      header(request, 'x-kratos-hook-secret'),
      request.body,
      request.log,
    );
    return reply.code(204).send();
  });
}
