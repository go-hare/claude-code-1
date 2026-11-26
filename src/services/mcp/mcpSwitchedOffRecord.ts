/**
 * Official `class MS` + `AS(e)` (#1600):
 * Tracks per-session disabled MCP servers across CCR/self-hosted worker
 * restarts (`disabled_mcp_servers`, `mcp_switched_off_record`, `foundLate`,
 * `switchedOnWhileUnread`).
 */

import { logEvent } from '../analytics/index.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { HostSlot, getBootstrapSessionHost } from '../../utils/sessionRoot.js'

export const MCP_SWITCHED_OFF_MAX_SERVERS = 64
export const MCP_SWITCHED_OFF_MAX_NAME_LENGTH = 256
export const MCP_SWITCHED_OFF_CLOSE_TIMEOUT_MS = 5000

const RESERVED_MCP_NAMES = new Set(['claude-in-chrome'])

/**
 * Official `OP()` — remote BYOC/self-hosted worker sessions persist switched-off
 * MCP servers via `internal_metadata.disabled_mcp_servers` across restarts.
 */
export function isMcpSwitchedOffRecordKept(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isEnvTruthy(env.CLAUDE_CODE_REMOTE) &&
    env.CLAUDE_CODE_ENVIRONMENT_KIND === 'byoc'
  )
}

/**
 * Official `AS(e)` — sanitize `disabled_mcp_servers` list: keep non-empty
 * non-reserved strings <= 256 chars, deduplicate keeping most recent order,
 * and cap to last 64 entries.
 */
export function sanitizeDisabledMcpServers(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  for (const item of list) {
    if (
      typeof item === 'string' &&
      item.length > 0 &&
      item.length <= MCP_SWITCHED_OFF_MAX_NAME_LENGTH &&
      !RESERVED_MCP_NAMES.has(item)
    ) {
      seen.delete(item)
      seen.add(item)
    }
  }
  return [...seen].slice(-MCP_SWITCHED_OFF_MAX_SERVERS)
}

export type RestoredWorkerMcpState = {
  readFailed?: boolean
  internal?: {
    disabled_mcp_servers?: unknown
  } | null
} | null

export type McpSwitchedOffRecordIO = {
  restoredWorkerState: Promise<RestoredWorkerMcpState>
  rereadWorkerState: () => Promise<RestoredWorkerMcpState>
  sessionState: {
    notifyInternalMetadataChanged: (patch: {
      disabled_mcp_servers: string[] | null
    }) => void
  }
}

export type McpSwitchedOffRecordClient = {
  name: string
  type: string
  config: unknown
}

export type McpSwitchedOffRestoreHooks = {
  isKept?: boolean
  saveDisabledServers: (servers: string[]) => void | Promise<void>
  getDisabledServers: () => readonly string[]
  getClients: () => readonly McpSwitchedOffRecordClient[]
  closeClient: (
    name: string,
    config: unknown,
    isStillSwitchedOff: () => boolean,
  ) => Promise<void>
  dropClientTools?: (name: string) => void
  closeTimeoutMs?: number
}

