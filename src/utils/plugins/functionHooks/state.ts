/**
 * Function hooks submodule: state
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { getIsNonInteractiveSession } from '../../../bootstrap/state.js'
import { isBuiltinPluginId } from '../../../plugins/builtinPlugins.js'
import type { AppState } from '../../../state/AppStateStore.js'
import { createStore } from '../../../state/store.js'
import { logForDebugging } from '../../debug.js'
import { invalidateRender } from '../../render/invalidateAllRenders.js'
import {
  RootSessionSlot,
  getActiveSessionFromAls,
  getBootstrapSession,
  runWithSession,
} from '../../sessionHost.js'
import { createSignal } from '../../signal.js'
import { handlerTier } from '../functionHooksHop.js'
import { AsyncLocalStorage } from 'async_hooks'
import { createHash } from 'crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import {
  DEFAULT_PLUGIN_INPUT_SESSION_KEY,
  ENGINE_HOOK_ORIGIN,
  FAULT_RENDER_LIVE,
  FAULT_RENDER_LIVE_MS,
  FAULT_RENDER_STATE_SUFFIX,
  FAULT_RENDER_STEADY_MS,
  STORE_DOS_RE,
  STORE_HASH,
  STORE_NAME_MAX,
  STORE_PLUGIN_RE,
  createInitialHookedMergeState,
  describeThrown,
  emptyClientFaultFold,
  functionHookPatternMatches,
  isBuiltinTierMod,
  isEventRecord,
  leftOutRegistrationsForModule,
  resolvedKey,
} from './constants.js'
import { createHeldPressStore } from './heldPressStore.js'
import {
  RASTER_ADMISSION_TOKENS,
  createRasterPaletteWithAdmission,
} from './raster.js'
import type {
  AskedPaneRef,
  ClientFaultRun,
  ClientMessageQueued,
  ConfigOverlayValue,
  DrawingReaderRecord,
  FunctionHookFailedReport,
  FunctionHooksHost,
  FunctionHooksToolUseContext,
  FunctionHooksWorkerClientLike,
  HdPluginBump,
  HeldPressRecord,
  HookCallOrigin,
  HookOriginEntry,
  HookServingContext,
  HookedMergeState,
  HostOpPort,
  ImageSite,
  LoadedFunctionHooksModule,
  PanesListener,
  PanesTerminalSize,
  PassedByRecord,
  PersonalPluginEnvWrite,
  PluginAgentRecord,
  PluginCommandSpec,
  PluginDrawingTree,
  PluginFieldSeatBucket,
  PluginFocusSite,
  PluginPaneEntry,
  PluginSite,
  RasterAdmission,
  RasterPalette,
  RasterSite,
  SessionAuthHandleEntry,
  SessionStartDedupEntry,
  SessionStartDedupOp,
  SessionStartDedupRecord,
  SessionThemeState,
  StateRef,
  UiAskHostInput,
  UiAskHostResult,
  UiNotifyChannelResult,
  UiRenderDrawing,
  UiRenderEvalRecord,
  UiViewShowResult,
} from './types.js'
import { matcherAllows } from './uiValidation.js'

export type FunctionHooksRuntimeBridge = {
  onHookFailed: (report: FunctionHookFailedReport) => void
  buildPluginEngine: (
    mod: { name: string; root?: string },
    environmentId?: string,
  ) => Record<string, unknown>
  callPluginInterface: (
    environmentId: string,
    call: { name: string; method: string },
    args?: unknown[],
    callers?: unknown[],
    hookOrigin?: readonly HookOriginEntry[],
  ) => Promise<unknown>
  unloadModule: (name: string) => void
  retireModule: (name: string) => Promise<void>
}

export const runtimeBridge: FunctionHooksRuntimeBridge = {
  onHookFailed() {},
  buildPluginEngine() {
    throw new Error('functionHooks pluginEngine bridge not initialized')
  },
  async callPluginInterface() {
    throw new Error('functionHooks callPluginInterface bridge not initialized')
  },
  unloadModule() {},
  async retireModule() {},
}

export function createRasterPalette(
  now: () => number = Date.now,
  admission: RasterAdmission = fhState().rasterAdmission,
): RasterPalette {
  return createRasterPaletteWithAdmission(now, admission)
}

/** densable rootEvent ALS for Loe/Noe — outer hook name is kept. */
export const hookDispatch = new AsyncLocalStorage<{ event: string }>()

/** Guard against collector telemetry.log re-entry / road self-deadlock. */
export const collectorTelemetryDispatchAls = new AsyncLocalStorage<boolean>()

/** densable `fse` / `pse` — active hook frame stack for op re-entrancy (`de`/`Dt`). */
export const activeHookOriginAls = new AsyncLocalStorage<
  readonly HookOriginEntry[]
>()

export function buildOpHookOrigin(
  callerPlugin?: string,
): readonly HookOriginEntry[] {
  const active = activeHookOriginAls.getStore() ?? []
  if (callerPlugin === undefined || callerPlugin === '') return active
  const last = active.at(-1)
  const lastPlugin =
    last === undefined
      ? undefined
      : typeof last === 'string'
        ? last
        : last.plugin
  if (lastPlugin === callerPlugin) return active
  return [...active, callerPlugin]
}

export function getLiveHookEvent(): string | undefined {
  return hookDispatch.getStore()?.event
}

function slotVal<T>(value: T): T {
  return value
}

