/**
 * densable 2.1.289 session origin tags + kLe/abr + t3e role parse.
 *
 * Gold: SEA export `Ahn`/`W2o`/`G2o`/`yXe` + `hearth-rc-child`;
 * `kLe`/`abr` via getBridgeSessionOrStatus; `t3e(tags)`.
 * Do **not** export minify names.
 */

import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { getBridgeBaseUrl } from './bridgeConfig.js'
import {
  getBridgeSessionWithNotFound,
  type BridgeSessionInfo,
} from './createSession.js'

/** densable `Ahn` */
export const REMOTE_CONTROL_CLI_TAG = 'remote-control-cli'
/** densable `W2o` */
export const RC_CHILD_TAG = 'rc-child'
/** densable `G2o` */
export const REMOTE_CONTROL_APP_TAG = 'remote-control-app'
/** densable `yXe` — excludes attended when present with app/cli tags. */
export const WORKFLOW_REMOTE_AGENT_TAG = 'workflow-remote-agent'
/** densable project-thread child tag (not W2o). */
export const HEARTH_RC_CHILD_TAG = 'hearth-rc-child'

/** densable attended probe set `g = [G2o, Ahn]`. */
const ATTENDED_ORIGIN_TAGS = new Set([
  REMOTE_CONTROL_APP_TAG,
  REMOTE_CONTROL_CLI_TAG,
])

export type SessionOriginRoles = {
  tagsRead: boolean
  rcChild: boolean
  projectThreadChild: boolean
  attended: boolean
}

/**
 * densable `t3e(tags|null)`.
 */
export function parseSessionOriginRoles(
  tags: string[] | null | undefined,
): SessionOriginRoles {
  if (tags === null || tags === undefined) {
    return {
      tagsRead: false,
      rcChild: false,
      projectThreadChild: false,
      attended: false,
    }
  }
  const projectThreadChild = tags.includes(HEARTH_RC_CHILD_TAG)
  const rcChild = tags.includes(RC_CHILD_TAG)
  const attended =
    tags.some(tag => ATTENDED_ORIGIN_TAGS.has(tag)) &&
    !rcChild &&
    !tags.includes(WORKFLOW_REMOTE_AGENT_TAG)
  return {
    tagsRead: true,
    rcChild,
    projectThreadChild,
    attended,
  }
}

export type ReadBridgeSessionTagsOpts = {
  baseUrl?: string
  getAccessToken?: () =>
    | string
    | undefined
    | null
    | Promise<string | undefined | null>
  credentials?: unknown
}

export type BridgeSessionTagsRead = {
  tags: string[]
  createdAtMs?: number
}

/**
 * densable `abr` — GET session and return tags + createdAtMs, or null.
 */
export async function readBridgeSessionTagsMeta(
  sessionId: string,
  opts: ReadBridgeSessionTagsOpts = {},
): Promise<BridgeSessionTagsRead | null> {
  try {
    let getAccessToken: (() => string | undefined) | undefined
    if (opts.getAccessToken) {
      const maybe = await opts.getAccessToken()
      const token = maybe ?? undefined
      getAccessToken = () => token
    }
    const { session } = await getBridgeSessionWithNotFound(sessionId, {
      baseUrl: opts.baseUrl ?? getBridgeBaseUrl(),
      getAccessToken,
    })
    void opts.credentials
    if (!session || !Array.isArray(session.tags)) return null
    const createdAtMs =
      typeof session.created_at === 'string'
        ? Date.parse(session.created_at)
        : Number.NaN
    return {
      tags: session.tags.filter((t): t is string => typeof t === 'string'),
      ...(Number.isNaN(createdAtMs) ? {} : { createdAtMs }),
    }
  } catch (err) {
    logForDebugging(
      `[bridge:session] session tag read failed: ${errorMessage(err)}`,
      { level: 'warn' },
    )
    return null
  }
}

/**
 * densable `kLe` — tags array or null.
 */
export async function readBridgeSessionTags(
  sessionId: string,
  opts: ReadBridgeSessionTagsOpts = {},
): Promise<string[] | null> {
  return (await readBridgeSessionTagsMeta(sessionId, opts))?.tags ?? null
}

/** densable alias surface — same return as getBridgeSessionWithNotFound. */
export async function getBridgeSessionOrStatus(
  sessionId: string,
  opts?: {
    baseUrl?: string
    getAccessToken?: () => string | undefined
    credentials?: unknown
    useV2?: boolean
  },
): Promise<{ session: BridgeSessionInfo | null; notFound: boolean }> {
  void opts?.credentials
  void opts?.useV2
  return getBridgeSessionWithNotFound(sessionId, {
    baseUrl: opts?.baseUrl,
    getAccessToken: opts?.getAccessToken,
  })
}
