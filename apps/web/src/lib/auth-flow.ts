import { createServerFn } from '@tanstack/react-start'

export type FlowKind = 'login' | 'verification'
export interface FlowMessage {
  id?: number
  text: string
  type?: string
}
export interface BrowserFlow {
  state?: string
  ui: {
    messages: FlowMessage[]
    nodes: Array<{
      messages: FlowMessage[]
      attributes: { name?: string; value?: string }
    }>
  }
}
export interface FlowPageData {
  flow: BrowserFlow | null
  recoveryUrl: string
  error: string | null
  alreadyAuthenticated: boolean
}
export interface LoadFlowInput {
  kind: FlowKind
  flowId?: string
}
export interface SubmitFlowInput {
  kind: FlowKind
  csrfToken: string
  values: Record<string, string>
}
export interface FlowSubmission {
  flow?: BrowserFlow
  error?: string
  redirect?: string
  complete?: boolean
}

export const isFlowId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

function validateLoad(input: LoadFlowInput): LoadFlowInput {
  if (!input || !['login', 'verification'].includes(input.kind))
    throw new Error('Invalid authentication form.')
  return {
    kind: input.kind,
    flowId: isFlowId(input.flowId) ? input.flowId : undefined,
  }
}

export const loadAuthFlow = createServerFn({ method: 'GET' })
  .validator(validateLoad)
  .handler(async ({ data }): Promise<FlowPageData> => {
    const { loadFlowServer } = await import('./auth-flow.server')
    return loadFlowServer(data)
  })

export const submitAuthFlow = createServerFn({ method: 'POST' })
  .validator((input: SubmitFlowInput): SubmitFlowInput => {
    validateLoad(input)
    if (
      typeof input.csrfToken !== 'string' ||
      input.csrfToken.length > 512 ||
      !input.values ||
      typeof input.values !== 'object'
    )
      throw new Error('Invalid authentication form.')
    for (const [key, value] of Object.entries(input.values)) {
      if (
        !['identifier', 'password', 'email', 'code'].includes(key) ||
        typeof value !== 'string' ||
        value.length > 320
      )
        throw new Error('Invalid authentication form.')
    }
    return input
  })
  .handler(async ({ data }): Promise<FlowSubmission> => {
    const { submitFlowServer } = await import('./auth-flow.server')
    return submitFlowServer(data)
  })

export const logoutAuth = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { logoutServer } = await import('./auth-flow.server')
    return logoutServer()
  },
)