function createSessionFunctionHooksModulesState() {
  const pluginState = new Map<string, { value: unknown; version: number }>()
  const pluginSession = {
    values: pluginState,
    readers: new Map<string, DrawingReaderRecord>(),
    readersOf: new Map<string, Set<string>>(),
    mounted: new Map<string, number>(),
    faultRuns: new Map<string, ClientFaultRun>(),
    bumps: 0,
    versionFloor: 0,
    folds: {
      steady: emptyClientFaultFold(),
      live: emptyClientFaultFold(),
    },
  }
  const paneOpenIds = new Set<string>()
  let shownPaneId: string | null = null
  let focusedPaneId: string | null = null
  const paneClosing = new Set<string>()
  const askedPanes: AskedPaneRef[] = []
  const hdPluginLiveBump = scheduleHdPluginBump('live')
  const hdPluginSteadyBump = scheduleHdPluginBump('steady', {
    onBump: (plugin, at) => hdPluginLiveBump.bump(plugin, at, true),
  })
  const rasterAdmission: RasterAdmission = {
    tokens: RASTER_ADMISSION_TOKENS,
    refilledAt: 0,
  }
  const sharedRasterPalette = createRasterPaletteWithAdmission(
    Date.now,
    rasterAdmission,
  )
  return {
    loadedModules: slotVal<LoadedFunctionHooksModule[]>([]),
    environmentArgs: new Map<string, LoadedFunctionHooksModule>(),
    laterLoadedSessionStart: slotVal<
      ((mods: readonly LoadedFunctionHooksModule[]) => void) | undefined
    >(undefined),
    lastUiRenderPlugin: '',
    hookRegistrationEpoch: 0,
    agentSpawnLaunchDepth: 0,
    skipFirstLog: new Map<string, number>(),
    skipPersistOnce: new Set<string>(),
    functionHooksHost: slotVal<FunctionHooksHost>({
      log() {},
      hookFailed(report) {
        runtimeBridge.onHookFailed(report)
      },
    }),
    hooksPassedBySessions: new Map<string, Map<string, PassedByRecord>>(),
    hooksPassedByLines: slotVal<
      Array<{
        plugin: string
        event: string
        by: string
        line: string
      }>
    >([]),
    pluginState,
    pluginSession,
    pluginAgents: new Map<string, PluginAgentRecord>(),
    pluginAgentSpawns: new Map<string, number>(),
    pluginSpawnCallers: new Map<string, string>(),
    pluginCommands: new Map<
      string,
      { plugin: string; spec: PluginCommandSpec }
    >(),
    commandRunHandler: slotVal<
      ((slash: string) => Promise<unknown> | unknown) | undefined
    >(undefined),
    pluginStore: new Map<string, unknown>(),
    promptBoxText: '',
    promptBoxCursor: 0,
    promptBoxBound: false,
    uiResolvePressCounter: 0,
    sessionAuthEntries: new Map<string, SessionAuthHandleEntry>(),
    sessionAuthHandlesByPlugin: new Map<string, string[]>(),
    clockCallbacks: slotVal<Array<{ cancel: () => void }>>([]),
    audioPlays: new Map<string, number>(),
    configOverlay: new Map<string, ConfigOverlayValue>(),
    settingsOverlay: new Map<string, Map<string, unknown>>(),
    personalPluginEnvWrites: new Map<string, PersonalPluginEnvWrite>(),
    envIsolationOpen: false,
    hookedMergeState: slotVal<HookedMergeState>(
      createInitialHookedMergeState(),
    ),
    hostOpPorts: new Map<string, HostOpPort>(),
    hostOpCounter: 0,
    pendingHostOps: new Map<
      number,
      { resolve: (value: unknown) => void; reject: (err: Error) => void }
    >(),
    promptMediaEntries: new Map<
      string,
      () => Promise<
        | { type: 'image' | 'document'; mediaType: string; bytes: Buffer }
        | { deny: string }
        | { unreadable: string }
      >
    >(),
    promptMediaSeq: 0,
    uiViewHostHandler: slotVal<
      ((args: { agentId?: string }) => Promise<UiViewShowResult>) | undefined
    >(undefined),
    turnCacheSafeParams: new Map<
      string,
      import('../../forkedAgent.js').CacheSafeParams
    >(),
    functionHooksToolUseContext: slotVal<
      FunctionHooksToolUseContext | undefined
    >(undefined),
    pluginOwnedMcpServers: new Map<string, Set<string>>(),
    pluginMcpConnections: new Map<
      string,
      Promise<import('../pluginToolSessionHost.js').PluginMcpConnection>
    >(),
    backgroundCeilingProvider: slotVal<(() => string | undefined) | undefined>(
      undefined,
    ),
    stoppedSessionForPluginInput: slotVal<
      { sessionKey: object; stoppedAt: number } | undefined
    >(undefined),
    spawnedTurnTakenCallback: slotVal<(() => void) | undefined>(undefined),
    toolCallHandler: slotVal<
      ((input: Record<string, unknown>) => Promise<unknown>) | undefined
    >(undefined),
    toolCheckHandler: slotVal<
      ((input: Record<string, unknown>) => Promise<unknown>) | undefined
    >(undefined),
    turnAbortHandler: slotVal<
      ((input: { turnId: string }) => Promise<unknown>) | undefined
    >(undefined),
    promptSubmitHandler: slotVal<
      ((input: { text: string }) => Promise<unknown>) | undefined
    >(undefined),
    sessionCompactHandler: slotVal<
      ((input: { instructions: string }) => Promise<unknown>) | undefined
    >(undefined),
    turnRunningReader: slotVal<
      (() => { turnId: string } | undefined) | undefined
    >(undefined),
    pendingUiInvalidations: new Set<string>(),
    defaultUiInvalidationHandlers: slotVal<Partial<Record<string, () => void>>>(
      {},
    ),
    pluginPanes: slotVal<
      Array<{
        id: string
        plugin: string
        title: string
        closeOnEscape?: boolean
        holdToasts?: boolean
        rows?: number
        columns?: number
      }>
    >([]),
    paneOpenIds,
    get shownPaneId(): string | null {
      return shownPaneId
    },
    set shownPaneId(v: string | null) {
      shownPaneId = v
    },
    get focusedPaneId(): string | null {
      return focusedPaneId
    },
    set focusedPaneId(v: string | null) {
      focusedPaneId = v
    },
    paneClosing,
    unplacedPanes: slotVal<PluginPaneEntry[]>([]),
    askedPanes,
    askedPanesSeeded: false,
    panesTerminalSize: slotVal<PanesTerminalSize | undefined>(undefined),
    paneFocusRequest: slotVal<string | null>(null),
    panePlacements: 0,
    panesListeners: new Set<PanesListener>(),
    pluginSites: slotVal<PluginSite[]>([]),
    ideSites: new Map<string, PluginSite>(),
    focusSiteDraws: createSignal(),
    pluginFocusSites: new Map<string, PluginFocusSite>(),
    pluginDrawings: slotVal<PluginDrawingTree[]>([]),
    uiRenderEvalCache: new Map<string, UiRenderEvalRecord>(),
    uiRenderEvalHd: slotVal<Map<string, number> | undefined>(undefined),
    uiRenderEvalEngineVersion: 0,
    uiRenderEvalReuseCount: 0,
    mountedRasters: new Map<string, RasterSite>(),
    mountedImages: new Map<string, ImageSite>(),
    rasterFrameVersion: 0,
    rasterFrameListeners: new Set<() => void>(),
    rasterAdmission,
    sharedRasterPalette,
    pluginInputSeatStore: createStore<PluginFieldSeatBucket>(new Map()),
    pluginSelectSeatStore: createStore<PluginFieldSeatBucket>(new Map()),
    pluginFieldSeatGenerationStore: createStore<Map<string, number>>(new Map()),
    paneRemountGeneration: new Map<string, number>(),
    pendingPromptSelectionRun: slotVal<number | undefined>(undefined),
    ownedTables: new Map<string, Record<string, Record<string, unknown>>>(),
    finalizedEnvironments: new Set<string>(),
    resolvedTables: new Map<string, unknown>(),
    resolvedByKey: new Map<string, Map<string, unknown>>(),
    lastInterfaceCallers: slotVal<unknown[]>([]),
    interfaceCallerStack: slotVal<unknown[][]>([]),
    recordedPresses: slotVal<
      Array<{
        environmentId: string
        handle: unknown
        event: unknown
      }>
    >([]),
    pressHandlers: new Map<string, (event: unknown) => unknown>(),
    nextClientPressHandle: 0,
    heldPressStore: createHeldPressStore(),
    clientPressHandlesByPlugin: new Map<string, Set<number>>(),
    uiAskHandler: slotVal<
      ((question: string, options: string[]) => Promise<string>) | undefined
    >(undefined),
    uiAskHostHandler: slotVal<
      ((input: UiAskHostInput) => Promise<UiAskHostResult>) | undefined
    >(undefined),
    uiToastShowHandler: slotVal<
      | ((input: { plugin: string; text: string; timeoutMs?: number }) => void)
      | undefined
    >(undefined),
    uiNotifyHandler: slotVal<
      | ((input: {
          plugin: string
          message: string
          title: string
          notificationType: 'plugin_notification'
          key?: string
          delayMs?: number
          at?: number
          untilBack?: boolean
        }) => Promise<UiNotifyChannelResult> | UiNotifyChannelResult)
      | undefined
    >(undefined),
    uiCancelNotifyHandler: slotVal<
      | ((input: { plugin: string; key: string }) => Promise<boolean> | boolean)
      | undefined
    >(undefined),
    uiStatusHandler: slotVal<
      | ((input: { plugin: string; text: string | undefined }) => void)
      | undefined
    >(undefined),
    pluginToastLastAt: new Map<string, number>(),
    functionHooksAppStateReader: slotVal<
      (() => AppState | undefined) | undefined
    >(undefined),
    functionHooksAppStateWriter: slotVal<
      ((updater: (prev: AppState) => AppState) => void) | undefined
    >(undefined),
    agentSpawnHandler: slotVal<
      ((input: Record<string, unknown>) => Promise<unknown>) | undefined
    >(undefined),
    pluginHostCalls: slotVal<
      Array<{
        namespace: string
        method: string
        args: unknown[]
      }>
    >([]),
    functionHooksWorker: slotVal<FunctionHooksWorkerClientLike | null>(null),
    workerOwnsDispatch: false,
    workerReplacementPromise: slotVal<Promise<void> | undefined>(undefined),
    resolveWorkerReplacement: slotVal<(() => void) | undefined>(undefined),
    sessionStartDedupStore: new Map<string, SessionStartDedupRecord>(),
    inFlightByModule: new Map<string, number>(),
    pluginRenderCooldownUntil: new Map<string, number>(),
    faultRenderVersions: new Map<string, number>(),
    hdPluginLiveBump,
    hdPluginSteadyBump,
    pluginBandExpanded: true,
    clientMessagePosts: new Map<string, ClientMessageQueued>(),
    clientMessageDrain: slotVal<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    ),
    clientMessagesDispatched: 0,
    headlessPluginOutputFormat: slotVal<string | null>(null),
    pendingHeadlessModStderrLines: slotVal<string[]>([]),
    emittedHeadlessModStderrLines: new Set<string>(),
    sessionTheme: slotVal<SessionThemeState | undefined>(undefined),
    sessionThemeListeners: new Set<() => void>(),
    themeTurns: {
      taken: 0,
      landed: 0,
      gone: new Map<string, number>(),
    },
  }
}

