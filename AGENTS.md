# Fleet development conventions

- Use pnpm from the repository root and keep shared configuration in the root `.env`.
- Fleet is pre-production. Local development data is disposable; migrations may be rewritten and the local database reset when changes call for it. Production migration compatibility is not required yet.
- Keep UI copy concise. Do not put developer notes, implementation status, account-policy explanations, or repeated instructions on product screens. Keep those details in repository documentation. Retain labels, validation requirements, necessary recovery steps, and meaningful outcome/status messages.
- Write for everyday employees. Use plain language and short actions such as “Sign in”. Use “Welcome to Fleet” for the sign-in heading, and keep technical connection, authentication and storage terms out of employee-facing copy.
- Use the existing shadcn/ui components and VHH theme for interface changes. The design source is linked in `docs/admin-authentication.md`.
- Kratos owns authentication sessions and credentials. Application users and authorization belong in the `app` schema through TypeORM.
- Fleet currently serves one company. Keep a single user model; roles and permissions determine admin, driver and terminal access. Do not introduce workspaces, tenancy, or a fixed admin/driver user type.
- Never commit credentials, local Kratos hook configuration, or test accounts. Preserve database schema/role isolation and use explicit migrations with synchronization disabled.
