/**
 * AcpAgent.prototype.createSession implementation, attached via Object.assign.
 * Extracted from sessionLifecycle.ts to keep that module under the 500-line
 * budget. The barrel (./index.ts) imports this module for its side effect.
 */
import { randomUUID } from 'node:crypto'
import type {
  NewSessionRequest,
  NewSessionResponse,
  SessionModeState,
  SessionModelState,
} from '@agentclientprotocol/sdk'
import type { Message } from '../../../types/message.js'
import { QueryEngine } from '../../../QueryEngine.js'
import type { QueryEngineConfig } from '../../../QueryEngine.js'
import type { Tools } from '../../../Tool.js'
import { getTools } from '../../../tools.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import type { PermissionMode } from '../../../types/permissions.js'
import { getCommands } from '../../../commands.js'
import { getAgentDefinitionsWithOverrides } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import {
  setOriginalCwd,
  switchSession,
  getSessionProjectDir,
} from '../../../bootstrap/state.js'
import type { SessionId } from '../../../types/ids.js'
import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import { enableConfigs } from '../../../utils/config.js'
import { applySafeConfigEnvironmentVariablesForAcpSession } from '../../../utils/managedEnv.js'
import { resetSettingsCache } from '../../../utils/settings/settingsCache.js'
import { FileStateCache } from '../../../utils/fileStateCache.js'
import { getDefaultAppState } from '../../../state/AppStateStore.js'
import type { AppState } from '../../../state/AppStateStore.js'
import { createAcpCanUseTool } from '../permissions.js'
import { computeSessionFingerprint } from '../utils.js'
import { getMainLoopModel } from '../../../utils/model/model.js'
import { getModelOptions } from '../../../utils/model/modelOptions.js'
import { acquireSharedBackendMode } from '../../../utils/sessionContextAls.js'
import { createSessionHost } from '../../../utils/sessionHost.js'
import {
  createRootSession,
  runWithSession,
  type Session,
} from '../../../utils/sessionRoot.js'
import { getSettings_DEPRECATED } from '../../../utils/settings/settings.js'
import { AcpAgent } from './AcpAgent.js'
import type { AcpSession } from './sessionTypes.js'
import {
  resolveSessionPermissionMode,
  isAcpBypassPermissionModeAvailable,
  hasOwnField,
} from './permissionMode.js'
import { buildConfigOptions } from './configOptions.js'
import { readClientCapabilities } from './internalAccessors.js'

/**
 * Resolve the effective `permissions.defaultMode` setting by walking the
 * settings object. Lives here so createSession can read it without depending
 * on AcpAgent.getSetting (which is a private instance method on the shell).
 */
function readSettingsPermissionMode(
  settings: Record<string, unknown>,
): unknown {
  const perms = settings.permissions as Record<string, unknown> | undefined
  return perms?.defaultMode
}

const inFlightCreateSessionCount = new WeakMap<AcpAgent, number>()
const acpSessionEnvRollback = new WeakMap<AcpSession, () => void>()
const activeSoleSessionRollback = new WeakMap<AcpAgent, () => void>()
const acpAgentSharedBackendLeases = new Map<AcpAgent, () => void>()

/**
 * Synchronize process-wide `isSharedBackend()` (`o7()`) with concurrent
 * multi-session ACP activity using ref-counted leases: acquires a lease for an
 * `AcpAgent` as soon as it serves 2+ concurrent sessions (active or in-flight)
 * and releases only that agent's lease once it drops back to <= 1 session.
 */
export function syncAcpSharedBackendMode(agent: AcpAgent): void {
  const totalSessions =
    agent.sessions.size + (inFlightCreateSessionCount.get(agent) ?? 0)
  if (totalSessions >= 2) {
    if (!acpAgentSharedBackendLeases.has(agent)) {
      acpAgentSharedBackendLeases.set(agent, acquireSharedBackendMode())
    }
  } else {
    const release = acpAgentSharedBackendLeases.get(agent)
    if (release !== undefined) {
      acpAgentSharedBackendLeases.delete(agent)
      release()
    }
  }
}