export type SessionFunctionHooksModulesState = ReturnType<
  typeof createSessionFunctionHooksModulesState
>

const sessionFunctionHooksSlot =
  new RootSessionSlot<SessionFunctionHooksModulesState>(
    createSessionFunctionHooksModulesState,
  )

export function fhState(): SessionFunctionHooksModulesState {
  return sessionFunctionHooksSlot.of(getBootstrapSession())
}

export const activeHookModuleAls =
  new AsyncLocalStorage<LoadedFunctionHooksModule>()

export const activeHookServingAls = new AsyncLocalStorage<HookServingContext>()

export function getCurrentHeldTurnId(): string | undefined {
  return activeHookServingAls.getStore()?.turnHeld
}

/**
 * densable `Azn` — `yn` installs the late-load `session.start` callback
 * (`Azn.set`); a module replace calls `Azn.get()?.(e)`. The callback lives
 * here so the hub never imports the hooks module.
 */

/** densable `Azn.set`. `undefined` clears the slot (`et(js(), e => e.set(void 0))`). */
export function setLaterLoadedSessionStart(
  callback: ((mods: readonly LoadedFunctionHooksModule[]) => void) | undefined,
): void {
  fhState().laterLoadedSessionStart = callback
}

/** densable `dse` / `Azn.get()?.(e)`. */
export function notifyFunctionHooksModulesLoaded(
  mods?: readonly LoadedFunctionHooksModule[],
): void {
  fhState().laterLoadedSessionStart?.(mods ?? fhState().loadedModules)
}

