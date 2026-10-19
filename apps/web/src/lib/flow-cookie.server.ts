import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import {
  deleteCookie,
  getCookie,
  setCookie,
} from '@tanstack/react-start/server'
import type { FlowKind } from './auth-flow'

export interface FlowState {
  id: string
  csrfToken: string
}
const cookieName = (kind: FlowKind) => `fleet_${kind}_flow`
const aad = (kind: FlowKind) => Buffer.from(`fleet-browser-flow:${kind}`)
function key() {
  if (!process.env.APP_CSRF_SECRET)
    throw new Error('Authentication is not configured.')
  return createHash('sha256').update(process.env.APP_CSRF_SECRET).digest()
}

export function readFlowState(kind: FlowKind): FlowState | undefined {
  try {
    const value = getCookie(cookieName(kind))
    if (!value) return undefined
    const bytes = Buffer.from(value, 'base64url')
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key(),
      bytes.subarray(0, 12),
    )
    decipher.setAAD(aad(kind))
    decipher.setAuthTag(bytes.subarray(12, 28))
    const state = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString('utf8'),
    )
    return typeof state.id === 'string' && typeof state.csrfToken === 'string'
      ? state
      : undefined
  } catch {
    return undefined
  }
}

export function writeFlowState(kind: FlowKind, state: FlowState) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(aad(kind))
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(state), 'utf8'),
    cipher.final(),
  ])
  setCookie(
    cookieName(kind),
    Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url'),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.APP_URL?.startsWith('https://') ?? false,
      path: '/',
      maxAge: 3600,
    },
  )
}

export function clearFlowState(kind: FlowKind) {
  deleteCookie(cookieName(kind), { path: '/' })
}
