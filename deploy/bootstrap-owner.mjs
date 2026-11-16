// Initial owner bootstrap for deployments. The implementation lives in the API
// so it uses the compiled MikroORM configuration and entities.
const { bootstrapInitialOwner } = await import(
  "../apps/api/dist/database/bootstrap-owner.js"
);

await bootstrapInitialOwner();
