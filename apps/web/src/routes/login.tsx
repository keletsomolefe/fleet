import { createFileRoute, redirect } from '@tanstack/react-router'
import { KratosForm } from '@/components/kratos-form'
import { getSession } from '@/lib/auth'
import { isFlowId, loadAuthFlow } from '@/lib/auth-flow'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    flow: isFlowId(search.flow) ? search.flow : undefined,
    reason: typeof search.reason === 'string' ? search.reason : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const result = await getSession()
    if (result.status === 200) throw redirect({ to: '/admin' })
    if (result.status === 403 && search.reason !== 'access-denied')
      throw redirect({
        to: '/login',
        search: { flow: undefined, reason: 'access-denied' },
      })
  },
  loaderDeps: ({ search }) => ({ flow: search.flow, reason: search.reason }),
  loader: async ({ deps }) => {
    if (deps.reason === 'access-denied')
      return {
        flow: null,
        recoveryUrl: '',
        error: null,
        alreadyAuthenticated: true,
      }
    const result = await loadAuthFlow({
      data: { kind: 'login', flowId: deps.flow },
    })
    if (deps.flow && result.flow)
      throw redirect({
        to: '/login',
        search: { flow: undefined, reason: deps.reason },
        replace: true,
      })
    return result
  },
  staleTime: 0,
  gcTime: 0,
  component: Login,
})
function Login() {
  const data = Route.useLoaderData()
  const key =
    data.flow?.ui.nodes.find((node) => node.attributes.name === 'csrf_token')
      ?.attributes.value ?? 'login'
  return (
    <KratosForm
      key={key}
      kind="login"
      initial={data}
      reason={Route.useSearch().reason}
    />
  )
}
