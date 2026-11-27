import { Hono } from 'hono'
import { validateApiKey } from '../../auth/api-key'
import {
  extractBearerToken,
  getUuidFromRequest,
  isUnauthenticatedUuidAllowed,
  requireJsonContentType,
} from '../../auth/middleware'
import { resolveToken } from '../../auth/token'
import {
  storeBindSession,
  storeGetSession,
  storeGetSessionOwners,
} from '../../store'
import {
  resolveExistingWebSessionId,
  toWebSessionId,
} from '../../services/session'

const app = new Hono()

/** POST /web/bind — Bind an unowned/owned session to an authenticated client */
app.post('/bind', requireJsonContentType, async c => {
  const bearer = extractBearerToken(c)
  const tokenUsername = resolveToken(bearer)
  const hasApiKey = !!bearer && validateApiKey(bearer)
  const allowLoopbackUuid = isUnauthenticatedUuidAllowed()

  if (!tokenUsername && !hasApiKey && !allowLoopbackUuid) {
    return c.json(
      {
        error: {
          type: 'unauthorized',
          message: 'Valid API key or session token required',
        },
      },
      401,
    )
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  // Server-issued tokens pin uuid to the verified username so a token holder
  // cannot spoof another client's UUID. API key & loopback opt-in allow explicit UUID.
  const requestedUuid =
    getUuidFromRequest(c) || (typeof body.uuid === 'string' ? body.uuid : '')
  const uuid = hasApiKey
    ? requestedUuid
    : tokenUsername
      ? tokenUsername
      : requestedUuid

  if (!sessionId || !uuid) {
    return c.json(
      {
        error: {
          type: 'invalid_request',
          message: 'sessionId and uuid are required',
        },
      },
      400,
    )
  }

  const resolvedSessionId = resolveExistingWebSessionId(sessionId)
  if (!resolvedSessionId) {
    return c.json(
      { error: { type: 'not_found', message: 'Session not found' } },
      404,
    )
  }

  const owners = storeGetSessionOwners(resolvedSessionId)
  const session = storeGetSession(resolvedSessionId)
  const isUnowned = !owners || owners.size === 0
  const isAlreadyOwner = owners?.has(uuid) === true
  const isSharedAcp = session?.source === 'acp'

  if (isSharedAcp && !hasApiKey && !isAlreadyOwner) {
    return c.json(
      {
        error: {
          type: 'forbidden',
          message: 'API key required to bind ACP session',
        },
      },
      403,
    )
  }

  if (!hasApiKey && !isUnowned && !isAlreadyOwner && !isSharedAcp) {
    return c.json(
      {
        error: {
          type: 'forbidden',
          message: 'Session is already owned by another client',
        },
      },
      403,
    )
  }

  storeBindSession(resolvedSessionId, uuid)
  return c.json({ ok: true, sessionId: toWebSessionId(resolvedSessionId) })
})

export default app
