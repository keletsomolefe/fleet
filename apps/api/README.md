# Fleet API

NestJS 12 starter, generated with the latest Nest CLI and added with `wattpm add`.

Run `npm install` and `npm run dev` from the repository root. The gateway
serves this app at http://127.0.0.1:3042/api. Watt assigns it a private ephemeral
port using the factory exported by `src/watt.ts`.

From the repository root:

```sh
npm run build --workspace api
npm test
npm run test:e2e
npm run typecheck --workspace api
```

Watt's Nest adapter currently supports NestJS 11 only. This app uses
`@platformatic/node` with a Nest application factory and automatic rebuilds to run
NestJS 12. The latest Nest CLI requires TypeScript 6 because TypeScript 7.0
does not expose the compiler API it needs.
