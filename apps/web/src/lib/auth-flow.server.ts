import {
  appendResponseHeader,
  getRequestHeader,
  setResponseHeader,
} from '@tanstack/react-start/server'
import {
  isFlowId,
  type BrowserFlow,
  type FlowKind,
  type FlowMessage,
  type FlowPageData,
  type LoadFlowInput,
  type SubmitFlowInput,
  type FlowSubmission,
} from './auth-flow'
import {
  clearFlowState,
  readFlowState,
  writeFlowState,
  type FlowState,
} from './flow-cookie.server'

type KratosBody = {
  id?: string
  state?: string
  ui?: {
    messages?: FlowMessage[]
    nodes?: Array<{
      messages?: FlowMessage[]
      attributes?: { name?: string; value?: unknown }
    }>
  }
  session?: unknown
  redirect_browser_to?: string
  continue_with?: Array<{
    action?: string
    flow?: { id?: string }
    redirect_browser_to?: string
  }>
  error?: { id?: string }
  logout_url?: string
}

// Each action has its own cookie jar. Newly issued CSRF cookies must be used if
// an expired flow is replaced and retried before this response reaches the browser.
class KratosBrowserRequest {
  private readonly cookies = new Map(
    (getRequestHeader('cookie') ?? '')
      .split(';')
      .filter(Boolean)
      .map((pair) => {
        const index = pair.indexOf('=')
        return [pair.slice(0, index).trim(), pair.slice(index + 1)] as const
      })
      .filter(([name]) => !/^fleet_(login|verification)_flow$/.test(name)),
  )

  async fetch(path: string, options: RequestInit = {}) {
    setResponseHeader('Cache-Control', 'private, no-store')
    const response = await fetch(new URL(path, process.env.KRATOS_PUBLIC_URL), {
      ...options,
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: [...this.cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join('; '),
        ...options.headers,
      },
    })
    for (const cookie of response.headers.getSetCookie()) {
      appendResponseHeader('Set-Cookie', cookie)
      const pair = cookie.split(';')[0]
      const index = pair.indexOf('=')
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1))
    }
    return {
      response,
      body: (await response.json().catch(() => ({}))) as KratosBody,
    }
  }
}

function publicFlow(body: KratosBody): BrowserFlow | undefined {
  if (!isFlowId(body.id) || !body.ui?.nodes) return undefined
  return {
    state: body.state,
    ui: {
      messages: body.ui.messages ?? [],
      nodes: body.ui.nodes.map((node) => ({
        messages: node.messages ?? [],
        attributes: {
          name: node.attributes?.name,
          value:
            node.attributes?.name !== 'password' &&
            typeof node.attributes?.value === 'string'
              ? node.attributes.value
              : undefined,
        },
      })),
    },
  }
}

function rememberFlow(kind: FlowKind, body: KratosBody): FlowState | undefined {
  if (!isFlowId(body.id)) return undefined
  const csrfToken = body.ui?.nodes?.find(
    (n) => n.attributes?.name === 'csrf_token',
  )?.attributes?.value
  if (typeof csrfToken !== 'string') return undefined
  const state = { id: body.id, csrfToken }
  writeFlowState(kind, state)
  return state
}

async function retrieveFlow(
  client: KratosBrowserRequest,
  kind: FlowKind,
  flowId?: string,
) {
  let result = await client.fetch(
    flowId
      ? `self-service/${kind}/flows?id=${encodeURIComponent(flowId)}`
      : `self-service/${kind}/browser`,
  )
  if (flowId && [403, 404, 410].includes(result.response.status))
    result = await client.fetch(`self-service/${kind}/browser`)
  return result
}

function sameOriginAction() {
  const app = new URL(process.env.APP_URL!)
  const origins = new Set([app.origin])
  if (
    process.env.NODE_ENV !== 'production' &&
    ['localhost', '127.0.0.1'].includes(app.hostname)
  ) {
    app.hostname = app.hostname === 'localhost' ? '127.0.0.1' : 'localhost'
    origins.add(app.origin)
  }
  return origins.has(getRequestHeader('origin') ?? '')
}

export async function loadFlowServer(
  input: LoadFlowInput,
): Promise<FlowPageData> {
  const result: FlowPageData = {
    flow: null,
    recoveryUrl: new URL('recovery', process.env.KRATOS_UI_URL).toString(),
    error: null,
    alreadyAuthenticated: false,
  }
  try {
    const state = readFlowState(input.kind)
    const { response, body } = await retrieveFlow(
      new KratosBrowserRequest(),
      input.kind,
      input.flowId ?? state?.id,
    )
    if (body.error?.id === 'session_already_available') {
      result.alreadyAuthenticated = true
      return result
    }
    const flow = publicFlow(body)
    if (!response.ok || !flow || !rememberFlow(input.kind, body))
      throw new Error('Flow unavailable')
    result.flow = flow
  } catch {
    result.error = 'Could not connect to authentication. Please try again.'
  }
  return result
}