/** densable last hook that returned a `ui.render` tree (`Te` restamp). */

/** densable lead for `L1t` / `Imt` — empty when no hook returned a tree. */
export function getLastUiRenderPlugin(): string {
  return fhState().lastUiRenderPlugin
}

export const uiRenderDrawingAls = new AsyncLocalStorage<UiRenderDrawing>()

/** densable `Yer` / `gSt` — occupancy of an in-flight hook-chain eval. */
export const hookEvalAls = new AsyncLocalStorage<true>()

export function isInsideHookEval(): boolean {
  return hookEvalAls.getStore() !== undefined
}

export function noteStateRead(key: string, version: number): void {
  const store = uiRenderDrawingAls.getStore()
  if (!store || store.isEnded) return
  if (!store.versionsRead.has(key)) store.versionsRead.set(key, version)
}

export function getLoadedFunctionHooksModules(): readonly LoadedFunctionHooksModule[] {
  return fhState().loadedModules
}

/** densable `cLo` — exact `classic.<event>` on a loaded module. */
export function hasClassicFunctionHook(event: string): boolean {
  if (fhState().workerReplacementPromise !== undefined) return true
  const needle = `classic.${event}`
  return fhState().loadedModules.some(mod => mod.patterns.includes(needle))
}

/** densable `zk` / `Cc` — some loaded hook's pattern matches the event. */
export function hasMatchingFunctionHook(
  event: string,
  payload?: Record<string, unknown>,
  among?: readonly LoadedFunctionHooksModule[],
): boolean {
  // #305: while the hooks worker is restarting, don't skip classic.* events
  // before runFunctionHookChain can wait for the replacement modules.
  if (among === undefined && fhState().workerReplacementPromise !== undefined) {
    return true
  }
  const needle = event.includes('.') ? event : `classic.${event}`
  return (among ?? fhState().loadedModules).some(mod =>
    (mod.hooks ?? []).some(hook => {
      if (!functionHookPatternMatches(hook.pattern, needle)) return false
      if (payload === undefined) return true
      return matcherAllows(hook.matcher, payload, needle, isBuiltinTierMod(mod))
    }),
  )
}

/** densable `qP(e, r.origin)` — non-empty match after re-entrancy `de`/`Dt`. */
export function hasMatchingFunctionHookForOp(
  event: string,
  payload: Record<string, unknown>,
  hookOrigin: readonly HookOriginEntry[],
): boolean {
  const needle = event.includes('.') ? event : `classic.${event}`
  return fhState().loadedModules.some(mod => {
    if (mod.status === 'unloaded') return false
    if (
      mod.status === 'retiring' &&
      (fhState().inFlightByModule.get(mod.name) ?? 0) === 0
    ) {
      return false
    }
    const leftOut = leftOutRegistrationsForModule(hookOrigin, mod.name)
    if (leftOut === 'every') return false
    const builtin = isBuiltinTierMod(mod)
    return (mod.hooks ?? []).some((hook, registration) => {
      if (leftOut.includes(registration)) return false
      if (!functionHookPatternMatches(hook.pattern, needle)) return false
      return matcherAllows(hook.matcher, payload, needle, builtin)
    })
  })
}

/**
 * densable `iVn` / `CLt.perform` — AgentTool.call is the launch core.
 * `$.agent.spawn` already ran the chain; skip a second `bn` wrap.
 */

export function isInsideAgentSpawnLaunch(): boolean {
  return fhState().agentSpawnLaunchDepth > 0
}

/** densable `pc` / `oGt`. In-process default runs `xBt`; worker host posts. */

export function setFunctionHooksHost(host: FunctionHooksHost): void {
  fhState().functionHooksHost = host
}

/** densable `jJ` — resolve `{ plugin, tier }` for `next.origin`. */
export function resolveHookCallOrigin(callerPlugin?: string): HookCallOrigin {
  if (callerPlugin === undefined || callerPlugin === '') {
    return ENGINE_HOOK_ORIGIN
  }
  const found = fhState().loadedModules.find(mod => mod.name === callerPlugin)
  const tier =
    found !== undefined
      ? handlerTier({
          name: found.name,
          tier: found.tier,
          isManaged: found.isManaged,
          isCore: found.isCore,
        })
      : isBuiltinPluginId(callerPlugin) || callerPlugin.startsWith('builtin:')
        ? 'builtin'
        : 'user'
  return Object.freeze({ plugin: callerPlugin, tier })
}

/**
 * densable `dt().pluginState` / `nqr()` / `Q_()`.
 * `values` is `$.state`; `faultRuns`/`mounted`/`bumps` are cO/uO/BC.
 * `folds` is Amt/Zc live=34ms / steady=100ms debounce.
 */

export function stateKey(ref: StateRef): string {
  return `${ref.plugin}\0${ref.key}\0${ref.id ?? ''}`
}

export function readStateRef(ref: unknown, op: string): StateRef {
  if (!isEventRecord(ref)) {
    throw new Error(`$.state.${op} takes { plugin, key }`)
  }
  const plugin = ref.plugin
  const key = ref.key
  const id = ref.id
  if (typeof plugin !== 'string' || typeof key !== 'string') {
    throw new Error(`$.state.${op} takes { plugin, key }`)
  }
  if (id !== undefined && typeof id !== 'string') {
    throw new Error(`$.state.${op} id must be a string`)
  }
  return id === undefined ? { plugin, key } : { plugin, key, id }
}

/** densable host `command.run` — REPL queues `/${command}` (or with args). */
export function setCommandRunHandler(
  handler: ((slash: string) => Promise<unknown> | unknown) | undefined,
): void {
  fhState().commandRunHandler = handler
}

export function getPluginRegisteredCommands(): ReadonlyArray<{
  plugin: string
  spec: PluginCommandSpec
}> {
  return [...fhState().pluginCommands.values()]
}

export function forgetPluginCommands(plugin?: string): void {
  if (plugin === undefined) {
    fhState().pluginCommands.clear()
    return
  }
  for (const [name, record] of [...fhState().pluginCommands.entries()]) {
    if (record.plugin === plugin) fhState().pluginCommands.delete(name)
  }
}

