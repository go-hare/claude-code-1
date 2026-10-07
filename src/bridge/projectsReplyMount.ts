/**
 * densable 2.1.289 `uur` — bridge projects hearthbot reply MCP mount.
 *
 * Gold: `/tmp/gold289-extract/oee_bridge_projects_mcp_mount.txt`
 * Do **not** export minify `uur` / `kc` / `OEe`.
 */

import type { AppState } from '../state/AppStateStore.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import {
  clearServerCache,
  detachAndCloseConnection,
  reconnectMcpServerImpl,
} from '../services/mcp/client.js'
import { markCliOwnedConfig } from '../services/mcp/cliOwnedConfigs.js'
import {
  getMcpPrefix,
  buildMcpToolName,
} from '../services/mcp/mcpStringUtils.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../services/mcp/types.js'
import {
  commandBelongsToServer,
  toolBelongsToServer,
} from '../services/mcp/utils.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { applyPermissionUpdate } from '../utils/permissions/PermissionUpdate.js'
import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from '../utils/permissions/permissionRuleParser.js'
import type { HearthBinding } from './hearthBinding.js'
import { parseHearthBinding } from './hearthBinding.js'
import {
  HEARTHBOT_MCP_SERVER_NAME,
  createHearthbotHttpConfig,
} from './hearthbotMcp.js'

/** densable retry ladder `Y`. */
export const PROJECTS_REPLY_MOUNT_RETRY_MS = [
  500, 1500, 4000, 15000, 60000,
] as const

const NON_RETRYABLE_ERROR_CODES = new Set([
  'CLI_OWNED_BEARER_REJECTED',
  'POLICY_BLOCKED',
  'APPROVAL_REQUIRED',
  'DISABLED',
  'IDENTITY_CHANGED',
  'SHUTTING_DOWN',
])

export type ProjectsReplyMountStores = {
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  getDynamicMcpState: () => {
    clients: MCPServerConnection[]
    configs?: Record<string, ScopedMcpServerConfig>
  }
}

export type ReadHearthBindingResult =
  | { read: false }
  | { read: true; assertion: unknown }

export type ProjectsReplyMountDeps = {
  stores: ProjectsReplyMountStores
  storageV5?: unknown
  credentials?: unknown
  sessionId: string
  apiBaseUrl: string
  getBearerToken: () => string | null | undefined
  getWorkerEpoch?: () => number
  readHearthBinding: () => Promise<ReadHearthBindingResult>
  sdkHostConfigs: () => Record<string, unknown>
  /** tests inject reconnect */
  reconnect?: typeof reconnectMcpServerImpl
  clearCache?: typeof clearServerCache
}

export type ProjectsReplyMountHandle = {
  sync: (reason: string) => Promise<void>
  drop: () => Promise<void>
  reassertOwnership: () => void
  suspendAllowsForApply: (configs: Record<string, unknown>) => void
  reassertAfterApply: () => void
  current: () => HearthBinding | null
  projectFilesDoor: () => {
    channelId: string
    sessionId: string
    apiBaseUrl: string
    getBearerToken: () => string | null | undefined
    getWorkerEpoch: () => number
  } | null
}

type MountRow = {
  binding: HearthBinding
  config: ScopedMcpServerConfig
  allowRules: string[]
}

type ApplyOutcome = 'applied' | 'superseded' | 'dropped' | 'refused'

function countSessionAllow(state: AppState, rule: string): number {
  const session = state.toolPermissionContext.alwaysAllowRules.session ?? []
  return session.filter(r => r === rule).length
}

function isRetryableFailed(client: MCPServerConnection): boolean {
  return (
    client.type === 'failed' &&
    !NON_RETRYABLE_ERROR_CODES.has(
      (client as { errorCode?: string }).errorCode ?? '',
    )
  )
}

/**
 * densable `uur(deps)` — create projects reply mount controller.
 */
