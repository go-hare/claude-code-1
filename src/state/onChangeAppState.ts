import { isDeepStrictEqual } from 'util'
import {
  clearCarriedEffortFromLatch,
  setMainLoopModelOverride,
} from '../bootstrap/state.js'
import { logForDebugging } from '../utils/debug.js'
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js'
import type { ToolPermissionContext } from '../Tool.js'
import {
  clearApiKeyHelperCache,
  clearAwsCredentialsCache,
  clearGcpCredentialsCache,
} from '../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { toError } from '../utils/errors.js'
import { logError } from '../utils/log.js'
import { applyConfigEnvironmentVariables } from '../utils/managedEnv.js'
import {
  permissionModeFromString,
  toExternalPermissionMode,
} from '../utils/permissions/PermissionMode.js'
import {
  isBypassPermissionsModeDisabled,
  stripDangerousPermissionsForAutoMode,
  transitionPermissionMode,
} from '../utils/permissions/permissionSetup.js'
import {
  isWorkerPermissionModeRecordEnabled,
  notifyInternalMetadataChanged,
  notifyPermissionModeChanged,
  notifySessionMetadataChanged,
  notifyUltracodeActive,
  type SessionExternalMetadata,
} from '../utils/sessionState.js'
import {
  clearSessionOrgEffortCaps,
  isEffortLevel,
  isUltracodeModeActive,
  pdSessionEffort,
  sessionEffortEquals,
  type SessionEffortTag,
} from '../utils/effort.js'
import {
  getMainLoopModel,
  getRuntimeMainLoopModel,
} from '../utils/model/model.js'
import { isObserverAgentTask } from '../tasks/LocalAgentTask/LocalAgentTask.js'
import type { TaskState } from '../tasks/types.js'
import type { AppState, SessionAppState, UIAppState } from './AppStateStore.js'

/**
 * densable 2.1.211 Kw / 2.1.289 yg — live background membership for stream
 * level signal. running|pending, and if isBackgrounded is present it must not
 * be false (foreground-registered agents are excluded until mid-bg flip).
 */
function isLiveBackgroundTask(task: TaskState): boolean {
  if (task.status !== 'running' && task.status !== 'pending') {
    return false
  }
  if ('isBackgrounded' in task && task.isBackgrounded === false) {
    return false
  }
  return true
}

/**
 * densable 2.1.289 Ku — observer local_agent tasks are excluded from CCR/SDK
 * live lists; owner-agent Ku also stamps observer_owned on child shells/monitors.
 */
function isObserverExcludedTask(task: TaskState): boolean {
  return isObserverAgentTask(task)
}

/** densable 2.1.211 Zlr / 2.1.289 y — wire list for background_tasks_changed. */
function listLiveBackgroundTasks(tasks: AppState['tasks'] | undefined): Array<{
  task_id: string
  task_type: string
  description: string
  ambient?: boolean
}> {
  if (!tasks) return []
  return Object.values(tasks)
    .filter(t => isLiveBackgroundTask(t) && !isObserverExcludedTask(t))
    .map(t => ({
      task_id: t.id,
      task_type: t.type,
      description: t.description,
      ...('ambient' in t &&
      typeof (t as { ambient?: unknown }).ambient === 'boolean'
        ? { ambient: (t as { ambient: boolean }).ambient }
        : {}),
    }))
}

/** densable 2.1.289 CCR internal allowlist (gold E type filter). */
const RUNNING_BACKGROUND_TASK_TYPES = new Set([
  'local_bash',
  'monitor_mcp',
  'monitor_ws',
  'local_agent',
  'local_workflow',
])

export type RunningBackgroundTaskInternal = {
  task_id: string
  task_type: string
  description: string
  owner_agent_id?: string
  shell_kind?: string
  ambient?: boolean
  observer_owned?: boolean
}

/**
 * densable 2.1.289 L — shell/monitor owned by an observer agent.
 */
