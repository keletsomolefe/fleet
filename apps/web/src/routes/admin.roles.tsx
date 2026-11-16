import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent } from '@/components/ui/card'
import { PageError } from '@/components/page-error'
import { PageHeader } from '@/components/page-header'
import { getRoles } from '@/lib/users'

export const Route = createFileRoute('/admin/roles')({
  loader: () => getRoles(),
  staleTime: 0,
  gcTime: 0,
  component: Roles,
})
function Roles() {
  const result = Route.useLoaderData()
  if (!result.data) return <PageError message={result.error!} />
  const roles = [...result.data].sort(
    (a, b) => b.permissions.length - a.permissions.length,
  )

  return (
    <>
      <PageHeader title="Roles & permissions" group="Company" />
      <div className="columns-[18rem_3] gap-4">
        {roles.map((role) => (
          <Card
            key={role.id}
            className="mb-4 break-inside-avoid-column py-4 shadow-none"
          >
            <CardContent className="space-y-3 px-4">
              <h2 className="text-sm font-semibold">{role.name}</h2>
              <ul className="space-y-1.5 border-t pt-3 text-sm text-muted-foreground">
                {role.permissions.map((permission) => (
                  <li key={permission.key}>{permission.name}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}
