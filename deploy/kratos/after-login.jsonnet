function(ctx) {
  identity: {
    id: ctx.identity.id,
    traits: {
      email: ctx.identity.traits.email,
      name: ctx.identity.traits.name,
    },
  },
  authenticated_at: ctx.session.authenticated_at,
}
