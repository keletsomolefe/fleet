import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('protects session and administrator APIs before controller execution', async () => {
    await request(app.getHttpServer()).get('/auth/session').expect(401);
    await request(app.getHttpServer())
      .post('/admin/users')
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post('/internal/kratos/after-login')
      .send({})
      .expect(401);
    const response = await request(app.getHttpServer())
      .get('/auth/config')
      .expect(200);
    expect(response.body).not.toHaveProperty('kratosAdminUrl');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  afterEach(async () => {
    await app.close();
  });
});