export function rollbackAcpSessionEnv(
  agent: AcpAgent,
  session: AcpSession,
): void {
  const rollback = acpSessionEnvRollback.get(session)
  if (!rollback) return
  acpSessionEnvRollback.delete(session)
  if (activeSoleSessionRollback.get(agent) === rollback) {
    activeSoleSessionRollback.delete(agent)
  }
  rollback()
}

// ── createSession ────────────────────────────────────────────────

async function createSession(
  this: AcpAgent,
  params: NewSessionRequest,
  opts: {
    forceNewId?: boolean
    sessionId?: string
    parentSessionId?: string
    initialMessages?: Message[]
    hostSession?: Session
    projectDir?: string | null
  } = {},
): Promise<NewSessionResponse> {
  const sessionId = opts.sessionId ?? randomUUID()
  const cwd = params.cwd

  const inFlightBefore = inFlightCreateSessionCount.get(this) ?? 0
  inFlightCreateSessionCount.set(this, inFlightBefore + 1)
  syncAcpSharedBackendMode(this)
  const isSoleSession = this.sessions.size === 0 && inFlightBefore === 0
  if (!isSoleSession) {
    // A 2nd concurrent session is starting on this AcpAgent: immediately roll
    // back any sole-session project process.env mutations so sibling sessions
    // never observe cross-repo process.env state.
    const prevRollback = activeSoleSessionRollback.get(this)
    if (prevRollback) {
      activeSoleSessionRollback.delete(this)
      prevRollback()
    }
  }
  let rollbackEnv: (() => void) | undefined
  let sessionRegistered = false

  const hostSession =
    opts.hostSession ??
    createRootSession({
      host: createSessionHost(),
      id: sessionId,
      parentId: opts.parentSessionId,
      project: {
        originalCwd: cwd,
        projectRoot: cwd,
        cwd,
      },
    })

  try {
    return await runWithSession(hostSession, async () => {
      enableConfigs()

      // Align the ALS-scoped session state so transcript persistence,
      // analytics, and cost tracking use this ACP session's ID and projectDir
      // without clobbering concurrent sessions.
      const currentProjectDir =
        opts.projectDir !== undefined
          ? opts.projectDir
          : (hostSession.identity.projectDir() ?? getSessionProjectDir())
      const shouldResetProjectCwd =
        !opts.hostSession ||
        hostSession.project.originalCwd !== cwd.normalize('NFC')
      hostSession.update({
        id: sessionId,
        ...(opts.parentSessionId !== undefined
          ? { parentId: opts.parentSessionId }
          : {}),
        ...(shouldResetProjectCwd
          ? {
              project: {
                originalCwd: cwd,
                projectRoot: cwd,
                cwd,
              },
            }
          : {}),
      })
      hostSession.identity.replaceProjectDir(currentProjectDir)
      hostSession.costLedger.scopeTo(sessionId)

      switchSession(sessionId as SessionId, currentProjectDir)
      if (shouldResetProjectCwd) {
        setOriginalCwd(cwd)
      }

      // Drop this host's settings cache so `settings.local.json` is resolved
      // against this session's `originalCwd`. When this is the sole active ACP
      // session, apply its safe config env vars with a rollback handle restored
      // cleanly on teardown (or if a 2nd concurrent session starts).
      resetSettingsCache()
      const loadedSettings = (getSettings_DEPRECATED() ?? {}) as Record<
        string,
        unknown
      >
      if (isSoleSession && this.sessions.size === 0) {
        const rawEnv = loadedSettings.env
        const preloadedEnv =
          typeof rawEnv === 'object' && rawEnv !== null
            ? (rawEnv as Record<string, string>)
            : {}
        rollbackEnv =
          applySafeConfigEnvironmentVariablesForAcpSession(preloadedEnv)
        activeSoleSessionRollback.set(this, rollbackEnv)
      }

      // Build tools with a permissive permission context.
      const permissionContext = getEmptyToolPermissionContext()
      const tools: Tools = getTools(permissionContext)

      // Parse permission mode from _meta (passed by RCS/acp-link) or settings.
      const meta = params._meta as Record<string, unknown> | null | undefined
      const hasMetaPermissionMode = hasOwnField(meta, 'permissionMode')
      const metaPermissionMode = hasMetaPermissionMode
        ? meta?.permissionMode
        : undefined
      const settingsPermissionMode = readSettingsPermissionMode(loadedSettings)
      const permissionMode = resolveSessionPermissionMode(
        metaPermissionMode,
        hasMetaPermissionMode,
        settingsPermissionMode,
      )

      // The clientCapabilities field on the shell is private; access it via
      // the public initialize() side effect. Since createSession is only ever
      // called after initialize() has run (per ACP protocol), this accessor
      // is safe.
      const clientCapabilities = readClientCapabilities(this)

      // Create the permission bridge canUseTool function. The connection field
      // is private on the shell; access it through the internal accessor.
      const conn = (
        this as unknown as {
          conn: import('@agentclientprotocol/sdk').AgentSideConnection
        }
      ).conn
      const getCurrentModeId = () =>
        this.sessions.get(sessionId)?.modes.currentModeId ?? 'default'
      const onModeChange = (modeId: string) => {
        this.applySessionMode(sessionId, modeId)
      }
      const isBypassModeAvailable = () =>
        this.sessions.get(sessionId)?.appState.toolPermissionContext
          .isBypassPermissionsModeAvailable ?? false
      // densable: cancelled permission → session.cancelled + interrupt so
      // session/prompt resolves StopReason::Cancelled (not plain deny).
      const onPermissionCancelled = () => {
        const session = this.sessions.get(sessionId)
        if (!session) return
        runWithSession(session.hostSession, () => {
          session.cancelled = true
          session.cancelGeneration += 1
          session.queryEngine.interrupt()
        })
      }
      const getAvailableModeIds = () =>
        this.sessions
          .get(sessionId)
          ?.modes.availableModes.map(mode => mode.id) ?? []

      let cachedCanUseToolCwd = cwd
      let cachedCanUseTool = createAcpCanUseTool(
        conn,
        sessionId,
        getCurrentModeId,
        clientCapabilities,
        cwd,
        onModeChange,
        isBypassModeAvailable,
        onPermissionCancelled,
        getAvailableModeIds,
      )
      const canUseTool: CanUseToolFn = (...args) => {
        const liveSession = this.sessions.get(sessionId)
        const liveCwd =
          liveSession?.hostSession.project.cwd ?? liveSession?.cwd ?? cwd
        if (liveCwd !== cachedCanUseToolCwd) {
          cachedCanUseToolCwd = liveCwd
          cachedCanUseTool = createAcpCanUseTool(
            conn,
            sessionId,
            getCurrentModeId,
            clientCapabilities,
            liveCwd,
            onModeChange,
            isBypassModeAvailable,
            onPermissionCancelled,
            getAvailableModeIds,
          )
        }
        return cachedCanUseTool(...args)
      }

      // Parse MCP servers from ACP params
      // MCP server config is handled separately in the tools system

      // bypassPermissions is exposed to ACP clients whenever the process itself allows it
      // (non-root or sandbox). The previous additional opt-in gate made the mode invisible
      // to standard clients and defeated the purpose of listing it. See permissionMode.ts.
      const isBypassAvailable = isAcpBypassPermissionModeAvailable()

      // Create a mutable AppState for the session
      const appState: AppState = {
        ...getDefaultAppState(),
        toolPermissionContext: {
          ...permissionContext,
          mode: permissionMode as PermissionMode,
          isBypassPermissionsModeAvailable: isBypassAvailable,
        },
      }

      // Load commands and agent definitions for subagent support
      const [commands, agentDefinitionsResult] = await Promise.all([
        getCommands(cwd),
        getAgentDefinitionsWithOverrides(cwd),
      ])

      // Inject agent definitions into appState
      appState.agentDefinitions = agentDefinitionsResult

      // Official 2.1.331 `X.engineStore.adopt(oe)` — bind this ACP session's
      // live AppState facade onto `hostSession.engineStore` so downstream
      // consumers (`claudemd.ts` / permissions) observe live permission mode
      // transitions on this root session and its `withProject` forks.
      const setAppState = (updater: (prev: AppState) => AppState) => {
        const updated = updater(appState)
        Object.assign(appState, updated)
      }
      hostSession.engineStore.adopt({
        getState: () => appState,
        setState: setAppState,
      })

      // Build QueryEngine config
      const engineConfig: QueryEngineConfig = {
        cwd,
        tools,
        commands,
        mcpClients: [],
        agents: agentDefinitionsResult.activeAgents,
        canUseTool,
        getAppState: () => appState,
        setAppState,
        readFileCache: new FileStateCache(500, 50 * 1024 * 1024),
        includePartialMessages: true,
        replayUserMessages: true,
        initialMessages: opts.initialMessages,
      }

      const queryEngine = new QueryEngine(engineConfig)

      // Build modes — bypassPermissions is opt-in for ACP clients.
      const availableModes = [
        {
          id: 'default',
          name: 'Default',
          description: 'Standard behavior, prompts for dangerous operations',
        },
        {
          id: 'acceptEdits',
          name: 'Accept Edits',
          description: 'Auto-accept file edit operations',
        },
        {
          id: 'plan',
          name: 'Plan Mode',
          description: 'Planning mode, no actual tool execution',
        },
        {
          id: 'auto',
          name: 'Auto',
          description:
            'Use a model classifier to approve/deny permission prompts.',
        },
        ...(isBypassAvailable
          ? [
              {
                id: 'bypassPermissions' as const,
                name: 'Bypass Permissions',
                description: 'Skip all permission checks',
              },
            ]
          : []),
        {
          id: 'dontAsk',
          name: "Don't Ask",
          description: "Don't prompt for permissions, deny if not pre-approved",
        },
      ]

      const modes: SessionModeState = {
        currentModeId: permissionMode,
        availableModes,
      }

      // Build models
      const modelOptions = getModelOptions()
      const currentModel = getMainLoopModel()
      const models: SessionModelState = {
        availableModels: modelOptions.map(m => ({
          modelId: String(m.value ?? ''),
          name: m.label ?? String(m.value ?? ''),
          description: m.description ?? undefined,
        })),
        currentModelId: currentModel,
      }

      // Set the model on the engine
      queryEngine.setModel(currentModel)

      // Build config options
      const configOptions = buildConfigOptions(modes, models)

      const session: AcpSession = {
        hostSession,
        queryEngine,
        cancelled: false,
        cancelGeneration: 0,
        cwd,
        modes,
        models,
        configOptions,
        promptRunning: false,
        pendingMessages: new Map(),
        pendingQueue: [],
        pendingQueueHead: 0,
        toolUseCache: {},
        clientCapabilities,
        appState,
        commands,
        sessionFingerprint: computeSessionFingerprint({
          cwd,
          mcpServers: params.mcpServers as
            | Array<{ name: string; [key: string]: unknown }>
            | undefined,
        }),
      }

      this.sessions.set(sessionId, session)
      sessionRegistered = true
      if (rollbackEnv) {
        if (activeSoleSessionRollback.get(this) === rollbackEnv) {
          acpSessionEnvRollback.set(session, rollbackEnv)
        } else {
          rollbackEnv()
        }
      }

      // Return models even though SDK 0.19.2 marks it UNSTABLE. The schema does allow the field
      // (NewSessionResponse.models?: SessionModelState | null), and standard clients (Cursor/Zed/
      // VS Code ACP) rely on it to populate the model selector — omitting it forces
      // supportsModelSelection=false on the client and the user can never switch models.
      // The UNSTABLE marker only means "this field may change in a future schema version", not
      // "agents MUST NOT return it". The previous "v1 compliance" omission was overzealous.
      return {
        sessionId,
        modes,
        models,
        configOptions,
      }
    })
  } finally {
    if (!sessionRegistered && rollbackEnv) {
      if (activeSoleSessionRollback.get(this) === rollbackEnv) {
        activeSoleSessionRollback.delete(this)
      }
      rollbackEnv()
    }
    const remaining = (inFlightCreateSessionCount.get(this) ?? 1) - 1
    if (remaining <= 0) {
      inFlightCreateSessionCount.delete(this)
    } else {
      inFlightCreateSessionCount.set(this, remaining)
    }
    syncAcpSharedBackendMode(this)
  }
}

// ── Prototype attachment ─────────────────────────────────────────

Object.assign(AcpAgent.prototype, {
  createSession,
})
