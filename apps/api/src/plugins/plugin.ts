import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';

const SKIP_OVERRIDE = Symbol.for('skip-override');

/**
 * Marks a Fastify plugin so its decorators and hooks apply to the parent scope
 * (identical to `fastify-plugin`, without adding an external dependency).
 */
export function rootPlugin<
  Options extends FastifyPluginOptions = Record<never, never>,
>(plugin: FastifyPluginAsync<Options>): FastifyPluginAsync<Options> {
  return Object.assign(plugin, { [SKIP_OVERRIDE]: true });
}
