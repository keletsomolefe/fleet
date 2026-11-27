import { type MikroORM, RequestContext } from '@mikro-orm/postgresql';
import { rootPlugin } from './plugin.js';

declare module 'fastify' {
  interface FastifyInstance {
    orm: MikroORM;
  }
}

export interface MikroOrmPluginOptions {
  orm: MikroORM;
}

/**
 * Registers MikroORM with the Fastify lifecycle:
 * - Decorates `fastify.orm` on the root instance
 * - Opens an isolated `RequestContext` per HTTP request (`allowGlobalContext: false`)
 * - Closes the connection pool cleanly in `onClose`
 */
export const mikroOrmPlugin = rootPlugin<MikroOrmPluginOptions>(
  async (app, { orm }) => {
    app.decorate('orm', orm);

    app.addHook('onRequest', (_request, _reply, done) => {
      RequestContext.create(orm.em, done);
    });

    app.addHook('onClose', async () => {
      await orm.close(true);
    });
  },
);
