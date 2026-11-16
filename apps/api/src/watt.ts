import { createApi } from './app.js';

export async function create() {
  const { app } = await createApi({
    logger: { level: process.env.PLT_SERVER_LOGGER_LEVEL || 'info' },
  });
  try {
    await app.ready();
    return app;
  } catch (error) {
    await app.close().catch((err: unknown) => {
      app.log.error({ err }, 'API shutdown after failed startup');
    });
    throw error;
  }
}
