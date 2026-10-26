import { PageHeader } from '@/components/page-header'
import { useState, type FormEvent } from 'react'
import {
  createFileRoute,
  Link,
  useNavigate,
  stripSearchParams,
} from '@tanstack/react-router'
import { ArrowUpRight, Plus, Search } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageError } from '@/components/page-error'
import { can } from '@/lib/auth'
import { getUsers } from '@/lib/users'

export const Route = createFileRoute('/admin/users/')({
  search: { middlewares: [stripSearchParams({ q: '', page: 1 })] },
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q.slice(0, 200) : '',
    page:
      Number.isInteger(Number(search.page)) &&
      Number(search.page) > 0 &&
      Number(search.page) <= 999999
        ? Number(search.page)
        : 1,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getUsers({ data: deps }),
  staleTime: 0,
  gcTime: 0,
  component: Users,
})

function Users() {
  const result = Route.useLoaderData()
  const { session } = Route.useRouteContext()
  const search = Route.useSearch()
  const [query, setQuery] = useState(search.q)
  const navigate = useNavigate({ from: Route.fullPath })
  function submit(event: FormEvent) {
    event.preventDefault()
    void navigate({ search: { q: query, page: 1 } })
  }
  if (!result.data) return <PageError message={result.error!} />
  const { items, total, page, pageSize } = result.data
  return (
    <>
      <PageHeader
        title="Users"
        group="Company"
        actions={
          can(session, 'users.create') && (
            <Button asChild>
              <Link to="/admin/users/new">
                <Plus />
                Create user
              </Link>
            </Button>
          )
        }
      />
      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b p-5">
          <form
            className="flex w-full max-w-sm items-center gap-2"
            onSubmit={submit}
            role="search"
          >
            <Input
              aria-label="Search users"
              placeholder="Search users"
              value={query}
              maxLength={200}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              size="icon"
              aria-label="Search"
            >
              <Search />
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            {total} {total === 1 ? 'user' : 'users'}
          </p>
        </div>
        <div className="divide-y sm:hidden">
          {items.map((user) => (
            <Link
              key={user.id}
              to="/admin/users/$userId"
              params={{ userId: user.id }}
              className="block space-y-4 p-5 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <div className="flex items-start gap-3">
                <Avatar>
                  <AvatarFallback className="text-xs">
                    {user.firstName[0]}
                    {user.lastName[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-xs font-semibold">
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">
                    {user.email}
                  </p>
                </div>
                <ArrowUpRight className="size-4 shrink-0" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">
                  {user.isActive ? 'Active' : 'Inactive'}
                </Badge>
                {user.roles.length ? (
                  user.roles.map((role) => (
                    <Badge key={role.id} variant="secondary">
                      {role.name}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">
                    No roles
                  </span>
                )}
              </div>
            </Link>
          ))}
          {!items.length && (
            <p className="p-10 text-center text-xs text-muted-foreground">
              {search.q ? 'No matching users' : 'No users yet'}
            </p>
          )}
        </div>
        <Table className="hidden sm:table">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">User</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-5">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="py-5 pl-5">
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback className="text-xs">
                        {user.firstName[0]}
                        {user.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <Link
                        to="/admin/users/$userId"
                        params={{ userId: user.id }}
                        className="font-semibold hover:underline"
                      >
                        {user.firstName} {user.lastName}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    {user.roles.length ? (
                      user.roles.map((role) => (
                        <Badge key={role.id} variant="secondary">
                          {role.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No roles
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    <span
                      className={`mr-1 size-1.5 rounded-full ${user.isActive ? 'bg-emerald-600' : 'bg-muted-foreground'}`}
                    />
                    {user.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell className="pr-5 text-right">
                  <Button asChild variant="ghost" size="icon">
                    <Link
                      to="/admin/users/$userId"
                      params={{ userId: user.id }}
                      aria-label={`View ${user.firstName} ${user.lastName}`}
                    >
                      <ArrowUpRight />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!items.length && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-48 text-center text-muted-foreground"
                >
                  {search.q ? 'No matching users' : 'No users yet'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between gap-3 border-t p-5 text-xs">
          <span className="text-muted-foreground">
            Page {page} of {Math.max(1, Math.ceil(total / pageSize))}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-9"
              disabled={page <= 1}
              onClick={() =>
                void navigate({ search: { q: search.q, page: page - 1 } })
              }
            >
              Previous
            </Button>
            <Button
              variant="outline"
              className="h-9"
              disabled={page * pageSize >= total}
              onClick={() =>
                void navigate({ search: { q: search.q, page: page + 1 } })
              }
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </>
  )
}
