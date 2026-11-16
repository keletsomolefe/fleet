import type { FastifyInstance } from 'fastify';
import { createApi } from '../src/app.js';

describe('Fleet API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await createApi());
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the gateway health check', async () => {
    const response = await app.inject('/');
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('Hello World!');
  });

  it('protects session, administrator APIs, and the internal hook', async () => {
    const session = await app.inject('/auth/session');
    expect(session.statusCode).toBe(401);
    expect(session.headers['cache-control']).toBe('private, no-store');

    const admin = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: {},
    });
    expect(admin.statusCode).toBe(401);
    expect(admin.headers['cache-control']).toBe('private, no-store');

    const unknownAdmin = await app.inject({
      method: 'POST',
      url: '/admin/drivers/trucks',
      payload: {},
    });
    expect(unknownAdmin.statusCode).toBe(401);

    const mobile = await app.inject({
      method: 'POST',
      url: '/mobile/admin/notifications/connection',
      headers: { 'content-type': 'application/json', 'content-length': '0' },
    });
    expect(mobile.statusCode).toBe(401);

    const callback = await app.inject({
      method: 'POST',
      url: '/internal/kratos/after-login',
      payload: {},
    });
    expect(callback.statusCode).toBe(401);

    const config = await app.inject('/auth/config');
    expect(config.statusCode).toBe(200);
    expect(config.json()).not.toHaveProperty('kratosAdminUrl');
    expect(config.headers['cache-control']).toBe('no-store');
  });
});