function asMeta(value: string) {
  return value as import('../analytics/index.js').AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

export class McpSwitchedOffRecord {
  readonly io: McpSwitchedOffRecordIO
  isKept: boolean
  isUnread = false
  readonly switchedOnWhileUnread = new Set<string>()
  readonly foundLate = new Set<string>()
  readonly switchedOffByThisWorker = new Set<string>()
  private readonly getDisabledServers: () => readonly string[]

  constructor(
    io: McpSwitchedOffRecordIO,
    opts?: {
      isKept?: boolean
      getDisabledServers?: () => readonly string[]
    },
  ) {
    this.io = io
    this.isKept = opts?.isKept ?? true
    this.getDisabledServers = opts?.getDisabledServers ?? (() => [])
  }

  async restore(hooks: McpSwitchedOffRestoreHooks): Promise<void> {
    if (!this.isKept) return
    const restored = await this.io.restoredWorkerState
    if (restored === null) {
      this.isKept = false
      return
    }
    if (restored.readFailed === true) {
      this.isUnread = true
      logEvent('mcp_switched_off_record', { reason: asMeta('unread_at_boot') })
      return
    }
    const disabledSet = new Set(
      sanitizeDisabledMcpServers(restored.internal?.disabled_mcp_servers),
    )
    if (disabledSet.size === 0) return

    try {
      await hooks.saveDisabledServers([...disabledSet])
    } catch (err) {
      logForDebugging(
        `[MCP] failed to restore switched-off servers: ${err instanceof Error ? err.message : String(err)}`,
      )
      logEvent('mcp_switched_off_record', { reason: asMeta('save_failed') })
      return
    }

    for (const name of disabledSet) {
      this.switchedOffByThisWorker.add(name)
    }

    const timeoutMs = hooks.closeTimeoutMs ?? MCP_SWITCHED_OFF_CLOSE_TIMEOUT_MS
    const timedOut = new Set<string>()
    const activeToClose = hooks
      .getClients()
      .filter(c => disabledSet.has(c.name) && c.type !== 'disabled')

    await Promise.all(
      activeToClose.map(async client => {
        let finished = false
        try {
          await Promise.race([
            hooks
              .closeClient(client.name, client.config, () =>
                this.switchedOffByThisWorker.has(client.name),
              )
              .finally(() => {
                finished = true
              }),
            new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
          ])
        } catch (err) {
          logForDebugging(
            `[MCP] close switched-off server ${client.name} failed: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
        if (!finished) {
          timedOut.add(client.name)
        }
      }),
    )

    const remaining = hooks
      .getClients()
      .filter(c => disabledSet.has(c.name) && c.type !== 'disabled')
    for (const client of remaining) {
      hooks.dropClientTools?.(client.name)
    }
    if (remaining.length === 0) {
      logEvent('mcp_switched_off_record', { server_count: disabledSet.size })
      return
    }
    if (remaining.some(c => timedOut.has(c.name))) {
      logEvent('mcp_switched_off_record', {
        reason: asMeta('close_timed_out'),
      })
    }
    if (remaining.some(c => !timedOut.has(c.name))) {
      logEvent('mcp_switched_off_record', { reason: asMeta('close_failed') })
    }
  }

  switchSaved(serverName: string, enabled: boolean): void {
    if (!this.isKept) return
    this.switchedOffByThisWorker.delete(serverName)
    if (enabled) {
      this.foundLate.delete(serverName)
    } else if (this.getDisabledServers().includes(serverName)) {
      this.switchedOffByThisWorker.add(serverName)
    }
    if (!this.isUnread) {
      this.write()
      return
    }
    if (enabled) {
      this.switchedOnWhileUnread.add(serverName)
    } else {
      this.switchedOnWhileUnread.delete(serverName)
    }
    void this.readThenWrite()
  }

  async readThenWrite(): Promise<void> {
    const state = await this.io.rereadWorkerState().catch(() => null)
    if (state === null || state.readFailed === true) {
      logEvent('mcp_switched_off_record', {
        reason: asMeta('unread_at_switch'),
      })
      return
    }
    if (this.isUnread) {
      this.isUnread = false
      for (const name of sanitizeDisabledMcpServers(
        state.internal?.disabled_mcp_servers,
      )) {
        if (!this.switchedOnWhileUnread.has(name)) {
          this.foundLate.add(name)
        }
      }
      this.switchedOnWhileUnread.clear()
    }
    this.write()
  }

  write(): void {
    try {
      const merged = sanitizeDisabledMcpServers([
        ...this.foundLate,
        ...this.getDisabledServers(),
        ...this.switchedOffByThisWorker,
      ])
      this.io.sessionState.notifyInternalMetadataChanged({
        disabled_mcp_servers: merged.length > 0 ? merged : null,
      })
    } catch (err) {
      logForDebugging(
        `[MCP] failed to write disabled_mcp_servers: ${err instanceof Error ? err.message : String(err)}`,
      )
      logEvent('mcp_switched_off_record', { reason: asMeta('write_failed') })
    }
  }
}

type HostMcpSwitchedOffState = {
  activeRecord: McpSwitchedOffRecord | null
}

const hostMcpSwitchedOffSlot = new HostSlot<HostMcpSwitchedOffState>(() => ({
  activeRecord: null,
}))

function getHostMcpSwitchedOffState(): HostMcpSwitchedOffState {
  return hostMcpSwitchedOffSlot.of(getBootstrapSessionHost())
}

export function getActiveMcpSwitchedOffRecord(): McpSwitchedOffRecord | null {
  return getHostMcpSwitchedOffState().activeRecord
}

export function setActiveMcpSwitchedOffRecord(
  record: McpSwitchedOffRecord | null,
): void {
  getHostMcpSwitchedOffState().activeRecord = record
}

export function notifyMcpSwitchedOffSaved(
  serverName: string,
  enabled: boolean,
): void {
  getHostMcpSwitchedOffState().activeRecord?.switchSaved(serverName, enabled)
}