function isObserverOwnedBackgroundTask(
  task: TaskState,
  tasks: AppState['tasks'],
): boolean {
  if (
    task.type !== 'local_bash' &&
    task.type !== 'monitor_mcp' &&
    task.type !== 'monitor_ws'
  ) {
    return false
  }
  const agentId = 'agentId' in task ? task.agentId : undefined
  if (agentId === undefined) return false
  const owner = tasks[agentId]
  return owner !== undefined && isObserverExcludedTask(owner)
}

/**
 * densable 2.1.289 E — CCR internal_metadata.running_background_tasks writer
 * list (type-filtered live set + optional owner/shell/ambient/observer_owned).
 */
export function listRunningBackgroundTasksForInternalMetadata(
  tasks: AppState['tasks'] | undefined,
): RunningBackgroundTaskInternal[] {
  if (!tasks) return []
  return Object.values(tasks)
    .filter(
      t =>
        isLiveBackgroundTask(t) &&
        !isObserverExcludedTask(t) &&
        RUNNING_BACKGROUND_TASK_TYPES.has(t.type),
    )
    .map(t => {
      const entry: RunningBackgroundTaskInternal = {
        task_id: t.id,
        task_type: t.type,
        description: t.description,
      }
      if (
        (t.type === 'local_bash' ||
          t.type === 'monitor_mcp' ||
          t.type === 'monitor_ws') &&
        'agentId' in t &&
        t.agentId !== undefined
      ) {
        entry.owner_agent_id = t.agentId
      }
      if (
        t.type === 'local_bash' &&
        'kind' in t &&
        (t as { kind?: unknown }).kind !== undefined
      ) {
        entry.shell_kind = String((t as { kind: string | number }).kind)
      }
      if (
        t.type === 'monitor_ws' &&
        'ambient' in t &&
        (t as { ambient?: unknown }).ambient
      ) {
        entry.ambient = true
      }
      if (isObserverOwnedBackgroundTask(t, tasks)) {
        entry.observer_owned = true
      }
      return entry
    })
}

function backgroundTasksMembershipChanged(
  prev: Array<{ task_id: string }>,
  next: Array<{ task_id: string }>,
): boolean {
  if (prev.length !== next.length) return true
  return next.some((t, i) => t.task_id !== prev[i]?.task_id)
}

// ---------------------------------------------------------------------------
// #1771 & #1816 — `ccr_kept_session_rules`
// Persist session-scoped deny/ask/allow rules in CCR internal metadata;
// drop allow rules whenever deny/ask rules cannot all be kept whole.
// Official `B` / `D` / `ARi` / `F` / `M` / `P` / `O` (X=32768, Q=512).
// ---------------------------------------------------------------------------

export const CCR_SESSION_RULES_MAX_BYTES = 32_768
export const CCR_SESSION_RULE_MAX_LEN = 512

export type CcrSessionRulesRecord = {
  session_allow_rules: string[] | null
  session_deny_rules: string[] | null
  session_ask_rules: string[] | null
}

let ccrKeepsSessionRules: boolean | undefined

export function setCcrKeepsSessionRules(value: boolean | undefined): void {
  ccrKeepsSessionRules = value
}

export function getCcrKeepsSessionRules(): boolean | undefined {
  return ccrKeepsSessionRules
}