export function bindHostOpPort(environmentId: string, port: HostOpPort): void {
  const state = fhState()
  state.hostOpPorts.set(environmentId, port)
  port.on?.('message', (raw: unknown) => {
    const message = isEventRecord(raw) ? raw : undefined
    if (!message) return
    if (message.type === 'op_result' || message.type === 'op_error') {
      const pending = state.pendingHostOps.get(Number(message.opId))
      if (!pending) return
      state.pendingHostOps.delete(Number(message.opId))
      if (message.type === 'op_error')
        pending.reject(new Error(String(message.error ?? 'op_error')))
      else pending.resolve(message.value)
    }
  })
}

export function unbindHostOpPort(environmentId: string): void {
  fhState().hostOpPorts.delete(environmentId)
}

export function setUiViewHost(
  handler:
    | ((args: { agentId?: string }) => Promise<UiViewShowResult>)
    | undefined,
): void {
  fhState().uiViewHostHandler = handler
}

export function setTurnRequestCacheSafeParams(
  turnId: string,
  params: import('../../forkedAgent.js').CacheSafeParams,
): void {
  fhState().turnCacheSafeParams.set(turnId, params)
}

export function clearTurnRequestCacheSafeParams(turnId: string): void {
  fhState().turnCacheSafeParams.delete(turnId)
}

export function setBackgroundCeilingProvider(
  provider: (() => string | undefined) | undefined,
): void {
  fhState().backgroundCeilingProvider = provider
}

export function markSessionStoppedForPluginInput(
  sessionKey: object = DEFAULT_PLUGIN_INPUT_SESSION_KEY,
  stoppedAt = Date.now(),
): void {
  fhState().stoppedSessionForPluginInput = { sessionKey, stoppedAt }
}

export function clearSessionStoppedForPluginInput(): void {
  fhState().stoppedSessionForPluginInput = undefined
}

export function setSpawnedTurnTakenCallback(
  cb: (() => void) | undefined,
): void {
  fhState().spawnedTurnTakenCallback = cb
}

export function notePluginSpawnedTurnTaken(): void {
  fhState().spawnedTurnTakenCallback?.()
}

export function getPluginInputRefusalReason(
  sessionKey: object = DEFAULT_PLUGIN_INPUT_SESSION_KEY,
): string | undefined {
  const stopped = fhState().stoppedSessionForPluginInput
  if (stopped !== undefined && stopped.sessionKey === sessionKey) {
    return 'the session was stopped and nobody has sent input since'
  }
  return fhState().backgroundCeilingProvider?.()
}

export function checkPluginInputRefusal(
  opts: { plugin: string; vouchedPressAt?: number; sessionKey?: object },
  opName: string,
): string | undefined {
  const stopped = fhState().stoppedSessionForPluginInput
  if (
    stopped !== undefined &&
    opts.vouchedPressAt !== undefined &&
    opts.vouchedPressAt >= stopped.stoppedAt
  ) {
    clearSessionStoppedForPluginInput()
  }
  const reason = getPluginInputRefusalReason(opts.sessionKey)
  if (reason !== undefined) {
    logForDebugging(`${opName} (${opts.plugin}): refused: ${reason}`)
  }
  return reason
}

export function getPendingUiInvalidations(): ReadonlySet<string> {
  return fhState().pendingUiInvalidations
}

export function registerUiInvalidationHandlers(
  handlers: Partial<Record<string, () => void>>,
): void {
  Object.assign(fhState().defaultUiInvalidationHandlers, handlers)
}

export function applyPendingUiInvalidations(
  handlers: Partial<Record<string, () => void>> = {},
): string[] {
  const merged = { ...fhState().defaultUiInvalidationHandlers, ...handlers }
  const applied: string[] = []
  for (const event of fhState().pendingUiInvalidations) {
    try {
      merged[event]?.()
      applied.push(event)
    } catch (err) {
      logForDebugging(
        `$.ui.invalidate("${event}"): the cache drop threw: ${describeThrown(err)}`,
        { level: 'error' },
      )
    }
  }
  fhState().pendingUiInvalidations.clear()
  return applied
}

/** densable `Ide` / `Fj(component, requestId)` — Map index over `pluginSites`. */

export function ideSiteKey(
  component: PluginSite['component'],
  requestId: string,
): string {
  return `${component}:${requestId}`
}

export function ideGet(
  component: PluginSite['component'],
  requestId: string,
): PluginSite | undefined {
  return fhState().ideSites.get(ideSiteKey(component, requestId))
}

export function getPluginDrawingTrees(): readonly PluginDrawingTree[] {
  return fhState().pluginDrawings
}

/** densable `AL` / `CL` — keyed by IL(requestId, key, plugin). */

export function bumpRasterFrames(): void {
  fhState().rasterFrameVersion += 1
  for (const listener of fhState().rasterFrameListeners) listener()
}

export function subscribeRasterFrames(listener: () => void): () => void {
  const listeners = fhState().rasterFrameListeners
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getRasterFrameVersion(): number {
  return fhState().rasterFrameVersion
}

export function unmountRequest(requestId: string): void {
  for (let i = fhState().pluginDrawings.length - 1; i >= 0; i--) {
    if (fhState().pluginDrawings[i]?.requestId === requestId)
      fhState().pluginDrawings.splice(i, 1)
  }
  for (const [siteKey, site] of [...fhState().mountedRasters.entries()]) {
    for (const mount of [...site.rasters]) {
      if (mount.requestId === requestId) site.rasters.delete(mount)
    }
    if (site.rasters.size === 0) fhState().mountedRasters.delete(siteKey)
  }
  for (const [siteKey, site] of [...fhState().mountedImages.entries()]) {
    for (const mount of [...site.images]) {
      if (mount.requestId === requestId) site.images.delete(mount)
    }
    if (site.images.size === 0) fhState().mountedImages.delete(siteKey)
  }
}

function pluginStoreRoot(): string {
  const home = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  return join(home, 'plugins', 'store')
}

function pluginStoreFileName(plugin: string): string {
  if (
    STORE_PLUGIN_RE.test(plugin) &&
    !STORE_DOS_RE.test(plugin) &&
    plugin.length <= STORE_NAME_MAX &&
    plugin !== '.' &&
    plugin !== '..'
  ) {
    return `${plugin}.json`
  }
  const cleaned = plugin.replace(/[^a-zA-Z0-9_-]/g, '_')
  const hash = createHash('sha256')
    .update(plugin)
    .digest('hex')
    .slice(0, STORE_HASH)
  return `${cleaned.slice(0, STORE_NAME_MAX) || 'plugin'}-${hash}.json`
}

export function pluginStorePath(plugin: string): string {
  return join(pluginStoreRoot(), pluginStoreFileName(plugin))
}

export function readPluginStoreFile(plugin: string): Record<string, unknown> {
  const path = pluginStorePath(plugin)
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return isEventRecord(parsed) ? parsed : {}
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : ''
    if (code === 'ENOENT') return {}
    throw new Error(
      `${plugin}: $.store.get failed: store file ${path} is unreadable (${err instanceof Error ? err.message : String(err)})`,
    )
  }
}

