import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadFlowServer,
  logoutServer,
  submitFlowServer,
} from './auth-flow.server'
import { readFlowState, writeFlowState } from './flow-cookie.server'

const context = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  origin: 'http://localhost:3042',
  appended: vi.fn(),
  setCookie: vi.fn(),
  cache: vi.fn(),
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeader: (name: string) =>
    name === 'origin' ? context.origin : 'ory_csrf=old',
  getCookie: (name: string) => context.cookies.get(name),
  setCookie: (name: string, value: string, options: unknown) => {
    context.cookies.set(name, value)
    context.setCookie(name, value, options)
  },
  deleteCookie: (name: string) => context.cookies.delete(name),
  appendResponseHeader: context.appended,
  setResponseHeader: context.cache,
}))

const oldId = '11111111-1111-4111-8111-111111111111'
const newId = '22222222-2222-4222-8222-222222222222'
const rawFlow = (id = newId, token = 'new-csrf') => ({
  id,
  ui: {
    nodes: [
      { attributes: { name: 'csrf_token', value: token } },
      { attributes: { name: 'password', value: 'must-never-be-returned' } },
    ],
  },
})
const json = (body: unknown, status = 200, cookies: string[] = []) => {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(JSON.stringify(body), { status, headers })
}
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubEnv('APP_URL', 'http://127.0.0.1:3042/')
  vi.stubEnv('KRATOS_PUBLIC_URL', 'http://127.0.0.1:14433/')
  vi.stubEnv('KRATOS_UI_URL', 'http://127.0.0.1:14455/')
  vi.stubEnv('APP_CSRF_SECRET', 'test-secret-for-encrypted-flow-state')
  vi.stubEnv('NODE_ENV', 'test')
  context.cookies.clear()
  context.origin = 'http://localhost:3042'
  context.appended.mockClear()
  context.setCookie.mockClear()
  context.cache.mockClear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Server-rendered Kratos flows', () => {
  it('forwards individual CSRF cookies and returns no flow IDs or password values', async () => {
    fetchMock.mockResolvedValue(
      json(rawFlow(), 200, [
        'ory_csrf=new; Path=/; HttpOnly',
        'another=value; Path=/',
      ]),
    )
    const result = await loadFlowServer({ kind: 'login' })
    expect(result.flow).toBeDefined()
    expect(JSON.stringify(result)).not.toContain(newId)
    expect(JSON.stringify(result)).not.toContain('must-never-be-returned')
    expect(context.appended).toHaveBeenCalledTimes(2)
    expect(context.cache).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    )
    expect(readFlowState('login')).toEqual({ id: newId, csrfToken: 'new-csrf' })
    expect(context.setCookie.mock.calls[0][2]).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
  })

  it('keeps flow state encrypted, rejects tampering, and binds it to its flow kind', () => {
    writeFlowState('login', { id: oldId, csrfToken: 'old-csrf' })
    const value = context.cookies.get('fleet_login_flow')!
    expect(value).not.toContain(oldId)
    context.cookies.set('fleet_verification_flow', value)
    expect(readFlowState('verification')).toBeUndefined()
    context.cookies.set('fleet_login_flow', value.slice(0, -8) + 'tampered')
    expect(readFlowState('login')).toBeUndefined()
  })

  it('silently replaces an expired flow when rendering a page', async () => {
    writeFlowState('login', { id: oldId, csrfToken: 'old-csrf' })
    fetchMock
      .mockResolvedValueOnce(json({}, 410))
      .mockResolvedValueOnce(json(rawFlow()))
    const result = await loadFlowServer({ kind: 'login' })
    expect(result.error).toBeNull()
    expect(result.flow).toBeDefined()
    expect(readFlowState('login')?.id).toBe(newId)
  })

  it('refreshes an expired flow and retries once using the new CSRF cookie and token', async () => {
    writeFlowState('login', { id: oldId, csrfToken: 'old-csrf' })
    fetchMock
      .mockResolvedValueOnce(json({}, 410))
      .mockResolvedValueOnce(
        json(rawFlow(), 200, ['ory_csrf=new; Path=/; HttpOnly']),
      )
      .mockResolvedValueOnce(
        json({ session: { active: true } }, 200, [
          'fleet_kratos_session=opaque; Path=/; HttpOnly',
        ]),
      )
    const result = await submitFlowServer({
      kind: 'login',
      csrfToken: 'old-csrf',
      values: {
        identifier: 'admin@example.test',
        password: 'correct-password',
      },
    })
    expect(result).toEqual({ redirect: '/admin' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const final = fetchMock.mock.calls[2][1]
    expect(final.headers.Cookie).toContain('ory_csrf=new')
    expect(JSON.parse(final.body)).toMatchObject({
      csrf_token: 'new-csrf',
      password: 'correct-password',
    })
    expect(context.cookies.has('fleet_login_flow')).toBe(false)
  })

  it('recovers a form replaced by another tab without exposing flow state', async () => {
    writeFlowState('login', { id: oldId, csrfToken: 'other-tab-csrf' })
    fetchMock
      .mockResolvedValueOnce(json(rawFlow()))
      .mockResolvedValueOnce(json({ session: {} }))
    expect(
      await submitFlowServer({
        kind: 'login',
        csrfToken: 'old-tab-csrf',
        values: {
          identifier: 'admin@example.test',
          password: 'correct-password',
        },
      }),
    ).toEqual({ redirect: '/admin' })
  })

  it('does not retry indefinitely when authentication is unavailable', async () => {
    writeFlowState('login', { id: oldId, csrfToken: 'old-csrf' })
    fetchMock
      .mockResolvedValueOnce(json({}, 410))
      .mockResolvedValueOnce(json(rawFlow()))
      .mockResolvedValueOnce(json({}, 410))
    const result = await submitFlowServer({
      kind: 'login',
      csrfToken: 'old-csrf',
      values: {},
    })
    expect(result.error).toBeDefined()
    expect(result.error).not.toMatch(/flow|expired|11111111/i)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rejects cross-origin submissions and missing CSRF tokens before contacting Kratos', async () => {
    context.origin = 'https://evil.example'
    expect(
      (
        await submitFlowServer({
          kind: 'login',
          csrfToken: 'token',
          values: {},
        })
      ).error,
    ).toBeDefined()
    context.origin = 'http://localhost:3042'
    expect(
      (await submitFlowServer({ kind: 'login', csrfToken: '', values: {} }))
        .error,
    ).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stores verification continuations privately and returns a clean local URL', async () => {
    writeFlowState('login', { id: oldId, csrfToken: 'old-csrf' })
    fetchMock
      .mockResolvedValueOnce(
        json(
          {
            continue_with: [
              { action: 'show_verification_ui', flow: { id: newId } },
            ],
          },
          403,
        ),
      )
      .mockResolvedValueOnce(json(rawFlow()))
    const result = await submitFlowServer({
      kind: 'login',
      csrfToken: 'old-csrf',
      values: {},
    })
    expect(result).toEqual({ redirect: '/verify-email' })
    expect(readFlowState('verification')?.id).toBe(newId)
  })

  it('does not forward arbitrary redirect destinations', async () => {
    writeFlowState('login', { id: oldId, csrfToken: 'old-csrf' })
    fetchMock.mockResolvedValue(
      json({ redirect_browser_to: 'https://evil.example' }, 422),
    )
    const result = await submitFlowServer({
      kind: 'login',
      csrfToken: 'old-csrf',
      values: {},
    })
    expect(result.redirect).toBeUndefined()
  })

  it('forwards logout cookie expiry and clears temporary flow state', async () => {
    writeFlowState('login', { id: oldId, csrfToken: 'old-csrf' })
    fetchMock
      .mockResolvedValueOnce(
        json({
          logout_url: 'http://127.0.0.1:14433/self-service/logout?token=test',
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 303,
          headers: {
            'Set-Cookie': 'fleet_kratos_session=; Max-Age=0; Path=/; HttpOnly',
          },
        }),
      )
    expect(await logoutServer()).toEqual({ ok: true })
    expect(context.cookies.size).toBe(0)
    expect(context.appended).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('Max-Age=0'),
    )
  })
})
