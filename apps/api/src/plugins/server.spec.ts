import type { MikroORM } from '@mikro-orm/postgresql';
import { createApi } from '../app.js';

function stubOrm(): MikroORM {
  const em = {
    fork: vi.fn(),
    findOne: vi.fn().mockResolvedValue(null),
  };
  em.fork.mockReturnValue(em);
  return {
    em,
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as MikroORM;
}

describe('Fastify API plugin boundaries & schema validation', () => {
  it('enforces auth scopes, private cache headers, and Fastify JSON Schema UUID params', async () => {
    const { app } = await createApi({ orm: stubOrm() });
    try {
      const health = await app.inject('/');
      expect(health.statusCode).toBe(200);
      expect(health.body).toBe('Hello World!');

      const admin = await app.inject('/admin/trucks/not-a-uuid');
      expect(admin.statusCode).toBe(401);
      expect(admin.headers['cache-control']).toBe('private, no-store');

      const browserOnMobile = await app.inject({
        method: 'GET',
        url: '/mobile/driver/context',
        headers: { origin: 'https://fleet.example' },
      });
      expect(browserOnMobile.statusCode).toBe(403);
      expect(browserOnMobile.headers['cache-control']).toBe(
        'private, no-store',
      );

      const unauthMobile = await app.inject('/mobile/driver/context');
      expect(unauthMobile.statusCode).toBe(401);

      const publicJobNoBearer = await app.inject('/public/service-job');
      expect(publicJobNoBearer.statusCode).toBe(400);
      expect(publicJobNoBearer.headers['cache-control']).toBe(
        'private, no-store',
      );

      const invalidPhotoParam = await app.inject({
        method: 'GET',
        url: '/public/service-job/photos/not-a-uuid',
        headers: { authorization: 'Bearer some-code' },
      });
      expect(invalidPhotoParam.statusCode).toBe(400);
      expect(invalidPhotoParam.json()).toMatchObject({
        statusCode: 400,
        message: 'Validation failed (uuid is expected)',
      });
    } finally {
      await app.close();
    }
  });
});