export function writePluginStoreFile(
  plugin: string,
  data: Record<string, unknown>,
): void {
  const path = pluginStorePath(plugin)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    `${JSON.stringify(data, null, 2)}
`,
  )
}

export function pluginStoreSlot(plugin: string, key: string): string {
  return `${plugin}\0${key}`
}

export function setOwnedTable(
  environmentId: string,
  table: Record<string, Record<string, unknown>>,
): void {
  fhState().ownedTables.set(environmentId, table)
  fhState().finalizedEnvironments.delete(environmentId)
}

/**
 * densable `Ra` — activation.finalize(table, suppressed).
 * Second finalize throws `$ is already built`. Freezes the owned table.
 */
export function moduleTierRank(name: string): number {
  const mod = fhState().loadedModules.find(m => m.name === name)
  if (!mod) return 0
  if (mod.isCore === true) return 3
  if (
    mod.isManaged === true ||
    mod.tier === 'prepend' ||
    mod.tier === 'append'
  ) {
    return 2
  }
  return 1
}

/**
 * densable `$xr.store` via worker `resolveTables`.
 * Stores answers keyed by `surface:component`.
 */
export function storeResolvedTables(
  environmentId: string,
  requests: unknown,
): void {
  fhState().resolvedTables.set(environmentId, requests)
  const byKey = new Map<string, unknown>()
  if (Array.isArray(requests)) {
    for (const item of requests) {
      if (!isEventRecord(item)) continue
      const surface =
        typeof item.surface === 'string' ? item.surface : undefined
      const component =
        typeof item.component === 'string' ? item.component : undefined
      if (surface === undefined || component === undefined) continue
      byKey.set(resolvedKey(surface, component), item.answer)
    }
  }
  fhState().resolvedByKey.set(environmentId, byKey)
}

export function getResolvedTables(environmentId: string): unknown {
  return fhState().resolvedTables.get(environmentId)
}

export function getResolvedAnswer(
  environmentId: string,
  surface: string,
  component: string,
): unknown {
  return fhState()
    .resolvedByKey.get(environmentId)
    ?.get(resolvedKey(surface, component))
}

export function getOwnedTable(
  environmentId: string,
): Record<string, Record<string, unknown>> | undefined {
  return fhState().ownedTables.get(environmentId)
}

export function isOwnedTableFinalized(environmentId: string): boolean {
  return fhState().finalizedEnvironments.has(environmentId)
}

/**
 * densable Gy.call / `_vo` callers: nested interface.call sees the callers
 * stack written for this call.
 */

export function getLastInterfaceCallers(): unknown[] {
  return fhState().lastInterfaceCallers
}

export function getCurrentInterfaceCallers(): unknown[] {
  return fhState().interfaceCallerStack.at(-1) ?? fhState().lastInterfaceCallers
}

export function heldPress(
  plugin: string,
  handle: unknown,
  element?: string,
): HeldPressRecord | undefined {
  return fhState().heldPressStore.heldPress(plugin, handle, element)
}

export function hostedButtonsOf(
  plugin: string,
  element: string,
): Array<{ hosted: number; button: HeldPressRecord }> {
  return fhState().heldPressStore.hostedButtonsOf(plugin, element)
}

export function heldPressCount(): number {
  return fhState().heldPressStore.heldPressCount()
}

export function heldByKeyOf(key: {
  tag: string
  plugin: string
  element: string
  surface: string
  component: string
  requestId?: string
}): HeldPressRecord | undefined {
  return fhState().heldPressStore.heldByKeyOf(key)
}

export function pressSlot(environmentId: string, handle: unknown): string {
  return `${environmentId}\0${JSON.stringify(handle)}`
}

export function recordPress(
  environmentId: string,
  handle: unknown,
  event: unknown,
): void {
  fhState().recordedPresses.push({ environmentId, handle, event })
}

export function getRecordedPresses(): readonly {
  environmentId: string
  handle: unknown
  event: unknown
}[] {
  return fhState().recordedPresses
}

export function setUiNotifyHandler(
  handler: SessionFunctionHooksModulesState['uiNotifyHandler'],
): void {
  fhState().uiNotifyHandler = handler
}

export function setUiCancelNotifyHandler(
  handler: SessionFunctionHooksModulesState['uiCancelNotifyHandler'],
): void {
  fhState().uiCancelNotifyHandler = handler
}

export function setUiAskHandler(
  handler:
    | ((question: string, options: string[]) => Promise<string>)
    | undefined,
): void {
  fhState().uiAskHandler = handler
}

/** densable host `ui.ask` — AskUserQuestion tool input, not the $ wrapper. */
export function setUiAskHostHandler(
  handler: ((input: UiAskHostInput) => Promise<UiAskHostResult>) | undefined,
): void {
  fhState().uiAskHostHandler = handler
}

/** densable `budgets.toasts.show(plugin, n)` — Notifications host. */
export function setUiToastShowHandler(
  handler:
    | ((input: { plugin: string; text: string; timeoutMs?: number }) => void)
    | undefined,
): void {
  fhState().uiToastShowHandler = handler
  fhState().pluginToastLastAt.clear()
}

