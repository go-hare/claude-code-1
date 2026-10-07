/**
 * densable 2.1.289 `vt` slice — bridge server-config meta MCP mount + hearth
 * reply mount coupling (`createHeadlessWorkSecretSession` shape).
 *
 * Gold: `/tmp/gold289-extract/oee_bridge_server_config_meta.txt`
 * Do **not** export minify `vt` / `pp` / `A` / `le`.
 */

import type { AppState } from '../state/AppStateStore.js'
import type { ToolPermissionContext } from '../Tool.js'
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
  buildMcpToolName,
  getMcpPrefix,
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
import {
  attachBridgeChildGrants,
  type BridgeChildGrantsHandle,
  isBridgeApplyServerSessionConfigGate,
} from './bridgeChildGrants.js'
import { getBridgeBaseUrl } from './bridgeConfig.js'
import {
  deriveBridgeServerSessionConfig,
  extractServerConfigEffort,
  extractServerConfigModel,
  type DeriveServerSessionConfigInput,
} from './deriveServerSessionConfig.js'
import {
  CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
  createRemoteMetaHttpConfig,
} from './hearthbotMcp.js'
import {
  createProjectsReplyMount,
  type ProjectsReplyMountDeps,
  type ProjectsReplyMountHandle,
} from './projectsReplyMount.js'

export type ServerConfigSessionStores = {
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  getDynamicMcpState: () => {
    clients: MCPServerConnection[]
    configs?: Record<string, ScopedMcpServerConfig>
  }
}

export type MetaMountInput = {
  url: string
  autoAllowTools: string[]
  sessionId: string
}

type MetaRow = {
  config: ScopedMcpServerConfig
  allowRules: string[]
}

export type ServerConfigModelPickResult =
  | { ok: true }
  | { ok: false; error?: string }
  | undefined
  | Promise<{ ok: true } | { ok: false; error?: string } | undefined>

export type ServerConfigEffortSeedResult =
  | { ok: true }
  | { ok: false; error?: string }

export type ServerConfigSessionDeps = {
  stores: ServerConfigSessionStores
  storageV5?: unknown
  credentials?: unknown
  getAppendSystemPrompt: () => string | undefined
  setAppendSystemPrompt: (value: string | undefined) => void
  sdkHostConfigs: () => Record<string, unknown>
  awaitHostApplyQuiescence?: () => Promise<void>
  /**
   * densable `permission` — toolPermissionContext get/set for ae grants.
   * When omitted, grants mode-flip is skipped (facts seed may still run).
   */
  permission?: {
    get: () => ToolPermissionContext
    set: (
      updater: (ctx: ToolPermissionContext) => ToolPermissionContext,
    ) => void
  }
  /**
   * densable `applyModelPick` / print `La` — sdk-host model lane.
   * Returns `{ok:false}` to refuse; void/`{ok:true}` applies.
   */
  applyModelPick?: (model: string) => ServerConfigModelPickResult
  /**
   * densable `applyEffortSeed` / print `du`/`RSo` — sdk-host effort lane.
   */
  applyEffortSeed?: (effort: string) => ServerConfigEffortSeedResult
  /** Optional reconnect inject for tests. */
  reconnect?: typeof reconnectMcpServerImpl
  clearCache?: typeof clearServerCache
  /** Optional sessionEffort probe (gold `f().sessionEffort` race guard). */
  getSessionEffort?: () => unknown
}

export type ServerConfigApplyArgs = {
  bridgeSessionId: string
  getWorkerBearerToken?: () => string | null | undefined
  getWorkerEpoch?: () => number
  /** densable W0 api base for meta Ykn rewrite / ingress origin. */
  apiBaseUrl?: string
}

export type ServerConfigApplyResult = {
  mountMetaMcp: (input: MetaMountInput) => boolean
  derived: ReturnType<typeof deriveBridgeServerSessionConfig>
}

export type ServerConfigSessionHandle = {
  mountMetaMcp: (
    input: MetaMountInput,
    getBearerToken: (() => string | null | undefined) | undefined,
  ) => boolean
  apply: (
    serverConfig: unknown,
    args: ServerConfigApplyArgs,
  ) => ServerConfigApplyResult
  undo: () => Promise<void>
  /** densable `noteModeChoice` — person mode pick invalidates inherit lift. */
  noteModeChoice: (mode: string) => void
  projectsReplyMount: () => ProjectsReplyMountHandle | null
  resyncProjectsReplyMount: () => void
  takeFirstTurnJoins: () => {
    replyMount: Promise<void> | null
    grants: Promise<unknown> | null
  }
}

