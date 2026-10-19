import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

let app: INestApplication | undefined;

export async function create() {
  app = await NestFactory.create(AppModule);
  await app.init();
  return app.getHttpServer();
}

export async function close() {
  await app?.close();
}
