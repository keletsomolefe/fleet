import { create } from './watt.js';

const app = await create();
try {
  await app.listen({
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
  });
} catch (error) {
  await app.close();
  throw error;
}

const shutdown = () => {
  void app.close().catch((err: unknown) => {
    app.log.error({ err }, 'API shutdown failed');
    process.exitCode = 1;
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
