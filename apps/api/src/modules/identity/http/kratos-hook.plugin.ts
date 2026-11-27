import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { FastifyPluginAsync } from 'fastify';
import { getEm } from '../../../database/context.js';
import { BadRequestError, UnauthorizedError } from '../../../shared/errors.js';
import { header } from '../../../shared/http.js';
import { secretEqual } from '../../../shared/identifiers.js';
import { User } from '../domain/user.entity.js';

export async function syncKratosLogin(
  em: Pick<EntityManager, 'nativeUpdate'>,
  secret: string | undefined,
  raw: unknown,
  logger: Pick<Console, 'warn'> = console,
) {
  if (
    !process.env.KRATOS_HOOK_SECRET ||
    !secretEqual(secret ?? '', process.env.KRATOS_HOOK_SECRET)
  ) {
    throw new UnauthorizedError();
  }
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
  ) {
    throw new BadRequestError('Invalid identity event.');
  }
  try {
    // This event can arrive repeatedly or out of order. Never change access or create a user.
    await em.nativeUpdate(
      User,
      {
        kratosIdentityId: identity.id,
        $or: [{ lastLoginAt: null }, { lastLoginAt: { $lt: at } }],
      },
      {
        email: traits.email.trim().toLowerCase(),
        firstName: traits.name.first,
        lastName: traits.name.last,
        lastLoginAt: at,
      },
    );
  } catch {
    logger.warn(
      'Login profile synchronization failed; authorization remains enforced on each request.',
    );
  }
}

export interface KratosHookPluginOptions {
  orm: MikroORM;
}

export const kratosHookPlugin: FastifyPluginAsync<KratosHookPluginOptions> =
  async (app, { orm }) => {
    app.post('/internal/kratos/after-login', async (request, reply) => {
      await syncKratosLogin(
        getEm(orm),
        header(request, 'x-kratos-hook-secret'),
        request.body,
        request.log,
      );
      return reply.code(204).send();
    });
  };
