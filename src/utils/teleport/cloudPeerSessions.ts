/**
 * densable 2.1.234 #34 — $sr / D5v cloud peer session list for ListAgents/SendMessage.
 *
 * Soft timeout Bff=5000; truncated bubbled from walkCcrSessionList status.
 * Gate: hasCloudPeerAccess (R5v). Memo is intentionally process-local & short.
 */

import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { hasCloudPeerAccess } from './cloudPeerAccess.js'
import {
  walkCcrSessionList,
  type CcrSessionListRow,
} from './walkCcrSessionList.js'

/** densable Bff */
const CLOUD_PEER_LIST_SOFT_TIMEOUT_MS = 5000
/** densable jff */
const CLOUD_PEER_LIST_MEMO_TTL_MS = 30_000

export type CloudPeerSession = {
  id: string
  title: string | null
  lastActive?: number
  workerStatus?: 'running' | 'idle' | 'requires_action'
  remoteControl?: boolean
}

export type CloudPeerListResult = {
  sessions: CloudPeerSession[]
  unavailable?: 'gate_off' | 'timeout' | 'fetch_failed'
  truncated?: boolean
}

type Memo = {
  at: number
  sessions: CloudPeerSession[]
  truncated: boolean
}

let memo: Memo | undefined
let inFlight: Promise<CloudPeerListResult> | undefined

function mapRow(row: CcrSessionListRow): CloudPeerSession {
  const last = Date.parse(row.last_event_at ?? row.created_at ?? '')
  const ws = row.worker_status
  return {
    id: row.id,
    title: row.title ?? null,
    lastActive: Number.isNaN(last) ? undefined : last,
    workerStatus:
      ws === 'running' || ws === 'idle' || ws === 'requires_action'
        ? ws
        : undefined,
    remoteControl: row.environment_kind === 'bridge',
  }
}

async function fetchCloudPeerSessionsFresh(): Promise<CloudPeerListResult> {
  const status = { truncated: false }
  try {
    const rows = await walkCcrSessionList({
      status,
      throwOnError: true,
      exhaustive: true,
      includeBridgeKind: false,
    })
    const sessions = rows.map(mapRow)
    memo = {
      at: Date.now(),
      sessions,
      truncated: status.truncated,
    }
    return {
      sessions,
      unavailable: undefined,
      ...(status.truncated ? { truncated: true } : {}),
    }
  } catch (err) {
    logForDebugging(`[agents:cloud] session list threw: ${errorMessage(err)}`)
    return { sessions: [], unavailable: 'fetch_failed' }
  }
}

/**
 * densable $sr — gated cloud peer list with soft timeout + short memo.
 */
export async function listCloudPeerSessions(): Promise<CloudPeerListResult> {
  if (!hasCloudPeerAccess()) {
    return { sessions: [], unavailable: 'gate_off' }
  }
  if (
    memo !== undefined &&
    Date.now() - memo.at < CLOUD_PEER_LIST_MEMO_TTL_MS
  ) {
    return {
      sessions: memo.sessions,
      unavailable: undefined,
      ...(memo.truncated ? { truncated: true } : {}),
    }
  }
  const pending = inFlight ?? fetchCloudPeerSessionsFresh()
  if (!inFlight) {
    inFlight = pending.finally(() => {
      inFlight = undefined
    })
  }
  const raced = await Promise.race([
    pending,
    new Promise<undefined>(resolve => {
      setTimeout(() => resolve(undefined), CLOUD_PEER_LIST_SOFT_TIMEOUT_MS)
    }),
  ])
  if (raced === undefined) {
    logForDebugging(
      `[agents:cloud] session list not ready within ${CLOUD_PEER_LIST_SOFT_TIMEOUT_MS}ms — not searched this call, disclosing`,
    )
    return { sessions: [], unavailable: 'timeout' }
  }
  return raced
}

/** densable bWr */
export function isCloudListFailed(
  unavailable: CloudPeerListResult['unavailable'],
): boolean {
  return unavailable === 'timeout' || unavailable === 'fetch_failed'
}

/** @internal */
export function __resetCloudPeerSessionsMemoForTests(): void {
  memo = undefined
  inFlight = undefined
}
