# Fleet gateway

Generated with `wattpm add`. This is the public entrypoint for the Watt runtime.

Start all applications with `npm run dev` from the repository root, or run
`npm run build` followed by `npm start` for production. Node.js 22.19 or newer
is required.

- `/api` forwards to the NestJS API, stripping the prefix.
- `/` forwards to the TanStack Start web app.

The default address is http://127.0.0.1:3042. Set `GATEWAY_PORT` and
`PLT_SERVER_HOSTNAME` in the root `.env` to change it.
