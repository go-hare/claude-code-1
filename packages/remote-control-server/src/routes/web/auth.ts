import { Hono } from 'hono'
import { validateApiKey } from '../../auth/api-key'
import { extractBearerToken, getUuidFromRequest } from '../../auth/middleware'
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

/** POST /web/bind — Bind an unowned/owned session (or with API key) to a UUID */
app.post('/bind', async c => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  // UUID can come from X-UUID header, ?uuid= query param, or request body
  const uuid =
    getUuidFromRequest(c) || (typeof body.uuid === 'string' ? body.uuid : '')

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

  const bearer = extractBearerToken(c)
  const hasApiKey = !!bearer && validateApiKey(bearer)
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