/** densable `oRt` — optional status host override (default uses AppState pinned notifications). */
export function setUiStatusHandler(
  handler:
    | ((input: { plugin: string; text: string | undefined }) => void)
    | undefined,
): void {
  fhState().uiStatusHandler = handler
}

export function setFunctionHooksAppStateReader(
  reader: (() => AppState | undefined) | undefined,
): void {
  fhState().functionHooksAppStateReader = reader
}

export function setFunctionHooksAppStateWriter(
  writer: ((updater: (prev: AppState) => AppState) => void) | undefined,
): void {
  fhState().functionHooksAppStateWriter = writer
}

/** densable host `agent.spawn` — Agent tool input, not the $ wrapper. */
export function setAgentSpawnHandler(
  handler: ((input: Record<string, unknown>) => Promise<unknown>) | undefined,
): void {
  fhState().agentSpawnHandler = handler
}

/** densable host `tool.call` — event bag `{ tool, ...args }`. */
export function setToolCallHandler(
  handler: ((input: Record<string, unknown>) => Promise<unknown>) | undefined,
): void {
  fhState().toolCallHandler = handler
}

/**
 * densable XL `$3`/`runToolUse` binding — optional REPL/headless context.
 * Tests keep using `setToolCallHandler`; this enables the full stream path.
 */
export function setFunctionHooksToolUseContext(
  host: FunctionHooksToolUseContext | undefined,
): void {
  fhState().functionHooksToolUseContext = host
}

/** densable host `tool.check` — `{ tool, input }`. */
export function setToolCheckHandler(
  handler: ((input: Record<string, unknown>) => Promise<unknown>) | undefined,
): void {
  fhState().toolCheckHandler = handler
}

/** densable host `turn.abort` — cancel the running turn, if any. */
export function setTurnAbortHandler(
  handler: ((input: { turnId: string }) => Promise<unknown>) | undefined,
): void {
  fhState().turnAbortHandler = handler
}

export function setPromptSubmitHandler(
  handler: ((input: { text: string }) => Promise<unknown>) | undefined,
): void {
  fhState().promptSubmitHandler = handler
}

/** densable `zFn` host — REPL/headless bound compact. */
export function setSessionCompactHandler(
  handler: ((input: { instructions: string }) => Promise<unknown>) | undefined,
): void {
  fhState().sessionCompactHandler = handler
}

/** densable `C0e` — running turn, if any. */
export function setFunctionHooksTurnReader(
  reader: (() => { turnId: string } | undefined) | undefined,
): void {
  fhState().turnRunningReader = reader
}

export function getPluginHostCalls(): readonly {
  namespace: string
  method: string
  args: unknown[]
}[] {
  return fhState().pluginHostCalls
}

export async function waitForWorkerReplacement(
  event: string,
  signal?: AbortSignal,
): Promise<void> {
  const pending = fhState().workerReplacementPromise
  if (pending === undefined) return
  logForDebugging(
    `hooks module: ${event} waits for the hooks worker's replacement`,
  )
  await new Promise<void>(resolve => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const onAbort = () => resolve()
    signal?.addEventListener('abort', onAbort, { once: true })
    void pending.then(
      () => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      },
      () => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      },
    )
  })
}

function isSessionStartDedupAbortedOrDenied(
  entry: SessionStartDedupEntry,
  res: unknown,
): boolean {
  if (entry.endsWith?.aborted !== true) return false
  if (!isEventRecord(res)) return true
  return Object.hasOwn(res, 'deny') || res.isError === true
}

export function recordSessionStartLoad({
  name,
  args,
  shown,
  environmentId,
}: {
  name: string
  args: unknown
  shown?: unknown
  environmentId: string
}): boolean {
  const { isDeepStrictEqual } = require('util') as typeof import('util')
  const load = { args, shown }
  const existing = fhState().sessionStartDedupStore.get(name)
  const same = existing !== undefined && isDeepStrictEqual(existing.load, load)
  if (!same) {
    fhState().sessionStartDedupStore.set(name, {
      load,
      calls: {
        'prompt.submit': [],
        'command.run': [],
        'agent.spawn': [],
      },
      copies: new Set([environmentId]),
    })
  } else {
    existing.copies.add(environmentId)
  }
  return same
}

export function withSessionStartDedup(
  op: SessionStartDedupOp,
  args: unknown,
  plugin: string,
  environmentId: string | undefined,
  run: () => Promise<unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const rec =
    getLiveHookEvent() === 'session.start'
      ? fhState().sessionStartDedupStore.get(plugin)
      : undefined
  const envId = environmentId ?? plugin
  if (rec === undefined || !rec.copies.has(envId)) {
    return run()
  }
  const { isDeepStrictEqual } = require('util') as typeof import('util')
  const existing = rec.calls[op].find(c => isDeepStrictEqual(c.args, args))
  const remove = (entry: SessionStartDedupEntry) => {
    rec.calls = {
      ...rec.calls,
      [op]: rec.calls[op].filter(c => c !== entry),
    }
  }
  if (existing === undefined) {
    const entry: SessionStartDedupEntry = {
      args,
      result: run(),
      starts: new Set([envId]),
      isRepeated: false,
      endsWith: op === 'prompt.submit' ? signal : undefined,
    }
    rec.calls = {
      ...rec.calls,
      [op]: rec.calls[op].concat(entry),
    }
    void entry.result.then(
      res => {
        if (isSessionStartDedupAbortedOrDenied(entry, res)) remove(entry)
      },
      () => remove(entry),
    )
    return entry.result
  }
  const alreadyStarted = existing.starts.has(envId)
  const canReuse = !existing.isRepeated && !alreadyStarted
  existing.isRepeated = existing.isRepeated || alreadyStarted
  if (!canReuse) {
    return run()
  }
  existing.starts.add(envId)
  return existing.result.then(res => {
    const rerun = isSessionStartDedupAbortedOrDenied(existing, res)
    if (!rerun) {
      logForDebugging(
        `${plugin}: its session.start ran again in a fresh copy; the $.${op} call it had already made was not made again`,
      )
    }
    return rerun ? run() : res
  })
}

/** densable `Qm`. */
/** densable `HD()` / `dt().renderVersions`. */

