import { useEffect } from 'react'
import { CreateAction, PageHeader } from '@/components/page-header'
import { useForm } from '@tanstack/react-form'
import { submitForm, textFieldProps } from '@/lib/form'
import {
  createFileRoute,
  Link,
  useNavigate,
  stripSearchParams,
} from '@tanstack/react-router'
import { ArrowRight, Plus, Search } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { RecordList } from '@/components/record-list'
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
  const navigate = useNavigate({ from: Route.fullPath })
  const form = useForm({
    defaultValues: { q: search.q },
    onSubmit: ({ value }) => navigate({ search: { q: value.q, page: 1 } }),
  })
  useEffect(() => {
    form.reset({ q: search.q })
  }, [form, search.q])
  const { items = [], total = 0, page = 1, pageSize = 20 } = result.data ?? {}
  return (
    <>
      <PageHeader
        title="Users"
        group="Company"
        actions={
          can(session, 'users.create') && (
            <CreateAction asChild>
              <Link to="/admin/users/new">
                <Plus />
                Create user
              </Link>
            </CreateAction>
          )
        }
      />
      {!result.data ? (
        <PageError message={result.error!} />
      ) : (
        <RecordList
          summary={`${total} ${total === 1 ? 'user' : 'users'}`}
          page={page}
          pageCount={Math.max(1, Math.ceil(total / pageSize))}
          onPageChange={(page) =>
            void navigate({ search: { q: search.q, page } })
          }
          filters={
            <form
              className="flex w-full max-w-sm items-center gap-2"
              onSubmit={submitForm(form)}
              role="search"
            >
              <form.Field name="q">
                {(field) => (
                  <Input
                    {...textFieldProps(field)}
                    aria-label="Search users"
                    placeholder="Search users"
                    maxLength={200}
                  />
                )}
              </form.Field>
              <Button
                type="submit"
                variant="outline"
                size="icon"
                className="size-12"
                aria-label="Search"
              >
                <Search />
              </Button>
            </form>
          }
        >
          {items.length ? (
            <>
              <div className="divide-y lg:hidden">
                {items.map((user) => (
                  <Link
                    key={user.id}
                    to="/admin/users/$userId"
                    params={{ userId: user.id }}
                    className="block space-y-4 p-5 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar>
                        <AvatarFallback className="text-xs">
                          {user.firstName[0]}
                          {user.lastName[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="font-semibold [overflow-wrap:anywhere]">
                          {user.firstName} {user.lastName}
                        </p>
                        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                          {user.email}
                        </p>
                      </div>
                      <ArrowRight
                        aria-hidden="true"
                        className="size-4 shrink-0"
                      />
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
              </div>
              <Table className="hidden lg:table">
                <TableHeader className="bg-muted">
                  <TableRow>
                    <TableHead className="pl-5">User</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="py-4 pl-5 whitespace-normal [overflow-wrap:anywhere]">
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
                              className="font-semibold underline-offset-4 hover:underline focus-visible:underline"
                            >
                              {user.firstName} {user.lastName}
                              <ArrowRight
                                aria-hidden="true"
                                className="ml-1.5 inline-block size-3.5 align-text-bottom text-muted-foreground"
                              />
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
                      <TableCell className="pr-5">
                        <Badge variant="outline">
                          <span
                            className={`mr-1 size-1.5 rounded-full ${user.isActive ? 'bg-emerald-600' : 'bg-muted-foreground'}`}
                          />
                          {user.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          ) : (
            <EmptyState
              icon="users"
              title={search.q ? 'No matching users' : 'No users yet'}
              action={
                search.q ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      form.reset({ q: '' })
                      void navigate({ search: { q: '', page: 1 } })
                    }}
                  >
                    Clear search
                  </Button>
                ) : undefined
              }
            />
          )}
        </RecordList>
      )}
    </>
  )
}
