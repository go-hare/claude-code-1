import { log, error as logError } from '../../logger'
import { Hono, type Context } from 'hono'
import { config } from '../../config'
import { validateApiKey } from '../../auth/api-key'
import {
  extractBearerToken,
  requireJsonContentType,
  uuidAuth,
} from '../../auth/middleware'
import { getAutomationStateSnapshot } from '../../services/automationState'
import {
  createSession,
  getSession,
  isSessionClosedStatus,
  listWebSessionSummariesByOwnerUuid,
  listWebSessionsByOwnerUuid,
  resolveOwnedWebSessionId,
  resolveReadableWebSessionId,
  toWebSessionResponse,
} from '../../services/session'
import {
  storeBindSession,
  storeGetEnvironment,
  storeGetSessionWorker,
  storeIsSessionOwner,
} from '../../store'
import { createWorkItem } from '../../services/work-dispatch'
import { createSSEStream } from '../../transport/sse-writer'
import { getEventBus } from '../../transport/event-bus'

const app = new Hono()

export const SAFE_WEB_PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'plan',
  'auto',
])

const PRIVILEGED_WEB_PERMISSION_MODES = new Set([
  'bypassPermissions',
  'dontAsk',
])

function isDangerousPermissionModeAuthorized(c: Context): boolean {
  const cfgFlag = (config as { allowDangerousPermissionModes?: boolean })
    .allowDangerousPermissionModes
  const serverAllowed =
    cfgFlag === true || process.env.RCS_ALLOW_DANGEROUS_PERMISSION_MODES === '1'
  return serverAllowed && hasValidApiKey(c)
}

function hasValidApiKey(c: Context): boolean {
  const bearer = extractBearerToken(c)
  return !!bearer && validateApiKey(bearer)
}

/** POST /web/sessions — Create a session from web UI */
app.post('/sessions', requireJsonContentType, uuidAuth, async c => {
  const uuid = c.get('uuid')!
  const body = await c.req.json()
  const requestedMode =
    body.permission_mode === undefined ? 'default' : body.permission_mode
  if (typeof requestedMode !== 'string') {
    return c.json(
      {
        error: {
          type: 'invalid_request',
          message: 'permission_mode must be a string',
        },
      },
      400,
    )
  }
  if (!SAFE_WEB_PERMISSION_MODES.has(requestedMode)) {
    if (PRIVILEGED_WEB_PERMISSION_MODES.has(requestedMode)) {
      if (!isDangerousPermissionModeAuthorized(c)) {
        return c.json(
          {
            error: {
              type: 'forbidden',
              message: `permission_mode '${requestedMode}' is not allowed on web sessions without explicit API key and server authorization`,
            },
          },
          403,
        )
      }
    } else {
      return c.json(
        {
          error: {
            type: 'invalid_request',
            message: `Invalid permission_mode '${requestedMode}'`,
          },
        },
        400,
      )
    }
  }
  if (body.environment_id) {
    const env = storeGetEnvironment(body.environment_id)
    if (env?.workerType === 'acp') {
      return c.json(
        {
          error: {
            type: 'invalid_request',
            message:
              'Cannot create a web session on an ACP environment; open the ACP agent session directly',
          },
        },
        400,
      )
    }
  }
  const session = createSession({
    environment_id: body.environment_id || null,
    title: body.title || 'New Session',
    source: 'web',
    permission_mode: requestedMode,
  })

  // Auto-bind to creator's UUID
  storeBindSession(session.id, uuid)

  // Dispatch work to environment if specified
  if (body.environment_id) {
    try {
      await createWorkItem(body.environment_id, session.id)
    } catch (err) {
      logError(`[RCS] Failed to create work item: ${(err as Error).message}`)
    }
  }

  return c.json(session, 200)
})

/** GET /web/sessions — List sessions owned by the requesting UUID */
app.get('/sessions', uuidAuth, async c => {
  const uuid = c.get('uuid')!
  const sessions = listWebSessionsByOwnerUuid(uuid)
  return c.json(sessions, 200)
})

/** GET /web/sessions/all — List sessions owned by the requesting UUID (unowned sessions excluded) */
app.get('/sessions/all', uuidAuth, async c => {
  const uuid = c.get('uuid')!
  const sessions = listWebSessionSummariesByOwnerUuid(uuid)
  return c.json(sessions, 200)
})

/** GET /web/sessions/:id — Session detail */
app.get('/sessions/:id', uuidAuth, async c => {
  const uuid = c.get('uuid')!
  const apiKeyAuthd = hasValidApiKey(c)
  const sessionId = resolveReadableWebSessionId(c.req.param('id')!, uuid, {
    hasApiKey: apiKeyAuthd,
  })
  if (!sessionId) {
    return c.json(
      { error: { type: 'forbidden', message: 'Not your session' } },
      403,
    )
  }
  const session = getSession(sessionId)
  if (!session) {
    return c.json(
      { error: { type: 'not_found', message: 'Session not found' } },
      404,
    )
  }
  const response = toWebSessionResponse(session)
  // For shared ACP discovery without ownership or API key, return only routing metadata
  if (
    session.source === 'acp' &&
    !apiKeyAuthd &&
    !storeIsSessionOwner(sessionId, uuid)
  ) {
    return c.json(response, 200)
  }
  const worker = storeGetSessionWorker(sessionId)
  const automationState = getAutomationStateSnapshot(worker?.externalMetadata)
  return c.json(
    automationState === undefined
      ? response
      : { ...response, automation_state: automationState },
    200,
  )
})

/** GET /web/sessions/:id/history — Historical events for session */
app.get('/sessions/:id/history', uuidAuth, async c => {
  const uuid = c.get('uuid')!
  const sessionId = resolveOwnedWebSessionId(c.req.param('id')!, uuid, {
    hasApiKey: hasValidApiKey(c),
  })
  if (!sessionId) {
    return c.json(
      { error: { type: 'forbidden', message: 'Not your session' } },
      403,
    )
  }
  const session = getSession(sessionId)
  if (!session) {
    return c.json(
      { error: { type: 'not_found', message: 'Session not found' } },
      404,
    )
  }

  const bus = getEventBus(sessionId)
  const events = bus.getEventsSince(0)
  return c.json({ events }, 200)
})

/** SSE /web/sessions/:id/events — Real-time event stream */
app.get('/sessions/:id/events', uuidAuth, async c => {
  const uuid = c.get('uuid')!
  const sessionId = resolveOwnedWebSessionId(c.req.param('id')!, uuid, {
    hasApiKey: hasValidApiKey(c),
  })
  if (!sessionId) {
    return c.json(
      { error: { type: 'forbidden', message: 'Not your session' } },
      403,
    )
  }
  const session = getSession(sessionId)
  if (!session) {
    return c.json(
      { error: { type: 'not_found', message: 'Session not found' } },
      404,
    )
  }
  if (isSessionClosedStatus(session.status)) {
    return c.json(
      {
        error: {
          type: 'session_closed',
          message: `Session is ${session.status}`,
        },
      },
      409,
    )
  }

  const parsePositiveSeq = (val: string | undefined): number => {
    if (!val) return 0
    const parsed = Number.parseInt(val, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }
  const fromSeqNum = Math.max(
    parsePositiveSeq(c.req.header('Last-Event-ID')),
    parsePositiveSeq(c.req.query('from_sequence_num')),
  )
  return createSSEStream(c, sessionId, fromSeqNum)
})

export default app