export function pluginSessionState(): SessionFunctionHooksModulesState['pluginSession'] {
  return fhState().pluginSession
}

/** densable `bh` / `E1t(plugin, pace)` — HD plugin live/steady keys. Lue still reads them. */
function bumpHdPlugin(name: string, pace: 'live' | 'steady'): void {
  const key = pace === 'live' ? `${name}${FAULT_RENDER_LIVE}` : name
  fhState().faultRenderVersions.set(
    key,
    (fhState().faultRenderVersions.get(key) ?? 0) + 1,
  )
}

/**
 * densable `bS` — pace-gated `E1t`. Immediate bump, else unref timer.
 * `call` true iff bumped now; false if pending/scheduled.
 */
function scheduleHdPluginBump(
  pace: 'live' | 'steady',
  opts?: {
    now?: () => number
    intervalMs?: number
    onBump?: (plugin: string, at: number) => void
  },
): HdPluginBump {
  const lastAt = new Map<string, number>()
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  const nowFn = opts?.now ?? Date.now
  const intervalMs =
    opts?.intervalMs ??
    (pace === 'live' ? FAULT_RENDER_LIVE_MS : FAULT_RENDER_STEADY_MS)

  function bump(plugin: string, at = nowFn(), silent = false): void {
    const timer = pending.get(plugin)
    if (timer !== undefined) clearTimeout(timer)
    pending.delete(plugin)
    lastAt.set(plugin, at)
    bumpHdPlugin(plugin, pace)
    opts?.onBump?.(plugin, at)
    if (!silent) {
      invalidateRender('ui.render')
      bumpRasterFrames()
    }
  }

  function call(plugin: string): boolean {
    if (pending.has(plugin)) return false
    const t = nowFn()
    const prev = lastAt.get(plugin) ?? Number.NEGATIVE_INFINITY
    const delay = intervalMs - Math.max(0, t - prev)
    if (delay <= 0) {
      bump(plugin, t)
      return true
    }
    const captured = getActiveSessionFromAls()
    const timer = setTimeout(() => {
      if (captured !== undefined && getActiveSessionFromAls() !== captured) {
        runWithSession(captured, () => bump(plugin, nowFn()))
        return
      }
      bump(plugin, nowFn())
    }, delay)
    timer.unref?.()
    pending.set(plugin, timer)
    return false
  }

  function reset(): void {
    for (const timer of pending.values()) clearTimeout(timer)
    pending.clear()
    lastAt.clear()
  }

  return { bump, call, reset }
}

/**
 * densable `Xm` — band not collapsed. Default true (`v1t.get()!==!0`).
 */

export function setPluginBandExpanded(next: boolean): void {
  fhState().pluginBandExpanded = next
}

/** densable `Q_().faultRuns.size`. */
export function getPluginFaultRunsSize(): number {
  return pluginSessionState().faultRuns.size
}

/** densable HD `\0state` occupancy after `Qc` / `kS`. */
export function getPluginFaultRenderStateSize(): number {
  let count = 0
  for (const key of fhState().faultRenderVersions.keys()) {
    if (key.endsWith(FAULT_RENDER_STATE_SUFFIX)) count += 1
  }
  return count
}

/** densable `Wbr().dispatched()`. */
export function getClientMessagesDispatched(): number {
  return fhState().clientMessagesDispatched
}

/**
 * Official 2.1.323 #2053 (`vnt` / `SGa`): write headless `--plugin-dir` (`@inline`)
 * hooks worker crash / hang / unload warnings to stderr in text-output `-p` runs.
 * Lines arriving before output format is settled are buffered and flushed when
 * `setHeadlessPluginOutputFormat('text')` or `flushHeadlessInlineModStderr()` runs.
 */

function isHeadlessTextStderrActive(): boolean {
  return (
    fhState().headlessPluginOutputFormat === 'text' &&
    process.env.CLAUDE_CODE_SESSION_KIND !== 'bg'
  )
}

export function setHeadlessPluginOutputFormat(format: string | null): void {
  fhState().headlessPluginOutputFormat = format
  if (format === 'text') {
    flushHeadlessInlineModStderr()
  } else if (format !== null) {
    fhState().pendingHeadlessModStderrLines.length = 0
  }
}

export function flushHeadlessInlineModStderr(
  write: (text: string) => void = text => {
    try {
      process.stderr.write(text)
    } catch {
      /* ignore broken pipe */
    }
  },
): string[] {
  const queued = fhState().pendingHeadlessModStderrLines.splice(0)
  if (!isHeadlessTextStderrActive()) return []
  for (const line of queued) {
    write(`${line}\n`)
  }
  return queued
}

export function reportHeadlessInlineModStderr(
  plugin: { name: string; source?: string },
  message: string,
  opts?: {
    isNonInteractive?: boolean
    write?: (text: string) => void
  },
): boolean {
  const nonInteractive = opts?.isNonInteractive ?? getIsNonInteractiveSession()
  if (!nonInteractive) return false
  if (!plugin.source || !plugin.source.endsWith('@inline')) return false
  const clean = `${plugin.name}: ${message}`
    .replace(/[\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, ch =>
      ch === '\n' ? '\n' : '',
    )
    .replaceAll('\n', '\n  ')
  if (fhState().emittedHeadlessModStderrLines.has(clean)) return false
  fhState().emittedHeadlessModStderrLines.add(clean)
  if (fhState().headlessPluginOutputFormat === null) {
    fhState().pendingHeadlessModStderrLines.push(clean)
    return true
  }
  if (isHeadlessTextStderrActive()) {
    const write =
      opts?.write ??
      ((text: string) => {
        try {
          process.stderr.write(text)
        } catch {
          /* ignore broken pipe */
        }
      })
    write(`${clean}\n`)
    return true
  }
  return false
}

export function resetHeadlessInlineModStderrState(): void {
  fhState().headlessPluginOutputFormat = null
  fhState().pendingHeadlessModStderrLines.length = 0
  fhState().emittedHeadlessModStderrLines.clear()
}

export function resolvePluginStorageId(pluginName: string): string {
  const mod = fhState().loadedModules.find(m => m.name === pluginName)
  return mod?.pluginStorageId ?? pluginName
}
