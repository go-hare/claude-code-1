import type {
  Session,
  Environment,
  ControlResponse,
  SessionEvent,
} from '../types'
import { generateMessageUuid } from '../lib/utils'

const BASE = ''
const CORRUPTED_UUID_SENTINEL = '__default__'
const CORRUPTED_TOKEN_ID_PREFIX = 'tk_'

export function isCorruptedUuid(value: string | null | undefined): boolean {
  if (!value || !value.trim()) return true
  return (
    value === CORRUPTED_UUID_SENTINEL ||
    value.startsWith(CORRUPTED_TOKEN_ID_PREFIX)
  )
}

/** In-memory fallback UUID when localStorage is unavailable or throws */
let fallbackUuid: string | null = null

export function getUuid(): string {
  let uuid: string | null = null
  let storageReadable = true
  try {
    uuid = localStorage.getItem('rcs_uuid')
  } catch {
    storageReadable = false
  }
  if (!storageReadable) {
    if (isCorruptedUuid(fallbackUuid)) {
      fallbackUuid = generateMessageUuid()
    }
    return fallbackUuid!
  }
  if (isCorruptedUuid(uuid)) {
    const generated = generateMessageUuid()
    let storageWritable = true
    try {
      localStorage.setItem('rcs_uuid', generated)
    } catch {
      storageWritable = false
    }
    if (!storageWritable) {
      if (isCorruptedUuid(fallbackUuid)) {
        fallbackUuid = generated
      }
      return fallbackUuid!
    }
    fallbackUuid = generated
    return generated
  }
  fallbackUuid = uuid
  return uuid!
}

export function setUuid(uuid: string): void {
  if (isCorruptedUuid(uuid)) return
  fallbackUuid = uuid
  try {
    localStorage.setItem('rcs_uuid', uuid)
  } catch {
    // ignore storage errors
  }
}

/** Active API token for Authorization header (set by useTokens) */
let _activeToken: string | null = null

export function setActiveApiToken(token: string | null): void {
  _activeToken = token
}

export function getActiveApiToken(): string | null {
  return _activeToken
}

async function readResponseBody(res: Response): Promise<{
  data: unknown
  rawText: string
}> {
  if (typeof res.text === 'function') {
    const rawText = await res.text()
    if (!rawText) return { data: undefined, rawText: '' }
    try {
      return { data: JSON.parse(rawText), rawText }
    } catch {
      return { data: undefined, rawText }
    }
  }
  try {
    const data = await res.json()
    return { data, rawText: '' }
  } catch {
    return { data: undefined, rawText: '' }
  }
}

function extractApiErrorMessage(
  data: unknown,
  rawText: string,
  res: Response,
): string {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    const errField = record.error
    if (typeof errField === 'string' && errField.trim()) {
      return errField
    }
    if (errField && typeof errField === 'object') {
      const errObj = errField as Record<string, unknown>
      if (typeof errObj.message === 'string' && errObj.message.trim()) {
        return errObj.message
      }
      if (typeof errObj.type === 'string' && errObj.type.trim()) {
        return errObj.type
      }
    }
  }
  if (rawText.trim()) return rawText.trim()
  return res.statusText || `HTTP ${res.status}`
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const uuid = getUuid()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-UUID': uuid,
  }

  if (_activeToken) {
    headers['Authorization'] = `Bearer ${_activeToken}`
  }

  const url = `${BASE}${path}`
  const opts: RequestInit = { method, headers }
  if (body !== undefined) opts.body = JSON.stringify(body)

  const res = await fetch(url, opts)
  const { data, rawText } = await readResponseBody(res)
  if (!res.ok) {
    throw new Error(extractApiErrorMessage(data, rawText, res))
  }
  return data as T
}

export function apiBind(sessionId: string) {
  return api<void>('POST', '/web/bind', { sessionId })
}

export function apiFetchSessions() {
  return api<Session[]>('GET', '/web/sessions')
}

export function apiFetchAllSessions() {
  return api<Session[]>('GET', '/web/sessions/all')
}

export function apiFetchSession(id: string) {
  return api<Session>('GET', `/web/sessions/${id}`)
}

export function apiFetchSessionHistory(id: string) {
  return api<{ events: SessionEvent[] }>('GET', `/web/sessions/${id}/history`)
}

export function apiFetchEnvironments() {
  return api<Environment[]>('GET', '/web/environments')
}

export function apiSendEvent(sessionId: string, body: Record<string, unknown>) {
  return api<void>('POST', `/web/sessions/${sessionId}/events`, body)
}

export function apiSendControl(sessionId: string, body: ControlResponse) {
  return api<void>('POST', `/web/sessions/${sessionId}/control`, body)
}

export function apiInterrupt(sessionId: string) {
  return api<void>('POST', `/web/sessions/${sessionId}/interrupt`)
}

export function apiCreateSession(body: {
  title?: string
  environment_id?: string
}) {
  return api<Session>('POST', '/web/sessions', body)
}