export function createProjectsReplyMount(
  deps: ProjectsReplyMountDeps,
): ProjectsReplyMountHandle {
  const { getAppState, setAppState, getDynamicMcpState } = deps.stores
  const reconnect = deps.reconnect ?? reconnectMcpServerImpl
  const clearCache = deps.clearCache ?? clearServerCache
  const getWorkerEpoch = deps.getWorkerEpoch ?? (() => 0)

  let row: MountRow | null = null
  let chain: Promise<void> = Promise.resolve()
  let allowsSuspended = false
  let dropped = false
  let retryIndex = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  function resetRetry(): void {
    retryIndex = 0
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function scheduleRetry(): boolean {
    if (dropped) return false
    if (retryTimer !== null) return true
    const delay = PROJECTS_REPLY_MOUNT_RETRY_MS[retryIndex]
    if (delay === undefined) {
      logForDebugging(
        '[bridge:projects] reply mount retries exhausted — the mount stays as it is until the binding changes',
        { level: 'warn' },
      )
      return false
    }
    retryIndex += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      void sync('retry')
    }, delay)
    retryTimer.unref?.()
    return true
  }

  function retractAllows(rules: string[]): void {
    if (rules.length === 0) return
    setAppState(prev => {
      const session = [
        ...(prev.toolPermissionContext.alwaysAllowRules.session ?? []),
      ]
      for (const rule of rules) {
        const idx = session.indexOf(rule)
        if (idx !== -1) session.splice(idx, 1)
      }
      return {
        ...prev,
        toolPermissionContext: {
          ...prev.toolPermissionContext,
          alwaysAllowRules: {
            ...prev.toolPermissionContext.alwaysAllowRules,
            session,
          },
        },
      }
    })
  }

  function addAllows(rules: string[]): string[] {
    if (dropped || rules.length === 0) return []
    const before = new Map(
      rules.map(r => [r, countSessionAllow(getAppState(), r)]),
    )
    setAppState(prev => ({
      ...prev,
      toolPermissionContext: applyPermissionUpdate(prev.toolPermissionContext, {
        type: 'addRules',
        destination: 'session',
        behavior: 'allow',
        rules: rules.map(permissionRuleValueFromString),
      }),
    }))
    return rules.filter(
      r => countSessionAllow(getAppState(), r) > (before.get(r) ?? 0),
    )
  }

  function syncAllows(mount: MountRow, binding: HearthBinding): void {
    if (allowsSuspended) return
    const next = binding.autoAllowTools.map(leaf =>
      permissionRuleValueToString({
        toolName: buildMcpToolName(HEARTHBOT_MCP_SERVER_NAME, leaf),
      }),
    )
    const nextSet = new Set(next)
    const prevSet = new Set(mount.allowRules)
    const remove = mount.allowRules.filter(r => !nextSet.has(r))
    if (remove.length > 0) retractAllows(remove)
    const keep = mount.allowRules.filter(r => nextSet.has(r))
    const added = addAllows(next.filter(r => !prevSet.has(r)))
    mount.allowRules = [...keep, ...added]
  }

  function nameHeldBySdkHost(): boolean {
    return Object.hasOwn(deps.sdkHostConfigs(), HEARTHBOT_MCP_SERVER_NAME)
  }

  function reassertOwnership(): void {
    if (!row) return
    const client = getAppState().mcp.clients.find(
      c => c.name === HEARTHBOT_MCP_SERVER_NAME,
    )
    if (client && client.config === row.config && !nameHeldBySdkHost()) {
      if (!allowsSuspended) syncAllows(row, row.binding)
      return
    }
    logForDebugging(
      "[bridge:projects] the reply mount's name is no longer held by its own row — retracting its pre-approvals",
      { level: 'warn' },
    )
    const gone = row
    row = null
    void unmount(gone)
  }

  async function unmount(mount: MountRow): Promise<void> {
    retractAllows(mount.allowRules)
    mount.allowRules = []
    const client = getAppState().mcp.clients.find(
      c => c.name === HEARTHBOT_MCP_SERVER_NAME,
    )
    if (client && client.config !== mount.config) {
      await clearCache(HEARTHBOT_MCP_SERVER_NAME, mount.config).catch(err => {
        logForDebugging(
          `[bridge:projects] reply mount cleanup failed: ${errorMessage(err)}`,
          { level: 'warn' },
        )
      })
      return
    }
    const prefix = getMcpPrefix(HEARTHBOT_MCP_SERVER_NAME)
    setAppState(prev => {
      const { [HEARTHBOT_MCP_SERVER_NAME]: _r, ...resources } =
        prev.mcp.resources
      const { [HEARTHBOT_MCP_SERVER_NAME]: _t, ...resourceTemplates } =
        prev.mcp.resourceTemplates
      return {
        ...prev,
        mcp: {
          ...prev.mcp,
          clients: prev.mcp.clients.filter(c => c !== client),
          tools: prev.mcp.tools.filter(
            t => !toolBelongsToServer(t, HEARTHBOT_MCP_SERVER_NAME, prefix),
          ),
          commands: prev.mcp.commands.filter(
            c => !commandBelongsToServer(c, HEARTHBOT_MCP_SERVER_NAME),
          ),
          resources,
          resourceTemplates,
        },
      }
    })
    await clearCache(HEARTHBOT_MCP_SERVER_NAME, mount.config).catch(err => {
      logForDebugging(
        `[bridge:projects] reply mount cleanup failed: ${errorMessage(err)}`,
        { level: 'warn' },
      )
    })
  }

  function applySettlement(settlement: {
    client: MCPServerConnection
    tools: AppState['mcp']['tools']
    commands: AppState['mcp']['commands']
  }): ApplyOutcome {
    const name = HEARTHBOT_MCP_SERVER_NAME
    if (!row || row.config !== settlement.client.config) {
      if (settlement.client.type === 'connected') {
        void detachAndCloseConnection(settlement.client)
      }
      return 'superseded'
    }
    setAppState(prev => {
      const present = prev.mcp.clients.some(c => c.name === name)
      const prefix = getMcpPrefix(name)
      return {
        ...prev,
        mcp: {
          ...prev.mcp,
          clients: present
            ? prev.mcp.clients.map(c =>
                c.name === name ? settlement.client : c,
              )
            : [...prev.mcp.clients, settlement.client],
          tools: [
            ...prev.mcp.tools.filter(
              t => !toolBelongsToServer(t, name, prefix),
            ),
            ...settlement.tools,
          ],
          commands: [
            ...prev.mcp.commands.filter(c => !commandBelongsToServer(c, name)),
            ...settlement.commands,
          ],
        },
      }
    })
    return 'applied'
  }

  async function dial(binding: HearthBinding): Promise<void> {
    const appHas = getAppState().mcp.clients.some(
      c => c.name === HEARTHBOT_MCP_SERVER_NAME,
    )
    const dyn = getDynamicMcpState()
    if (
      appHas ||
      (dyn.configs !== undefined && HEARTHBOT_MCP_SERVER_NAME in dyn.configs) ||
      nameHeldBySdkHost()
    ) {
      logForDebugging(
        `[bridge:projects] reply mount skipped: a server named ${HEARTHBOT_MCP_SERVER_NAME} is already configured`,
        { level: 'warn' },
      )
      logEvent('bridge_projects_mcp_mount', {
        status:
          'name_taken' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return
    }

    const owned = markCliOwnedConfig(
      {
        ...createHearthbotHttpConfig(binding.mountUrl, deps.sessionId),
        scope: 'dynamic' as const,
        role: 'comms' as const,
      },
      { getBearerToken: deps.getBearerToken },
    ) as ScopedMcpServerConfig & { role: 'comms' }

    const mount: MountRow = {
      binding,
      config: owned,
      allowRules: [],
    }
    row = mount
    setAppState(prev => ({
      ...prev,
      mcp: {
        ...prev.mcp,
        clients: [
          ...prev.mcp.clients.filter(c => c.name !== HEARTHBOT_MCP_SERVER_NAME),
          {
            name: HEARTHBOT_MCP_SERVER_NAME,
            type: 'pending',
            config: owned,
          },
        ],
      },
    }))
    if (!allowsSuspended) {
      mount.allowRules = addAllows(
        binding.autoAllowTools.map(leaf =>
          permissionRuleValueToString({
            toolName: buildMcpToolName(HEARTHBOT_MCP_SERVER_NAME, leaf),
          }),
        ),
      )
    }
    await connectMount(mount)
  }

  async function connectMount(mount: MountRow): Promise<void> {
    let settlement: {
      client: MCPServerConnection
      tools: AppState['mcp']['tools']
      commands: AppState['mcp']['commands']
    }
    try {
      const result = await reconnect(
        HEARTHBOT_MCP_SERVER_NAME,
        mount.config,
        deps.storageV5 as never,
        deps.credentials as never,
      )
      settlement = {
        client: result.client,
        tools: result.tools ?? [],
        commands: result.commands ?? [],
      }
    } catch (err) {
      logForDebugging(
        `[bridge:projects] reply mount connect threw: ${errorMessage(err)}`,
        { level: 'warn' },
      )
      settlement = {
        client: {
          name: HEARTHBOT_MCP_SERVER_NAME,
          type: 'failed',
          config: mount.config,
          error: 'Connection failed',
        },
        tools: [],
        commands: [],
      }
    }
    if (row !== mount) {
      if (settlement.client.type === 'connected') {
        await detachAndCloseConnection(settlement.client)
      }
      return
    }
    const outcome = applySettlement(settlement)
    if (outcome !== 'applied') {
      logEvent('bridge_projects_mcp_mount', {
        status:
          outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      reassertOwnership()
      return
    }
    if (settlement.client.type === 'connected') {
      resetRetry()
      logEvent('bridge_projects_mcp_mount', {
        status:
          'connected' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } else if (isRetryableFailed(settlement.client)) {
      if (scheduleRetry()) {
        logEvent('bridge_projects_mcp_mount', {
          status:
            'settled_failed_retrying' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      } else {
        logEvent('bridge_projects_mcp_mount', {
          status:
            'settled_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }
    } else {
      const code =
        settlement.client.type === 'failed'
          ? ((settlement.client as { errorCode?: string }).errorCode ??
            'answered')
          : settlement.client.type
      logEvent('bridge_projects_mcp_mount', {
        status:
          `settled_${String(code).toLowerCase()}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  }

  async function converge(reason: string): Promise<void> {
    if (dropped) return
    if (reason === 'binding_changed') resetRetry()
    const read = await deps.readHearthBinding()
    if (dropped) return
    if (!read.read) {
      logForDebugging(
        `[bridge:projects] binding read did not answer (${reason}) — mount left as is`,
        { level: 'warn' },
      )
      const client = getAppState().mcp.clients.find(
        c => c.name === HEARTHBOT_MCP_SERVER_NAME,
      )
      if (!row || (client !== undefined && isRetryableFailed(client))) {
        scheduleRetry()
      }
      return
    }
    // gold: pur({hearth:o.assertion}, ...)
    let parsed = parseHearthBinding(
      { hearth: read.assertion },
      { apiBaseUrl: deps.apiBaseUrl, sessionId: deps.sessionId },
    )
    if (parsed.binding === null) {
      // assertion may already be the full {hearth} envelope or raw hearth blob
      parsed = parseHearthBinding(read.assertion, {
        apiBaseUrl: deps.apiBaseUrl,
        sessionId: deps.sessionId,
      })
    }
    if (!parsed.binding) {
      resetRetry()
      if (row) {
        logForDebugging(
          `[bridge:projects] binding gone (${parsed.reason}, ${reason}) — dropping the reply mount`,
        )
        const gone = row
        row = null
        await unmount(gone)
      }
      return
    }
    reassertOwnership()
    if (row && row.binding.mountUrl === parsed.binding.mountUrl) {
      const client = getAppState().mcp.clients.find(
        c => c.name === HEARTHBOT_MCP_SERVER_NAME,
      )
      if (
        client !== undefined &&
        client.config === row.config &&
        isRetryableFailed(client)
      ) {
        logForDebugging(
          `[bridge:projects] the reply mount's dial had failed — dialing again (${reason})`,
        )
        const gone = row
        row = null
        await unmount(gone)
        if (dropped) return
        await dial(parsed.binding)
        return
      }
      if (row) {
        syncAllows(row, parsed.binding)
        row.binding = parsed.binding
      }
      return
    }
    logForDebugging(
      `[bridge:projects] joined to a project thread (${reason}) — mounting the reply server`,
    )
    await dial(parsed.binding)
  }

  function sync(reason: string): Promise<void> {
    chain = chain
      .then(() => converge(reason))
      .catch(err => {
        logForDebugging(
          `[bridge:projects] converge (${reason}) threw: ${errorMessage(err)}`,
          { level: 'warn' },
        )
      })
    return chain
  }

  function drop(): Promise<void> {
    dropped = true
    resetRetry()
    if (row) {
      const rules = row.allowRules
      row.allowRules = []
      retractAllows(rules)
    }
    chain = chain
      .then(async () => {
        if (!row) return
        logForDebugging('[bridge:projects] dropping the reply mount')
        const gone = row
        row = null
        await unmount(gone)
      })
      .catch(err => {
        logForDebugging(`[bridge:projects] drop threw: ${errorMessage(err)}`, {
          level: 'warn',
        })
      })
    return chain
  }

  return {
    sync,
    drop,
    reassertOwnership,
    suspendAllowsForApply(configs) {
      if (!Object.hasOwn(configs, HEARTHBOT_MCP_SERVER_NAME)) return
      allowsSuspended = true
      if (!row) return
      const rules = row.allowRules
      row.allowRules = []
      retractAllows(rules)
    },
    reassertAfterApply() {
      allowsSuspended = false
      reassertOwnership()
    },
    current: () => row?.binding ?? null,
    projectFilesDoor: () =>
      row
        ? {
            channelId: row.binding.channelId,
            sessionId: deps.sessionId,
            apiBaseUrl: deps.apiBaseUrl,
            getBearerToken: deps.getBearerToken,
            getWorkerEpoch,
          }
        : null,
  }
}

/** densable export alias — `uur as createHeadlessHearthMount`. */
export const createHeadlessHearthMount = createProjectsReplyMount