function isValidSessionRuleString(rule: unknown): rule is string {
  if (
    typeof rule !== 'string' ||
    rule.length === 0 ||
    rule.length > CCR_SESSION_RULE_MAX_LEN ||
    /[\p{C}\p{Zl}\p{Zp}`]/u.test(rule)
  ) {
    return false
  }
  const parenIdx = rule.indexOf('(')
  const toolName = parenIdx === -1 ? rule : rule.slice(0, parenIdx)
  return /^[\w.*-]+$/.test(toolName)
}

function dedupKeepLast(rules: readonly string[]): string[] {
  const seen = new Set<string>()
  const reversed: string[] = []
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i]!
    if (!seen.has(r)) {
      seen.add(r)
      reversed.push(r)
    }
  }
  return reversed.reverse()
}

function capRulesToByteBudget(
  rules: readonly string[],
  maxBytes = CCR_SESSION_RULES_MAX_BYTES,
): string[] {
  let bytes = 1
  const out: string[] = []
  for (const r of rules) {
    bytes += Buffer.byteLength(JSON.stringify(r)) + 1
    if (bytes > maxBytes) break
    out.push(r)
  }
  return out
}

function sanitizeDenyOrAskSessionRules(raw: unknown): {
  rules: string[]
  whole: boolean
} {
  const arr = Array.isArray(raw) ? raw : []
  const valid = arr.filter(isValidSessionRuleString)
  const deduped = dedupKeepLast(valid)
  const capped = capRulesToByteBudget(deduped)
  const whole =
    (Array.isArray(raw) || raw === undefined || raw === null) &&
    valid.length === arr.length &&
    capped.length === deduped.length
  return { rules: capped, whole }
}

function sanitizeAllowSessionRules(
  raw: unknown,
  denyAndAskWhole: boolean,
): { rules: string[]; whole: boolean } {
  const arr = Array.isArray(raw) ? raw : []
  const filtered = dedupKeepLast(
    arr.filter(
      (r): r is string =>
        typeof r === 'string' && r.length > 0 && !r.startsWith('mcp__'),
    ),
  )
  const capped = capRulesToByteBudget(filtered)
  if (denyAndAskWhole && capped.length === filtered.length) {
    return { rules: capped, whole: true }
  }
  // #1816: Drop session allow rules when deny/ask cannot all be kept whole
  // (or allow list itself overflows the byte cap).
  return { rules: [], whole: false }
}

/**
 * #1771 & #1816 / official `O(toolPermissionContext)` — serialize session-scoped
 * allow/deny/ask rules into a CCR internal-metadata record.
 */
export function buildCcrSessionRulesRecord(
  ctx: Pick<
    ToolPermissionContext,
    'alwaysAllowRules' | 'alwaysDenyRules' | 'alwaysAskRules'
  >,
  excludeAllowRules: ReadonlySet<string> = new Set(),
): { record: CcrSessionRulesRecord; whole: boolean } {
  const deny = sanitizeDenyOrAskSessionRules(ctx.alwaysDenyRules.session)
  const ask = sanitizeDenyOrAskSessionRules(ctx.alwaysAskRules.session)
  const rawAllow = (ctx.alwaysAllowRules.session ?? []).filter(
    r => !excludeAllowRules.has(r),
  )
  const allow = sanitizeAllowSessionRules(rawAllow, deny.whole && ask.whole)
  return {
    record: {
      session_allow_rules: allow.rules.length > 0 ? allow.rules : null,
      session_deny_rules: deny.rules.length > 0 ? deny.rules : null,
      session_ask_rules: ask.rules.length > 0 ? ask.rules : null,
    },
    whole: allow.whole,
  }
}

/**
 * #1771 & #1816 / official `D(internalRecord)` — restore persisted session-scoped
 * deny/ask/allow rules onto a `ToolPermissionContext`. Drops `session_allow_rules`
 * whenever `session_deny_rules` or `session_ask_rules` cannot all be kept whole.
 */
export function restoreCcrSessionRules(
  internal: Partial<CcrSessionRulesRecord> | null | undefined,
): (ctx: ToolPermissionContext) => ToolPermissionContext {
  if (!internal) return ctx => ctx
  const deny = sanitizeDenyOrAskSessionRules(internal.session_deny_rules)
  const ask = sanitizeDenyOrAskSessionRules(internal.session_ask_rules)
  const allow = sanitizeAllowSessionRules(
    internal.session_allow_rules,
    deny.whole && ask.whole,
  )
  if (!allow.whole) {
    logForDiagnosticsNoPII('warn', 'ccr_kept_session_rules', {
      reason: 'lists_not_restored_whole',
    })
  }
  if (allow.rules.length + deny.rules.length + ask.rules.length === 0) {
    return ctx => ctx
  }
  if (deny.rules.length + ask.rules.length > 0) {
    logForDiagnosticsNoPII('info', 'ccr_kept_session_rules', {
      count: deny.rules.length + ask.rules.length,
    })
  }
  return ctx => ({
    ...ctx,
    ...(allow.rules.length > 0
      ? {
          alwaysAllowRules: {
            ...ctx.alwaysAllowRules,
            session: dedupKeepLast([
              ...allow.rules,
              ...(ctx.alwaysAllowRules.session ?? []),
            ]),
          },
        }
      : {}),
    ...(deny.rules.length > 0
      ? {
          alwaysDenyRules: {
            ...ctx.alwaysDenyRules,
            session: dedupKeepLast([
              ...deny.rules,
              ...(ctx.alwaysDenyRules.session ?? []),
            ]),
          },
        }
      : {}),
    ...(ask.rules.length > 0
      ? {
          alwaysAskRules: {
            ...ctx.alwaysAskRules,
            session: dedupKeepLast([
              ...ask.rules,
              ...(ctx.alwaysAskRules.session ?? []),
            ]),
          },
        }
      : {}),
  })
}

/**
 * #1771 & #1816 / official `ARi` — verify restored worker state matches the
 * restored session rules and latch `keepsSessionRules` before allowing writes.
 */
export function evaluateCcrKeepsSessionRules(
  restored: {
    readFailed?: boolean
    internal?: Partial<CcrSessionRulesRecord>
  } | null,
  ctx: Pick<
    ToolPermissionContext,
    'alwaysAllowRules' | 'alwaysDenyRules' | 'alwaysAskRules'
  >,
): boolean {
  const allowSet = new Set(ctx.alwaysAllowRules.session ?? [])
  const denySet = new Set(ctx.alwaysDenyRules.session ?? [])
  const askSet = new Set(ctx.alwaysAskRules.session ?? [])
  const deny = sanitizeDenyOrAskSessionRules(
    restored?.internal?.session_deny_rules,
  )
  const ask = sanitizeDenyOrAskSessionRules(
    restored?.internal?.session_ask_rules,
  )
  const allow = sanitizeAllowSessionRules(
    restored?.internal?.session_allow_rules,
    deny.whole && ask.whole,
  )
  const keeps =
    restored !== null &&
    restored.readFailed !== true &&
    deny.rules.every(r => denySet.has(r)) &&
    ask.rules.every(r => askSet.has(r)) &&
    allow.rules.every(r => allowSet.has(r))
  setCcrKeepsSessionRules(keeps)
  return keeps
}

function syncBgRespawnFlag(
  flag: string,
  aliases: readonly string[],
  value: string | null,
): void {
  try {
    const { updateBgRespawnFlag } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/cliRelaunch.js') as typeof import('../utils/cliRelaunch.js')
    updateBgRespawnFlag(flag, aliases, value)
  } catch {
    // optional
  }
}

/** Official 2.1.328 `C(e, o)` (chunk@305200639.js): sync `--effort` respawn flag. */
function syncEffortBgRespawnFlag(
  sessionEffort: SessionEffortTag | undefined,
): void {
  if (!sessionEffort) return
  switch (sessionEffort.kind) {
    case 'inherit':
    case 'default':
      syncBgRespawnFlag('--effort', [], null)
      return
    case 'level': {
      if (
        typeof sessionEffort.value === 'string' &&
        isEffortLevel(sessionEffort.value)
      ) {
        syncBgRespawnFlag('--effort', [], sessionEffort.value)
      }
      return
    }
  }
}

function additionalWorkingDirKeysChanged(
  oldDirs: ToolPermissionContext['additionalWorkingDirectories'] | undefined,
  newDirs: ToolPermissionContext['additionalWorkingDirectories'] | undefined,
): boolean {
  if (oldDirs === newDirs) return false
  const oldSize = oldDirs?.size ?? 0
  const newSize = newDirs?.size ?? 0
  if (oldSize !== newSize) return true
  if (!oldDirs || !newDirs) return false
  for (const key of newDirs.keys()) {
    if (!oldDirs.has(key)) return true
  }
  return false
}

/**
 * Official 2.1.328 `notifyMcpRootsListChanged` (`YP` in chunk@335138039.js +
 * `gIr` in chunk@305200639.js): notify live MCP servers when working directory
 * roots change.
 */
function notifyMcpRootsListChangedForState(state: AppState): void {
  try {
    const mcpClientMod =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/mcp/client.js') as {
        notifyMcpRootsListChanged?: (
          extraConnections?: ReadonlyArray<{
            type: string
            name?: string
            client?: { sendRootsListChanged?: () => Promise<void> }
          }>,
        ) => void
      }
    if (typeof mcpClientMod.notifyMcpRootsListChanged === 'function') {
      mcpClientMod.notifyMcpRootsListChanged(
        state.mcp?.clients as
          | ReadonlyArray<{
              type: string
              name?: string
              client?: { sendRootsListChanged?: () => Promise<void> }
            }>
          | undefined,
      )
      return
    }
  } catch {
    // fall through to AppState connected MCP clients
  }
  const clients = state.mcp?.clients
  if (!Array.isArray(clients)) return
  for (const conn of clients) {
    if (
      conn.type === 'connected' &&
      typeof conn.client?.sendRootsListChanged === 'function'
    ) {
      conn.client.sendRootsListChanged().catch((err: unknown) => {
        logForDebugging(
          `Failed to notify MCP server "${conn.name}" of roots change: ${toError(err).message}`,
        )
      })
    }
  }
}

// Inverse of the push below — restore on worker restart.
// Official 2.1.328 `function B(e)` (chunk@305200639.js @2800):
// refuse restored 'bypassPermissions' when disabled or unavailable, transition
// via transitionPermissionMode, and strip dangerous allow rules in auto mode.
export function externalMetadataToAppState(
  metadata: SessionExternalMetadata,
): (prev: AppState) => AppState {
  return prev => {
    let ctx = prev.toolPermissionContext
    if (typeof metadata.permission_mode === 'string') {
      let mode = permissionModeFromString(metadata.permission_mode)
      if (
        mode === 'bypassPermissions' &&
        (isBypassPermissionsModeDisabled() ||
          !ctx.isBypassPermissionsModeAvailable)
      ) {
        logForDebugging(
          "[externalMetadataToAppState] Refusing restored mode 'bypassPermissions' (disabled by settings/policy or session not launched with --dangerously-skip-permissions); falling back to 'default'",
          { level: 'warn' },
        )
        mode = 'default'
      }
      try {
        ctx = {
          ...transitionPermissionMode(ctx.mode, mode, ctx),
          mode,
        }
        if (mode === 'auto') {
          ctx = stripDangerousPermissionsForAutoMode(ctx)
        }
      } catch (err) {
        logForDebugging(
          `[externalMetadataToAppState] transitionPermissionMode rejected restored mode '${mode}': ${toError(err).message}`,
        )
      }
    }
    return {
      ...prev,
      toolPermissionContext: ctx,
    }
  }
}

export function onChangeAppState({
  newState,
  oldState,
}: {
  newState: AppState
  oldState: AppState
}) {
  // toolPermissionContext.mode — single choke point for CCR/SDK mode sync.
  //
  // Prior to this block, mode changes were relayed to CCR by only 2 of 8+
  // mutation paths: a bespoke setAppState wrapper in print.ts (headless/SDK
  // mode only) and a manual notify in the set_permission_mode handler.
  // Every other path — Shift+Tab cycling, ExitPlanModePermissionRequest
  // dialog options, the /plan slash command, rewind, the REPL bridge's
  // onSetPermissionMode — mutated AppState without telling
  // CCR, leaving external_metadata.permission_mode stale and the web UI out
  // of sync with the CLI's actual mode.
  //
  // Hooking the diff here means ANY setAppState call that changes the mode
  // notifies CCR (via notifySessionMetadataChanged → ccrClient.reportMetadata)
  // and the SDK status stream (via notifyPermissionModeChanged → registered
  // in print.ts). The scattered callsites above need zero changes.
  const prevMode = oldState.toolPermissionContext.mode
  const newMode = newState.toolPermissionContext.mode
  if (prevMode !== newMode) {
    // CCR external_metadata must not receive internal-only mode names
    // (bubble). Externalize first — and skip the CCR notify if the
    // EXTERNAL mode didn't change (e.g., default→bubble→default is noise
    // from CCR's POV since both externalize to 'default'). Official 2.1.207:
    // auto is first-class external and is reported as 'auto'. The SDK channel
    // (notifyPermissionModeChanged) passes raw mode; print.ts filters itself.
    const prevExternal = toExternalPermissionMode(prevMode)
    const newExternal = toExternalPermissionMode(newMode)
    if (prevExternal !== newExternal) {
      notifySessionMetadataChanged({
        permission_mode: newExternal,
      })
      // Official k8e: only after enableWorkerPermissionModeRecord (XWy).
      if (isWorkerPermissionModeRecordEnabled()) {
        notifyInternalMetadataChanged({
          worker_permission_mode: newExternal,
        })
      }
      // Official GN (#1578): keep bg session's respawnFlags --permission-mode in sync.
      syncBgRespawnFlag(
        '--permission-mode',
        ['--inherit-permission-mode'],
        newExternal,
      )
    }
    notifyPermissionModeChanged(newMode)
  }

  // #1771 & #1816 / official `B(oldCtx, newCtx)` — sync session-scoped
  // deny/ask/allow rules to CCR internal metadata when they change.
  const oldCtx = oldState.toolPermissionContext
  const newCtx = newState.toolPermissionContext

  // Official 2.1.328 `gIr` (chunk@305200639.js): notify connected MCP servers
  // when `additionalWorkingDirectories` changes.
  if (
    additionalWorkingDirKeysChanged(
      oldCtx.additionalWorkingDirectories,
      newCtx.additionalWorkingDirectories,
    )
  ) {
    notifyMcpRootsListChangedForState(newState)
  }
  if (
    oldCtx.alwaysAllowRules.session !== newCtx.alwaysAllowRules.session ||
    oldCtx.alwaysDenyRules.session !== newCtx.alwaysDenyRules.session ||
    oldCtx.alwaysAskRules.session !== newCtx.alwaysAskRules.session
  ) {
    const { record, whole } = buildCcrSessionRulesRecord(newCtx)
    const unchanged = isDeepStrictEqual(
      record,
      buildCcrSessionRulesRecord(oldCtx).record,
    )
    if (ccrKeepsSessionRules !== true) {
      if (ccrKeepsSessionRules === false && !unchanged) {
        logForDiagnosticsNoPII('warn', 'ccr_kept_session_rules', {
          reason: 'write_held_record_not_restored',
        })
      }
    } else {
      if (!whole) {
        logForDiagnosticsNoPII('warn', 'ccr_kept_session_rules', {
          reason: 'lists_not_written_whole',
        })
      }
      if (!unchanged) {
        notifyInternalMetadataChanged(record)
      }
    }
  }

  // densable 2.1.211 JNe / 2.1.289: e.tasks!==t.tasks →
  //   E membership → notifyInternalMetadataChanged({running_background_tasks})
  //   y membership → system/background_tasks_changed (REPLACE full live set).
  // notifyInternalMetadataChanged noops when no CCR listener is registered.
  if (newState.tasks !== oldState.tasks) {
    const prevInternal = listRunningBackgroundTasksForInternalMetadata(
      oldState.tasks,
    )
    const nextInternal = listRunningBackgroundTasksForInternalMetadata(
      newState.tasks,
    )
    if (backgroundTasksMembershipChanged(prevInternal, nextInternal)) {
      notifyInternalMetadataChanged({
        running_background_tasks: nextInternal,
      })
    }

    const prevLive = listLiveBackgroundTasks(oldState.tasks)
    const nextLive = listLiveBackgroundTasks(newState.tasks)
    if (backgroundTasksMembershipChanged(prevLive, nextLive)) {
      try {
        const { emitBackgroundTasksChangedSdk } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../utils/sdkEventQueue.js') as typeof import('../utils/sdkEventQueue.js')
        emitBackgroundTasksChangedSdk(nextLive)
      } catch {
        // optional
      }
    }
  }

  // mainLoopModel: session-scoped only (do NOT persist to userSettings).
  // Writing to settings.json would leak model changes into other running
  // sessions (anthropics/claude-code#37596). Each process keeps its own
  // model override in memory via setMainLoopModelOverride.
  if (newState.mainLoopModel !== oldState.mainLoopModel) {
    setMainLoopModelOverride(newState.mainLoopModel)
    syncBgRespawnFlag('--model', ['-m'], newState.mainLoopModel)
  }

  // Official 2.1.328 `gIr` (chunk@305200639.js): when sessionEffort changes,
  // clear carriedEffort latch (`boo()`), clear session org effort caps
  // (`S9e().clear()`), and sync `--effort` respawn flag (`C()`).
  const effortChanged = !sessionEffortEquals(
    newState.sessionEffort,
    oldState.sessionEffort,
  )
  if (effortChanged) {
    clearCarriedEffortFromLatch('effort_change')
    clearSessionOrgEffortCaps()
    syncEffortBgRespawnFlag(newState.sessionEffort)
  }

  // Official 2.1.328 `gIr`: keep bg session `--advisor` respawn flag in sync.
  if (newState.advisorModel !== oldState.advisorModel) {
    syncBgRespawnFlag('--advisor', [], newState.advisorModel ?? null)
  }

  if (
    newState.ultracode !== oldState.ultracode ||
    effortChanged ||
    newState.mainLoopModel !== oldState.mainLoopModel ||
    newState.mainLoopModelForSession !== oldState.mainLoopModelForSession ||
    newState.settings !== oldState.settings ||
    newState.toolPermissionContext.mode !== oldState.toolPermissionContext.mode
  ) {
    const runtimeModel = getRuntimeMainLoopModel({
      permissionMode: newState.toolPermissionContext.mode,
      mainLoopModel:
        newState.mainLoopModelForSession ??
        newState.mainLoopModel ??
        getMainLoopModel(),
    })
    const effortValue = pdSessionEffort({
      sessionEffort: newState.sessionEffort,
      settingsEffortTable: newState.settingsEffortTable,
      mainLoopModel: newState.mainLoopModel,
      mainLoopModelForSession: newState.mainLoopModelForSession,
    })
    notifyUltracodeActive(
      isUltracodeModeActive(runtimeModel, effortValue, newState.ultracode),
    )
    if (
      oldState.ultracode === true &&
      newState.ultracode !== true &&
      !effortChanged &&
      newState.sessionEffort?.kind === 'level'
    ) {
      syncEffortBgRespawnFlag(newState.sessionEffort)
    }
  }

  // expandedView → persist as showExpandedTodos + showSpinnerTree for backwards compat
  if (newState.expandedView !== oldState.expandedView) {
    const showExpandedTodos = newState.expandedView === 'tasks'
    const showSpinnerTree = newState.expandedView === 'teammates'
    if (
      getGlobalConfig().showExpandedTodos !== showExpandedTodos ||
      getGlobalConfig().showSpinnerTree !== showSpinnerTree
    ) {
      saveGlobalConfig(current => ({
        ...current,
        showExpandedTodos,
        showSpinnerTree,
      }))
    }
  }

  // verbose
  if (
    newState.verbose !== oldState.verbose &&
    getGlobalConfig().verbose !== newState.verbose
  ) {
    const verbose = newState.verbose
    saveGlobalConfig(current => ({
      ...current,
      verbose,
    }))
  }

  // tungstenPanelVisible (ant-only tmux panel sticky toggle)
  if (process.env.USER_TYPE === 'ant') {
    if (
      newState.tungstenPanelVisible !== oldState.tungstenPanelVisible &&
      newState.tungstenPanelVisible !== undefined &&
      getGlobalConfig().tungstenPanelVisible !== newState.tungstenPanelVisible
    ) {
      const tungstenPanelVisible = newState.tungstenPanelVisible
      saveGlobalConfig(current => ({ ...current, tungstenPanelVisible }))
    }
  }

  // settings: clear auth-related caches when settings change
  // This ensures apiKeyHelper and AWS/GCP credential changes take effect immediately
  if (newState.settings !== oldState.settings) {
    try {
      clearApiKeyHelperCache()
      clearAwsCredentialsCache()
      clearGcpCredentialsCache()

      // Re-apply environment variables when settings.env changes
      // This is additive-only: new vars are added, existing may be overwritten, nothing is deleted
      if (newState.settings.env !== oldState.settings.env) {
        applyConfigEnvironmentVariables()
      }
    } catch (error) {
      logError(toError(error))
    }
  }
}