function countSessionAllow(state: AppState, rule: string): number {
  const session = state.toolPermissionContext.alwaysAllowRules.session ?? []
  return session.filter(r => r === rule).length
}

/**
 * densable `vt(n)` — create server-config session controller.
 */
export function createServerConfigSession(
  deps: ServerConfigSessionDeps,
): ServerConfigSessionHandle {
  const { getAppState, setAppState, getDynamicMcpState } = deps.stores
  const reconnect = deps.reconnect ?? reconnectMcpServerImpl
  const clearCache = deps.clearCache ?? clearServerCache

  let active: {
    meta: MetaRow | null
    hearth: ProjectsReplyMountHandle | null
    hearthGate: Promise<void>
    hearthStartup: Promise<void> | null
    grants: BridgeChildGrantsHandle | null
    grantInputs: { sessionId: string; facts: string[] } | null
    grantsSettled: Promise<unknown> | null
    hostAppendSystemPrompt: string | undefined
    writtenPrompt: string | undefined
    /** densable `w` held deny rule strings — retracted on undo. */
    denyRules: string[]
  } | null = null
  let applyChain: Promise<void> = Promise.resolve()
  /** densable `b` — previous grants.undo() restored mode (inheritLiftedFrom). */
  let priorGrantsUndo: string | null = null
  let modelPickHeld: { sessionId: string; model: string } | null = null
  let effortSeedHeld: { sessionId: string; effort: string } | null = null
  let modeChoiceGeneration = 0
  let notedMode: string | null = null
  let suppressModeNote = false
  let grantsGeneration = 0

  function retractAllows(rules: string[]): void {
    if (rules.length === 0) return
    setAppState(prev => {
      const session = [
        ...(prev.toolPermissionContext.alwaysAllowRules.session ?? []),
      ]
      for (const rule of rules) {
        const idx = session.lastIndexOf(rule)
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

  /** densable `D("alwaysDenyRules", …)` — retract session denies held by apply. */
  function retractDenies(rules: string[]): void {
    if (rules.length === 0) return
    setAppState(prev => {
      const session = [
        ...(prev.toolPermissionContext.alwaysDenyRules.session ?? []),
      ]
      for (const rule of rules) {
        const idx = session.lastIndexOf(rule)
        if (idx !== -1) session.splice(idx, 1)
      }
      return {
        ...prev,
        toolPermissionContext: {
          ...prev.toolPermissionContext,
          alwaysDenyRules: {
            ...prev.toolPermissionContext.alwaysDenyRules,
            session,
          },
        },
      }
    })
  }

  function countSessionDeny(state: AppState, rule: string): number {
    const session = state.toolPermissionContext.alwaysDenyRules.session ?? []
    return session.filter(r => r === rule).length
  }

  function addDenies(tools: string[]): string[] {
    if (tools.length === 0) return []
    // densable `w`: Pn($n(o)) — hold the session deny rule strings.
    const unique = [
      ...new Set(
        tools.map(tool =>
          permissionRuleValueToString(permissionRuleValueFromString(tool)),
        ),
      ),
    ]
    const before = new Map(
      unique.map(r => [r, countSessionDeny(getAppState(), r)]),
    )
    setAppState(prev => ({
      ...prev,
      toolPermissionContext: applyPermissionUpdate(prev.toolPermissionContext, {
        type: 'addRules',
        destination: 'session',
        behavior: 'deny',
        rules: unique.map(permissionRuleValueFromString),
      }),
    }))
    return unique.filter(
      r => countSessionDeny(getAppState(), r) > (before.get(r) ?? 0),
    )
  }

  function addAllows(rules: string[]): string[] {
    if (rules.length === 0) return []
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

  async function unmountMeta(meta: MetaRow): Promise<void> {
    retractAllows(meta.allowRules)
    meta.allowRules = []
    const client = getAppState().mcp.clients.find(
      c => c.name === CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
    )
    if (client && client.config !== meta.config) {
      await clearCache(CLAUDE_CODE_REMOTE_MCP_SERVER_NAME, meta.config).catch(
        err => {
          logForDebugging(
            `[bridge:server-config] meta unmount cleanup failed: ${errorMessage(err)}`,
            { level: 'warn' },
          )
        },
      )
      return
    }
    const prefix = getMcpPrefix(CLAUDE_CODE_REMOTE_MCP_SERVER_NAME)
    setAppState(prev => {
      const { [CLAUDE_CODE_REMOTE_MCP_SERVER_NAME]: _r, ...resources } =
        prev.mcp.resources
      const { [CLAUDE_CODE_REMOTE_MCP_SERVER_NAME]: _t, ...resourceTemplates } =
        prev.mcp.resourceTemplates
      return {
        ...prev,
        mcp: {
          ...prev.mcp,
          clients: prev.mcp.clients.filter(c => c !== client),
          tools: prev.mcp.tools.filter(
            t =>
              !toolBelongsToServer(
                t,
                CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
                prefix,
              ),
          ),
          commands: prev.mcp.commands.filter(
            c => !commandBelongsToServer(c, CLAUDE_CODE_REMOTE_MCP_SERVER_NAME),
          ),
          resources,
          resourceTemplates,
        },
      }
    })
    await clearCache(CLAUDE_CODE_REMOTE_MCP_SERVER_NAME, meta.config).catch(
      err => {
        logForDebugging(
          `[bridge:server-config] meta unmount cleanup failed: ${errorMessage(err)}`,
          { level: 'warn' },
        )
      },
    )
  }

  async function connectMeta(config: ScopedMcpServerConfig): Promise<void> {
    let settlement: {
      client: MCPServerConnection
      tools: AppState['mcp']['tools']
      commands: AppState['mcp']['commands']
    }
    try {
      const result = await reconnect(
        CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
        config,
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
        `[bridge:server-config] meta mount connect threw: ${errorMessage(err)}`,
        { level: 'warn' },
      )
      settlement = {
        client: {
          name: CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
          type: 'failed',
          config,
          error: 'Connection failed',
        },
        tools: [],
        commands: [],
      }
    }
    if (active?.meta?.config !== config) {
      if (settlement.client.type === 'connected') {
        await detachAndCloseConnection(settlement.client)
      }
      return
    }
    const name = CLAUDE_CODE_REMOTE_MCP_SERVER_NAME
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
    if (settlement.client.type === 'connected') {
      logEvent('bridge_meta_mcp_mount', {
        status:
          'connected' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } else {
      logEvent('bridge_meta_mcp_mount', {
        status:
          `settled_${settlement.client.type}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  }

  /**
   * densable `A(e,r,o,u,g)` — mount meta MCP. Returns false when skipped.
   */
  function mountMetaMcp(
    input: MetaMountInput,
    getBearerToken: (() => string | null | undefined) | undefined,
  ): boolean {
    if (!active) return false
    if (!getBearerToken) {
      logForDebugging(
        '[bridge:server-config] meta mount skipped: the bridge exposes no worker credential',
        { level: 'warn' },
      )
      return false
    }
    const appHas = getAppState().mcp.clients.some(
      c => c.name === CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
    )
    const dyn = getDynamicMcpState()
    if (
      appHas ||
      (dyn.configs !== undefined &&
        CLAUDE_CODE_REMOTE_MCP_SERVER_NAME in dyn.configs)
    ) {
      logForDebugging(
        `[bridge:server-config] meta mount skipped: a server named ${CLAUDE_CODE_REMOTE_MCP_SERVER_NAME} is already configured`,
        { level: 'warn' },
      )
      return false
    }
    const owned = markCliOwnedConfig(
      {
        ...createRemoteMetaHttpConfig(input.url, input.sessionId),
        scope: 'dynamic' as const,
      },
      { getBearerToken },
    ) as ScopedMcpServerConfig
    const meta: MetaRow = { config: owned, allowRules: [] }
    active.meta = meta
    setAppState(prev => ({
      ...prev,
      mcp: {
        ...prev.mcp,
        clients: [
          ...prev.mcp.clients.filter(
            c => c.name !== CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
          ),
          {
            name: CLAUDE_CODE_REMOTE_MCP_SERVER_NAME,
            type: 'pending',
            config: owned,
          },
        ],
      },
    }))
    const ruleStrings = input.autoAllowTools.map(leaf =>
      permissionRuleValueToString({
        toolName: buildMcpToolName(CLAUDE_CODE_REMOTE_MCP_SERVER_NAME, leaf),
      }),
    )
    const before = new Map(
      ruleStrings.map(r => [r, countSessionAllow(getAppState(), r)]),
    )
    try {
      meta.allowRules = addAllows(ruleStrings)
    } finally {
      meta.allowRules = ruleStrings.filter(
        r => countSessionAllow(getAppState(), r) > (before.get(r) ?? 0),
      )
    }
    void connectMeta(owned).catch(err => {
      logForDebugging(
        `[bridge:server-config] meta mount connect threw: ${errorMessage(err)}`,
        { level: 'warn' },
      )
    })
    return true
  }

  /**
   * densable `le(e,r,o,u)` — wire createProjectsReplyMount when bearer present.
   */
  function attachHearth(
    sessionId: string,
    getBearerToken: (() => string | null | undefined) | undefined,
    getWorkerEpoch: (() => number) | undefined,
    prior: Promise<void>,
  ): void {
    if (!active || !getBearerToken) return
    let apiBaseUrl: string
    try {
      // Gold: new URL(`/v1/code/sessions/${e}`, W0()).origin
      apiBaseUrl = new URL(`/v1/code/sessions/${sessionId}`, getBridgeBaseUrl())
        .origin
    } catch (err) {
      logForDebugging(
        `[bridge:server-config] reply mount skipped: ${errorMessage(err)}`,
        { level: 'warn' },
      )
      return
    }
    const hearthDeps: ProjectsReplyMountDeps = {
      stores: deps.stores,
      storageV5: deps.storageV5,
      credentials: deps.credentials,
      sessionId,
      apiBaseUrl,
      getBearerToken,
      getWorkerEpoch,
      readHearthBinding: async () => {
        // densable le(): m1.readProjectsBindingFor(sessionUrl, () => Cme(token))
        const { CCRClient } = await import('../cli/transports/ccrClient.js')
        const sessionUrl = new URL(
          `/v1/code/sessions/${sessionId}`,
          getBridgeBaseUrl(),
        )
        return CCRClient.readProjectsBindingFor(sessionUrl, () => {
          const token = getBearerToken()
          return token ? { Authorization: `Bearer ${token}` } : {}
        })
      },
      sdkHostConfigs: deps.sdkHostConfigs,
      reconnect,
      clearCache,
    }
    const mount = createProjectsReplyMount(hearthDeps)
    const gate = prior.then(
      () => deps.awaitHostApplyQuiescence?.() ?? Promise.resolve(),
    )
    active.hearth = mount
    active.hearthGate = gate
    active.hearthStartup = gate.then(() => mount.sync('startup'))
  }

  async function undoActive(): Promise<void> {
    const cur = active
    active = null
    if (!cur) return
    if (cur.writtenPrompt !== undefined) {
      const o = deps.getAppendSystemPrompt()
      if (o === cur.writtenPrompt) {
        deps.setAppendSystemPrompt(cur.hostAppendSystemPrompt)
      } else {
        // densable: peel written suffix when host appended more after us.
        const host = cur.hostAppendSystemPrompt
        const suffix = host
          ? cur.writtenPrompt.slice(host.length)
          : `\n\n${cur.writtenPrompt}`
        if (o !== undefined && o.endsWith(suffix)) {
          deps.setAppendSystemPrompt(o.slice(0, -suffix.length))
        }
      }
    }
    // densable D(alwaysDenyRules) — retract fail-closed denies from this apply.
    retractDenies(cur.denyRules)
    cur.denyRules = []
    // densable `b = e.grants?.undo() ?? null` — mode string for inheritLiftedFrom.
    priorGrantsUndo = cur.grants?.undo() ?? null
    await Promise.all([
      cur.meta ? unmountMeta(cur.meta) : Promise.resolve(),
      cur.hearth ? cur.hearth.drop() : Promise.resolve(),
    ])
  }

  /**
   * densable `oe` — apply model pick once per sessionId+model.
   */
  async function applyModelLane(
    sessionId: string,
    model: string | undefined,
  ): Promise<void> {
    if (
      model === undefined ||
      (modelPickHeld?.sessionId === sessionId && modelPickHeld.model === model)
    ) {
      return
    }
    if (!deps.applyModelPick) return
    let result: ServerConfigModelPickResult
    try {
      result = await deps.applyModelPick(model)
    } catch (err) {
      logForDebugging(
        `[bridge:server-config] sdk-host lane model pick threw: ${errorMessage(err)}`,
        { level: 'warn' },
      )
      return
    }
    if (result && typeof result === 'object' && result.ok === false) {
      logEvent('bridge_server_session_config', {
        status:
          'model_pick_refused' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      logForDebugging(
        '[bridge:server-config] sdk-host lane model pick refused; the model in force stands',
        { level: 'warn' },
      )
      return
    }
    modelPickHeld = { sessionId, model }
    logForDebugging('[bridge:server-config] sdk-host lane model pick applied')
  }

  /**
   * densable `se` — apply effort seed once per sessionId+effort.
   */
  function applyEffortLane(
    sessionId: string,
    effort: string | undefined,
  ): void {
    if (
      effort === undefined ||
      (effortSeedHeld?.sessionId === sessionId &&
        effortSeedHeld.effort === effort)
    ) {
      return
    }
    if (!deps.applyEffortSeed) return
    if (!isBridgeApplyServerSessionConfigGate()) return
    let result: ServerConfigEffortSeedResult
    try {
      result = deps.applyEffortSeed(effort)
    } catch (err) {
      logForDebugging(
        `[bridge:server-config] sdk-host lane effort seed threw: ${errorMessage(err)}`,
        { level: 'warn' },
      )
      return
    }
    if (!result.ok) {
      logEvent('bridge_server_session_config', {
        status:
          'effort_pick_refused' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      logForDebugging(
        '[bridge:server-config] sdk-host lane effort refused; the effort in force stands',
        { level: 'warn' },
      )
      return
    }
    effortSeedHeld = { sessionId, effort }
    logForDebugging('[bridge:server-config] sdk-host lane effort seeded')
  }

  /**
   * densable `ae` — schedule child grants after model/effort settle.
   */
  function scheduleGrants(
    row: NonNullable<typeof active>,
    inheritLiftedFrom: string | null,
    applyAfter: Promise<unknown>,
  ): Promise<unknown> {
    const inputs = row.grantInputs
    if (!inputs) return Promise.resolve()
    const gen = grantsGeneration
    const modeGen = modeChoiceGeneration
    const rawPermission =
      deps.permission ??
      ({
        get: () =>
          ({
            mode: 'default',
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
          }) as ToolPermissionContext,
        set: () => {},
      } as const)
    // densable F wrapper — suppress noteModeChoice while grants flip mode.
    const permission = {
      get: rawPermission.get,
      set: (updater: (ctx: ToolPermissionContext) => ToolPermissionContext) => {
        const prev = suppressModeNote
        suppressModeNote = true
        try {
          rawPermission.set(updater)
        } finally {
          suppressModeNote = prev
        }
      },
    }
    return attachBridgeChildGrants({
      sessionId: inputs.sessionId,
      credentials: deps.credentials,
      autoModeEnvironment: inputs.facts,
      permission,
      stillWanted: () => active === row && grantsGeneration === gen,
      applyAfter,
      inheritLiftedFrom,
      keepChosenMode: () =>
        inheritLiftedFrom !== null
          ? modeChoiceGeneration !== modeGen
          : notedMode !== null && notedMode !== 'auto',
    }).then(handle => {
      if (active === row && grantsGeneration === gen) row.grants = handle
      else handle.undo()
    })
  }

  return {
    mountMetaMcp,
    apply(serverConfig, args) {
      void undoActive()
      const prior = applyChain
      const next = {
        meta: null as MetaRow | null,
        hearth: null as ProjectsReplyMountHandle | null,
        hearthGate: Promise.resolve(),
        hearthStartup: null as Promise<void> | null,
        grants: null as BridgeChildGrantsHandle | null,
        grantInputs: null as {
          sessionId: string
          facts: string[]
        } | null,
        grantsSettled: null as Promise<unknown> | null,
        hostAppendSystemPrompt: deps.getAppendSystemPrompt(),
        writtenPrompt: undefined as string | undefined,
        denyRules: [] as string[],
      }
      active = next
      attachHearth(
        args.bridgeSessionId,
        args.getWorkerBearerToken,
        args.getWorkerEpoch,
        prior,
      )

      // densable Z/bQt sdk-host lane — derive append/deny/meta from body.
      // Headless RC may apply({}) for mount-only; arms no-op until a
      // WorkSecret-bearing body is passed (do not invent CCR secret fetch).
      const body =
        serverConfig !== null && typeof serverConfig === 'object'
          ? (serverConfig as DeriveServerSessionConfigInput)
          : {}
      const derived = deriveBridgeServerSessionConfig(body, {
        sessionId: args.bridgeSessionId,
        apiBaseUrl: args.apiBaseUrl ?? getBridgeBaseUrl(),
      })

      // densable oe → se: model pick then effort seed (race on sessionEffort).
      // densable: latch sessionEffort before oe; se only if unchanged after.
      const effortBefore = deps.getSessionEffort?.()
      const modelLane = applyModelLane(
        args.bridgeSessionId,
        extractServerConfigModel(body.claude_code_args),
      ).then(() => {
        if (active !== next) return
        // Gold: `f().sessionEffort === O` — strict. Do NOT treat
        // undefined-before as "always seed" (model pick may mutate effort).
        if (
          deps.getSessionEffort !== undefined &&
          deps.getSessionEffort() !== effortBefore
        ) {
          return
        }
        applyEffortLane(
          args.bridgeSessionId,
          extractServerConfigEffort(body.claude_code_args),
        )
      })

      // densable V(e,o) — facts only when kBe sdk-host lane gate is on.
      next.grantInputs = {
        sessionId: args.bridgeSessionId,
        facts: isBridgeApplyServerSessionConfigGate()
          ? derived.autoModeEnvironment
          : [],
      }
      const inherit = priorGrantsUndo
      priorGrantsUndo = null
      next.grantsSettled = scheduleGrants(next, inherit, modelLane)

      if (derived.appendSystemPrompt) {
        const held = deps.getAppendSystemPrompt()
        if (!held?.includes(derived.appendSystemPrompt)) {
          const stamped = held
            ? `${held}\n\n${derived.appendSystemPrompt}`
            : derived.appendSystemPrompt
          deps.setAppendSystemPrompt(stamped)
          next.writtenPrompt = stamped
        }
      }
      if (derived.disallowedTools.length > 0) {
        // densable `w` — hold deny rule strings for undo retract.
        next.denyRules = addDenies(derived.disallowedTools)
      }
      let metaMounted = false
      if (derived.metaMountUrl) {
        metaMounted = mountMetaMcp(
          {
            url: derived.metaMountUrl,
            autoAllowTools: derived.autoAllowTools,
            sessionId: args.bridgeSessionId,
          },
          args.getWorkerBearerToken,
        )
      }
      logEvent('tengu_bridge_server_config_applied', {
        append_prompt: Boolean(derived.appendSystemPrompt),
        deny_rules: derived.disallowedTools.length,
        meta_mcp_verified: derived.metaMountUrl !== null,
        meta_mcp_mounted: metaMounted,
        auto_allow: metaMounted ? derived.autoAllowTools.length : 0,
        ignored_mcp: derived.ignoredMcpServers,
        carried_auto_mode_environment: derived.autoModeEnvironment.length > 0,
        ...(derived.metaDropReason !== null && {
          meta_drop:
            derived.metaDropReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
      })
      if (body.mcp_config && derived.metaMountUrl === null) {
        logEvent('bridge_server_session_config', {
          status:
            'meta_mcp_not_verified' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      } else if (derived.metaMountUrl !== null && !metaMounted) {
        logEvent('bridge_server_session_config', {
          status:
            'meta_mcp_not_mounted' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }

      return {
        mountMetaMcp: (input: MetaMountInput) =>
          mountMetaMcp(input, args.getWorkerBearerToken),
        derived,
      }
    },
    undo: () => {
      const p = undoActive()
      applyChain = Promise.all([applyChain, p]).then(
        () => {},
        () => {},
      )
      return p
    },
    noteModeChoice: (mode: string) => {
      if (suppressModeNote) return
      modeChoiceGeneration += 1
      notedMode = mode
      priorGrantsUndo = null
    },
    projectsReplyMount: () => active?.hearth ?? null,
    resyncProjectsReplyMount: () => {
      const hearth = active?.hearth
      if (!active || !hearth) return
      void active.hearthGate.then(() => hearth.sync('binding_changed'))
    },
    takeFirstTurnJoins: () => {
      if (!active) return { replyMount: null, grants: null }
      const out = {
        replyMount: active.hearthStartup,
        grants: active.grantsSettled,
      }
      active.hearthStartup = null
      active.grantsSettled = null
      return out
    },
  }
}

/** densable export name — alias for createServerConfigSession. */
export const createHeadlessWorkSecretSession = createServerConfigSession
