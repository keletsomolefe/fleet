import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent } from '@/components/ui/card'
import { PageError } from '@/components/page-error'
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
  return (
    <>
      <div className="space-y-1 py-2">
        <p className="text-[11px] text-muted-foreground uppercase">Company</p>
        <h1>Roles & permissions</h1>
      </div>
      <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
        {result.data.map((role) => (
          <Card key={role.id} className="shadow-none">
            <CardContent className="space-y-5">
              <h2 className="text-sm font-semibold">{role.name}</h2>
              <ul className="space-y-3 border-t pt-5 text-xs text-muted-foreground">
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