function verificationTransition(body: KratosBody): {
  required: boolean
  flowId?: string
} {
  const continuation = body.continue_with?.find(
    (item) => item.action === 'show_verification_ui',
  )
  if (continuation)
    return {
      required: true,
      flowId: isFlowId(continuation.flow?.id)
        ? continuation.flow.id
        : undefined,
    }
  if (body.redirect_browser_to) {
    const target = new URL(
      body.redirect_browser_to,
      process.env.KRATOS_PUBLIC_URL,
    )
    if (
      ['/verify-email', '/self-service/verification/browser'].includes(
        target.pathname,
      )
    ) {
      const id = target.searchParams.get('flow')
      return { required: true, flowId: isFlowId(id) ? id : undefined }
    }
  }
  return { required: body.error?.id === 'session_verified_address_required' }
}

export async function submitFlowServer(
  input: SubmitFlowInput,
): Promise<FlowSubmission> {
  try {
    if (!sameOriginAction() || !input.csrfToken)
      return { error: 'Could not submit this form. Please try again.' }
    const client = new KratosBrowserRequest()
    let state = readFlowState(input.kind)
    // A second tab may have replaced the flow cookie. Refresh privately rather
    // than exposing flow identifiers or reporting an implementation detail.
    if (!state || state.csrfToken !== input.csrfToken) {
      const fresh = await retrieveFlow(client, input.kind)
      state = rememberFlow(input.kind, fresh.body)
    }
    for (let attempt = 0; attempt < 2 && state; attempt++) {
      const payload =
        input.kind === 'login'
          ? {
              method: 'password',
              identifier: input.values.identifier,
              password: input.values.password,
              csrf_token: state.csrfToken,
            }
          : {
              method: 'code',
              ...(input.values.code
                ? { code: input.values.code }
                : { email: input.values.email }),
              csrf_token: state.csrfToken,
            }
      const { response, body } = await client.fetch(
        `self-service/${input.kind}?flow=${encodeURIComponent(state.id)}`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      if ([404, 410].includes(response.status) && attempt === 0) {
        const fresh = await retrieveFlow(client, input.kind)
        state = rememberFlow(input.kind, fresh.body)
        continue
      }
      const verification = verificationTransition(body)
      if (verification.required) {
        const fresh = await retrieveFlow(
          client,
          'verification',
          verification.flowId,
        )
        rememberFlow('verification', fresh.body)
        return { redirect: '/verify-email' }
      }
      if (
        body.error?.id === 'session_already_available' ||
        (response.ok && input.kind === 'login' && body.session)
      ) {
        clearFlowState('login')
        return { redirect: '/admin' }
      }
      if (response.ok && body.state === 'passed_challenge') {
        clearFlowState('verification')
        return { complete: true }
      }
      const flow = publicFlow(body)
      if (flow) {
        rememberFlow(input.kind, body)
        return { flow }
      }
      return {
        error:
          response.status >= 500
            ? 'Authentication is temporarily unavailable. Please try again.'
            : 'Check your details and try again.',
      }
    }
    return { error: 'Could not connect to authentication. Please try again.' }
  } catch {
    return { error: 'Could not connect to authentication. Please try again.' }
  }
}

export async function logoutServer(): Promise<{ ok: boolean }> {
  try {
    if (!sameOriginAction()) return { ok: false }
    const client = new KratosBrowserRequest()
    const { response, body } = await client.fetch('self-service/logout/browser')
    if (response.status === 401) {
      clearFlowState('login')
      clearFlowState('verification')
      return { ok: true }
    }
    if (!response.ok || !body.logout_url) return { ok: false }
    const target = new URL(body.logout_url)
    const base = new URL(process.env.KRATOS_PUBLIC_URL!)
    if (
      target.origin !== base.origin ||
      target.pathname !== '/self-service/logout'
    )
      return { ok: false }
    const loggedOut = await client.fetch(`${target.pathname}${target.search}`)
    if (
      loggedOut.response.ok ||
      [302, 303].includes(loggedOut.response.status)
    ) {
      clearFlowState('login')
      clearFlowState('verification')
      return { ok: true }
    }
    return { ok: false }
  } catch {
    return { ok: false }
  }
}
