# Fleet API

The [Fastify 5](https://fastify.dev/) server is built in `src/app.ts`. Watt calls
`src/watt.ts` to get the Fastify instance, and the gateway serves it at
<http://127.0.0.1:3042/api>. Fastify starts TypeORM, the WhatsApp queue, and MQTT
when the app is ready, and closes them on shutdown.

Kratos validates browser sessions. The API reads its session cookie using
`@fastify/cookie`, checks Fleet permissions in a Fastify hook, and validates CSRF
before administrator writes. Mobile endpoints use native bearer credentials.
Repair photo uploads use `@fastify/multipart` after authorization.

Run from the repository root:

```sh
pnpm dev
pnpm --filter api build
pnpm --filter api typecheck
pnpm --filter api test
pnpm test:e2e
```

The end-to-end suite requires the root `.env` and an existing local PostgreSQL
`app` schema. See [deployment](../../docs/deployment.md) for schema requirements.
