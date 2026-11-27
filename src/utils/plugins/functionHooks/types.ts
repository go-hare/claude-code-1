/**
 * Function hooks submodule: types
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import type {
  ClientMessageEnqueue,
  SurfaceModuleScan,
} from '../functionHooksClient.js'
import type {
  FunctionHookNext,
  HookTier,
  HopFloor,
} from '../functionHooksHop.js'

export type HookCallOrigin = {
  readonly plugin: string
  readonly tier: string
}

export type HookOriginEntry =
  | string
  | {
      readonly plugin: string
      readonly registration: number
    }

export type HookTraceEntry = {
  readonly index: number
  readonly plugin: string
  readonly tier: HookTier
  readonly event: string
  readonly outcome:
    | 'returned'
    | 'passed'
    | 'skipped'
    | 'kept'
    | 'expired'
    | 'caught'
    | 'rejected'
  readonly reason?: string
  readonly ms: number
  readonly received: unknown
  readonly returned: unknown
}

export type HookTraceNode = {
  entry?: HookTraceEntry
  beneath?: HookTraceNode
}

export type FunctionHookBudget = {
  readonly ms: number
  readonly remainingMs: number
}

export type FunctionHookHandler = (
  api: Record<string, unknown>,
  event: Record<string, unknown>,
  next: ((value?: unknown) => Promise<unknown>) & {
    to?: FunctionHookNext['to']
    is?: (pattern: string) => boolean
    origin?: HookCallOrigin
    event?: string
    signal?: AbortSignal
    trace?: readonly HookTraceEntry[]
    budget?: FunctionHookBudget
    error?: {
      readonly kind: 'throw' | 'timeout'
      readonly message?: string
      readonly budget: number
    }
    called?: boolean
  },
) => unknown

export type FunctionHookHostHandler = {
  name: string
  isManaged?: boolean
  isCore?: boolean
  run: (input: Record<string, unknown>, next: FunctionHookNext) => unknown
}

export type LoadedFunctionHook = {
  pattern: string
  matcher?: unknown
  hook: FunctionHookHandler
  catch?: FunctionHookHandler
  /** densable `$e` / `se` on the hook itself. */
  isManaged?: boolean
  isCore?: boolean
}

export type LoadedFunctionHooksModule = {
  name: string
  root?: string
  patterns: readonly string[]
  hooks?: readonly LoadedFunctionHook[]
  /** densable: live until retire() waits out in-flight calls. */
  status?: 'live' | 'retiring' | 'unloaded'
  /** densable `args.surfaceModules` — Client `./board` paths from the hooks file. */
  surfaceModules?: readonly SurfaceModuleScan[]
  /** densable _k — LoadedPlugin.source / name@builtin */
  pluginStorageId?: string
  /**
   * densable `Gue` — marketplace/user hop handle. Set when the module
   * is a user-installed copy (`link !== undefined`).
   */
  link?: unknown
  /** densable module `tier` (`$e` / `ZEn`). */
  tier?: 'user' | 'prepend' | 'append' | 'builtin' | 'core'
  /** densable `$e` / `se` — seated managed hooks are prepend and sit above floors. */
  isManaged?: boolean
  /** densable `$e` / `se`. */
  isCore?: boolean
  /** densable `rD` / `elo` — built-in module loaded natively in-process. */
  native?: boolean
  /** densable per-load environment ID (`#510`). */
  environmentId?: string
}

export type HookServingContext = {
  cwd?: string
  turnHeld?: string
  listedMedia?: readonly string[]
  isDispatching?: () => boolean
  budgetTracker?: StepBudgetTracker
  isPersonInitiated?: boolean
}

/**
 * densable `za` / `cV` — ui.render drawing ALS. `$.state.get` fills
 * `versionsRead`; `jC` after the chain if requestId !== ''.
 */
export type UiRenderDrawing = {
  instanceKey: string
  instance: ClientFaultSite
  versionsRead: Map<string, number>
  isEnded: boolean
}

export type PromptEditBox = { text: string; cursor: number }

export type PromptEditRecord = {
  before: PromptEditBox
  after: PromptEditBox
}

export type PromptChangeOrigin =
  | { kind: 'history' }
  | { kind: 'clear' }
  | { kind: 'undo' }
  | { kind: 'engine' }
  | { kind: 'composer' }
  | { kind: 'landing' }
  | { kind: 'plugin'; name: string }

export type FunctionHookTail = (
  event: Record<string, unknown>,
  floors?: readonly HopFloor[],
) => Promise<unknown>

export type StepBudgetTracker = {
  pause: () => void
  resume: () => void
  budget: () => FunctionHookBudget
}

/**
 * densable `pc().hookFailed` payload. Worker `oGt` posts `{type:'hook_failed',...}`.
 */
export type FunctionHookFailedReport = {
  plugin: string
  environmentId?: string
  event?: string
  reason?: string
  effect?: string
  hasOverrun?: boolean
  skip?: { kind?: string; why?: string }
}

export type FunctionHooksHost = {
  log: (text: string, level?: string) => void
  hookFailed: (report: FunctionHookFailedReport) => void
}

export type PassedByRecord = {
  plugin: string
  event: string
  by: string
  count: number
}

export type FunctionHookHopSite = {
  checkArgument?: (
    passed: Record<string, unknown>,
    original: Record<string, unknown>,
  ) => string | undefined
  restoreArgument?: (
    passed: Record<string, unknown>,
    original: Record<string, unknown>,
  ) => Record<string, unknown>
  unappliedArgument?: (
    passed: Record<string, unknown>,
    original: Record<string, unknown>,
  ) => string | undefined
  restoreResult?: (
    returned: Record<string, unknown>,
    priorResults: readonly Record<string, unknown>[],
    original: Record<string, unknown>,
  ) => Record<string, unknown>
  /** Official 2.1.323 #2026: per-hop result attribution / stripping (e.g. `stripToolCheckHookResult`). */
  stripResult?: (
    returned: Record<string, unknown>,
    priorResults: readonly Record<string, unknown>[],
    handler: { name: string; isHop?: boolean; plugins?: readonly string[] },
  ) => Record<string, unknown>
  check?: (returned: unknown) => string | undefined
}

export type StateRef = { plugin: string; key: string; id?: string }

/** densable MD site `{surface, component, requestId}`. */
export type ClientFaultSite = {
  surface: string
  component: string
  requestId: string
}

export type ClientFaultRun = {
  site: ClientFaultSite
  versions: Set<string>
  bornAt: string
}

/** densable `jC` reader row: `{instance, plugins, reads}`. */
export type DrawingReaderRecord = {
  instance: ClientFaultSite
  plugins: string[]
  reads: Set<string>
}

export type ClientFaultFoldPace = 'live' | 'steady'

/** densable nqr `folds.{live,steady}`: stale instanceKeys + last flush + timer. */
export type ClientFaultFold = {
  stale: Set<string>
  lastAt: number
  pending: ReturnType<typeof setTimeout> | undefined
}

export type PluginAgentRecord = {
  plugin: string
  spec: Record<string, unknown>
}

/** densable K3n — in-flight $.agent.spawn launches per plugin. */
/** densable spawnProvenance.hookCaller — agentId → plugin that spawned it. */

/** densable `I_` — plugin → name → spec for `$.command.register`. */
export type PluginCommandSpec = {
  name: string
  description: string
  argumentHint?: unknown
  immediate?: unknown
}

export type SessionAuthHandleEntry = {
  plugin: string
  headers: Record<string, string>
  host: string
}

export type ConfigOverlayValue = boolean | string | number | string[]

/**
 * densable #696 (`NNa`/`FNa`/`$Na`/`EWe`/`UNa`/`k7e` @278647963) — track
 * `$.env.set` keys written by non-managed/personal plugins so managed command
 * hooks (`hooks.ts`) can isolate them cleanly.
 */
export type PersonalPluginEnvWrite = {
  name: string
  before: string | undefined
  theirs: string | undefined
  writer?: string
}

/**
 * densable #614 (`Ue` @278027752, `G6a`/`z6a` @287713470, `Opo` @293473956) —
 * `askedOf` / `askedAbout` / `visited` / `unsettled` tracking for `settings.read`
 * engine merge so oscillating plugin reloads settle cleanly.
 */
export type HookedMergeEntry = {
  key: string
  value: unknown
  source?: SettingsReadSource
}

export type HookedMergeError = {
  path: string
  severity: 'warning'
  statusOnly: true
  message: string
}

export type HookedMergeAnswers = {
  values: Map<string, unknown>
  errors: HookedMergeError[]
  source?: SettingsReadSource
}

export type HookedMergeState = {
  answers: HookedMergeAnswers | null
  computed: Record<string, unknown> | null
  pass: Promise<void>
  queuedFor: string | undefined
  isAnnouncing: boolean
  askedOf: string
  askedAbout: Record<string, unknown> | null
  visited: string[]
  unsettled: Set<string>
}

export type AbortLike = {
  aborted?: boolean
  reason?: unknown
  addEventListener?: (
    type: string,
    listener: () => void,
    options?: { once?: boolean },
  ) => void
  removeEventListener?: (type: string, listener: () => void) => void
}

export type WaitTimeoutOpts = {
  throwOnAbort?: boolean
  abortError?: () => Error
  unref?: boolean
}

export type UiAskHostInput = {
  tool?: string
  questions: Array<{
    question: string
    header?: string
    options: Array<{ label: string; description?: string }>
    multiSelect?: boolean
  }>
}

export type UiAskHostResult = {
  result?: { answers?: Record<string, string> }
  deny?: string
  text?: string
}

export type HostOpPort = {
  postMessage: (value: unknown) => void
  on?: (event: 'message', listener: (value: unknown) => void) => void
}

export type ProcessRunCapture = { text: string; isTruncated: boolean }

export type SpawnQueueItem =
  | { stream: 'stdout' | 'stderr'; text: string }
  | { failed: Error }
  | { ended: { code: number | null; signal: NodeJS.Signals | null } }

export type PromptMediaAttachmentInput = {
  attachment: { type: 'image' | 'document'; [key: string]: unknown }
  read: () => Promise<
    | { type: 'image' | 'document'; mediaType: string; bytes: Buffer }
    | { deny: string }
    | { unreadable: string }
  >
}

export type UiViewShowResult =
  | 'shown'
  | 'unknown'
  | 'hidden'
  | 'ended'
  | 'moved'
  | 'elsewhere'

export type ModelPromptBlock = { text: string; cache?: boolean }

export type McpListedTool = {
  name: string
  mcpInfo?: { serverName: string; toolName: string }
}

export type HostToolCallXLResult =
  | { deny: string }
  | { result?: unknown; text: string; isError?: true }

export type FunctionHooksToolUseContext = {
  getToolUseContext: () =>
    | {
        options?: { tools?: unknown }
        abortController?: AbortController
        [key: string]: unknown
      }
    | null
    | undefined
  /** REPL binds CanUseToolFn; tests may pass a stub. */
  canUseTool: (...args: never[]) => Promise<unknown>
  getParentAssistantMessage?: () => unknown
}

export type PluginModCanUseToolDecision = {
  behavior: 'allow' | 'deny' | 'ask' | 'passthrough'
  updatedInput?: Record<string, unknown>
  decisionReason?: { type?: string; mode?: string; [key: string]: unknown }
  [key: string]: unknown
}

export type PromptAutocompleteSuggestion = {
  text: string
  label?: string
  description?: string
}

export type SessionListedTool = {
  name: string
  description?: string
  mcpInfo?: unknown
  isMcp?: boolean
}

export type GoldSessionToolUse = {
  id: string
  tool_use_id: string
  tool: string
  input: Record<string, unknown>
  result?: unknown
  text?: string
  isError?: true
  agentId?: string
  durationMs?: number
}

export type GoldSessionToolResult = {
  tool_use_id: string
  text: string
  isError: boolean
  result?: unknown
}

export type GoldSessionMessage = {
  role: 'user' | 'assistant'
  text: string
  toolUses: GoldSessionToolUse[]
  toolResults?: GoldSessionToolResult[]
}

/**
 * densable Chat panes shape (`Si`/`JSn` / `EMPTY_PANES`) — semantic store over
 * the local plugin pane dock. Fields mirror gold: open / unplaced / asked /
 * shownId / focusedId / focusRequest / placements / closing. Backed by
 * `pluginPanes` + dock ids for open/shown/focused/closing. Column/remote
 * placeWaiting + asked latch HAVE; soft persist via `GlobalConfig.pluginPanes.asked`
 * (`mL`/`keepAsked`/`keptAsked`). ui.open uses `placementAtOpen` → unplaced when
 * below openFloor. Minify names stay in comments only.
 */
export type PluginPaneEntry = {
  id: string
  plugin: string
  title: string
  closeOnEscape?: boolean
  holdToasts?: boolean
  rows?: number
  columns?: number
}

export type AskedPaneRef = { plugin: string; id: string }

export type PanesState = {
  open: PluginPaneEntry[]
  unplaced: PluginPaneEntry[]
  asked: AskedPaneRef[]
  shownId: string | null
  focusedId: string | null
  focusRequest: string | null
  placements: number
  closing: string[]
}

/** densable `d3` — columns / rows / conversationColumns for placeWaiting + Client `L()`. */
export type PanesTerminalSize = {
  columns: number
  rows: number
  conversationColumns: number
}

export type PanesListener = () => void

/**
 * densable Ex/gH / Ide HAVE — local `pluginSites` registry for
 * offset/maxOffset/bodyRows/contentRows/keys (gold `Ide=et(dt().scrollSites)`).
 * Hde/`QLt` person-origin `ui.scroll` HAVE as semantic
 * `logUiScrollSettled` + `commitPluginScrollSite` + `dispatchPersonUiScroll`
 * (no minify Ide/Hde/QLt/iZ export). Hook-chain HAVE via
 * `dispatchPersonUiScroll` → `runFunctionHookChain('ui.scroll')` when no
 * handlers are registered.
 */
export type PluginSite = {
  plugin: string
  /** densable Ide site `owner` — same as plugin. */
  owner: string
  requestId: string
  component: 'Pane' | 'AbovePrompt'
  keys: Set<string>
  offset: number
  maxOffset: number
  bodyRows: number
  contentRows: number
  /**
   * densable Ide site `followEnd` latch — after wat scroll-to-end success,
   * keep offset pinned to maxOffset on dim updates.
   */
  followEnd: boolean
  /**
   * densable Ide `keyRows` host — Ink content root for cEe yoga walk.
   * Absent → membership-only `{top:0,bottom:0}` until the site binds a tree.
   */
  contentRoot?: ScrollSiteLayoutNode
}

/**
 * densable yoga DOM subset used by `cEe` / `ZV` (no minify names).
 * Matches Ink `DOMElement` shape: attributes + childNodes + yogaNode + parent.
 */
export type ScrollSiteLayoutNode = {
  attributes?: Record<string, unknown>
  childNodes?: readonly unknown[]
  nodeName?: string
  parentNode?: ScrollSiteLayoutNode | undefined
  yogaNode?: {
    getComputedTop(): number
    getComputedHeight(): number
  }
}

/**
 * densable `g9e` / `dt().focusSites` — separate from scrollSites (`pluginSites`).
 * Keyed `component:requestId`. XHo HAVE via `bindPluginFocusHost` /
 * `usePluginFocusHost` (Pane + AbovePrompt). Fallback hold maps shown/focused pane.
 */
export type PluginFocusCommitInput = {
  plugin: string
  element?: string
  origin: { kind: string; name?: string }
}

export type PluginFocusHostBind = {
  component: PluginSite['component']
  requestId: string
  owner?: string
  isHeldNow: () => boolean
  holderNow: () => string | undefined
  hasElement: (plugin: string, element: string) => boolean
  commit: (input: PluginFocusCommitInput) => string | undefined
}

export type PluginFocusSite = {
  plugin: string
  owner: string
  requestId: string
  component: PluginSite['component']
  keys: Set<string>
  /** densable holderNow — last plugin that committed focus, else owner. */
  holder?: string
  /** densable XHo live handle — Pane/AbovePrompt keyboard host. */
  host?: PluginFocusHostBind
}

export type PluginFocusSiteSnapshot = {
  plugin: string
  owner: string
  requestId: string
  component: PluginSite['component']
  keyCount: number
  holder?: string
  isHeldNow: boolean
}

/** Public scroll-site dims (gold Ide().set body; commit/Sat/followEnd HAVE). */
export type PluginScrollSiteDims = {
  offset?: number
  maxOffset?: number
  bodyRows?: number
  contentRows?: number
  followEnd?: boolean
}

export type PluginScrollSiteSnapshot = {
  plugin: string
  owner: string
  requestId: string
  component: 'Pane' | 'AbovePrompt'
  offset: number
  maxOffset: number
  bodyRows: number
  contentRows: number
  keyCount: number
  followEnd: boolean
}

/** densable drawing trees from ui.resolve — rendered as Ink `wo`/`xo` children. */
export type PluginDrawingTree = {
  plugin: string
  requestId?: string
  component?: string
  tree: unknown
}

export type UiRenderEvalRecord = {
  propsKey: string
  version: string
  settled: unknown
  /** densable `oBo` `versions: HD()` — Map identity, not a copy. */
  versions: Map<string, number>
  /** densable `oBo` `engineVersion: HD().get(Fv) ?? 0`. */
  engineVersion: number
}

export type MountedRaster = {
  plugin: string
  requestId: string
  key: string
  columns: number
  rows: number
  lastWords?: Uint32Array
  /** densable `Joo` at `paint` (blit), not at getMountedRasterFrames. */
  lastAnsi?: string
  paint: (words: Uint32Array) => void
}

export type MountedImage = {
  plugin: string
  requestId: string
  key: string
  columns: number
  rows: number
  lastSource?: unknown
  swap: (source: unknown) => string | undefined
}

export type RasterSite = {
  rasters: Set<MountedRaster>
  windowStart: number
  blits: number
}

export type ImageSite = {
  images: Set<MountedImage>
  windowStart: number
  blits: number
}

type RasterPaletteStanding = 'progressing' | 'waiting' | 'complete'

export type RasterPalette = {
  beginPaint: (distinctSet: Set<number>) => void
  sgrOf: (key: number) => string
  size: () => number
  standing: () => RasterPaletteStanding
}

export type RasterPaletteEntry = {
  key: number
  sgr: string
  lastPaint: number
}

export type RasterPaletteAlias = {
  entry: RasterPaletteEntry
  after: number
}

/** densable `kmt` factory state. */
export type RasterPaletteState = {
  slots: RasterPaletteEntry[]
  held: Map<number, RasterPaletteEntry>
  table: Uint8Array
  probe: Uint8Array
  aliases: Map<number, RasterPaletteAlias>
  admissions: number
  paint: number
  frame: Set<number>
  evaluated: number
  lastSgr: string
  isStarved: boolean
  hasCarried: boolean
  netMatched: number
  hasStale: boolean
}

export type RasterAdmission = {
  tokens: number
  refilledAt: number
}

export type PluginFieldSeatBucket = Map<string, Map<string, string>>

/** densable scroll origin — person vs plugin (vq/Sat). */
export type PluginScrollOrigin =
  | { kind: 'person' }
  | { kind: 'plugin'; name: string }

export type PersonUiScrollInput = {
  component: PluginSite['component']
  requestId: string
  offset: number
  by: number
  bodyRows: number
  contentRows: number
  plugin?: string
  pointer?: unknown
}

export type RemoteUiScrollInput = {
  clientId: string
  component: PluginSite['component']
  requestId: string
  offset: number
  by: number
  bodyRows: number
  contentRows: number
  pointer?: unknown
  keyed?: unknown
}

export type RemoteUiFocusInput = {
  clientId: string
  component: PluginSite['component']
  requestId: string
  isHeld: boolean
  element?: { plugin: string; key: string } | null
  by: 'person' | 'auto'
}

export type RemoteClientPressInput = {
  plugin: string
  component: string
  requestId: string
  key: string
  module: string
  element: string
  event:
    | { type: 'press' }
    | { type: 'input'; kind: 'change' | 'submit'; value: string }
    | { type: 'select'; value: string }
}

export type RemoteClientMessageInput = {
  plugin: string
  component: string
  requestId: string
  key: string
  module: string
  data: unknown
}

export type HoverScopeKind = 'none' | 'hidden' | 'live'

export type PluginFocusDispatchInput = {
  component: PluginSite['component']
  requestId: string
  plugin?: string
  element?: string
  origin: { kind: string; name?: string }
}

export type PluginFocusHookCtx = {
  plugin: string
  origin?: unknown
  signal?: AbortSignal
  rootEvent?: string
}

export type PressEventKind = 'ui.input' | 'ui.select' | 'ui.press'

export type PressAnswering = {
  event: PressEventKind
  isLive: boolean
  answersUntil: number
}

/** densable worker `x` — handle → press callback. */

export type HeldPressSite = {
  component: string
  requestId: string
  surface: string
}

export type HeldPressRecord = {
  tag: string
  plugin: string
  handle: unknown
  element: string
  pressableLinks?: string[]
  options?: string[]
} & HeldPressSite

export type UiNotifyChannelResult =
  | 'no_surface'
  | 'iterm2'
  | 'iterm2_with_bell'
  | 'kitty'
  | 'ghostty'
  | 'terminal_bell'
  | 'client'
  | 'disabled'
  | 'none'
  | 'no_method_available'
  | 'error'

export type StateAtomRef = { plugin: string; key: string; id?: string }

export type FrozenAtom = {
  ref: StateAtomRef
  initial: unknown
  shape?: unknown
}

export type DerivedMemo = { value?: unknown; versions?: string }

export type FrozenDerived = {
  sources: unknown[]
  compute: (...values: unknown[]) => unknown
  memo: DerivedMemo
}

export type WorkerReply = {
  type?: string
  id?: number
  environmentId?: string
  registered?: unknown[]
  returned?: unknown
  error?: string
  argument?: unknown
  floors?: readonly HopFloor[]
  open?: { argument?: unknown }
  step?: { done: boolean; value: unknown }
  nextId?: number
  callId?: number
  pressId?: number
  resolveId?: number
  value?: unknown
  plugin?: string
  event?: string
  reason?: string
  effect?: string
  hasOverrun?: boolean
  skip?: { kind?: string; why?: string }
  text?: string
  level?: string
}

export type PendingJob = {
  resolve: (reply: WorkerReply) => void
  reject: (err: Error) => void
  abort: AbortController
  tail?: FunctionHookTail
  streamPull?: {
    resolve: (step: { done: boolean; value: unknown }) => void
    reject: (err: Error) => void
  }
  openNextStream?: (
    arg: Record<string, unknown>,
  ) => AsyncGenerator<unknown, unknown, unknown>
  openedNextStreams?: Map<number, AsyncGenerator<unknown, unknown, unknown>>
  isStream?: boolean
  environments: string[]
  failed: Set<string>
}

export type SessionStartDedupOp =
  | 'prompt.submit'
  | 'command.run'
  | 'agent.spawn'

export type SessionStartDedupEntry = {
  args: unknown
  result: Promise<unknown>
  starts: Set<string>
  isRepeated: boolean
  endsWith?: AbortSignal
}

export type SessionStartDedupRecord = {
  load: { args: unknown; shown: unknown }
  calls: Record<SessionStartDedupOp, SessionStartDedupEntry[]>
  copies: Set<string>
}

export type HdPluginBump = {
  bump: (plugin: string, at?: number, silent?: boolean) => void
  call: (plugin: string) => boolean
  reset: () => void
}

/**
 * densable `Wbr`/`Je` — coalesce by instance id; drain then `N1t`.
 * `cancel(e.id)` drops a pending post and clears the timer when empty.
 */
export type ClientMessageQueued = {
  post: ClientMessageEnqueue
  reply: (value: unknown) => void
}

export type FunctionHookPlugin = {
  name: string
  path: string
  options?: Record<string, unknown>
  /** densable _k — LoadedPlugin.source / name@builtin */
  source?: string
  /** densable `Gue` hop handle — user-installed copy. */
  link?: unknown
  /** densable module `tier`. */
  tier?: LoadedFunctionHooksModule['tier']
}

export type LeftoverHooksModule =
  | {
      module: { register: (...args: unknown[]) => unknown }
      scan: unknown
      files: Readonly<Record<string, string>>
    }
  | {
      module: { register: (...args: unknown[]) => unknown }
      folder: string
    }

export type WorkerModule = {
  name: string
  root?: string
  patterns: string[]
  hooks: Array<{ pattern: string; matcher?: unknown }>
}

export type ScanCall = {
  type?: string
  callee?: { type?: string; name?: string }
  arguments?: Array<{
    type?: string
    value?: unknown
    raw?: string
    expressions?: unknown[]
    quasis?: Array<{ value?: { cooked?: string | null } }>
  }>
}

export type SessionThemeState = {
  plugin: string
  backdrop?: Record<string, unknown>
  image?: { id: string; hash: string; data: Buffer }
  overrideColorScheme?: 'light' | 'dark'
  colors?: Record<string, unknown>
}

export type SettingsReadSource =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'flagSettings'
  | 'policySettings'

export interface FunctionHooksWorkerClientLike {
  died: string | undefined
  culpritPlugin?: string
  load(plugin: FunctionHookPlugin): Promise<WorkerReply>
  unload(name: string): void
  dispatch(
    event: string,
    payload: Record<string, unknown>,
    environments: string[],
    tail: FunctionHookTail,
    only?: string,
    callOptions?: {
      origin?: HookCallOrigin
      hookOrigin?: readonly HookOriginEntry[]
      floors?: readonly HopFloor[]
    },
  ): Promise<WorkerReply>
  engineCreate(
    payload: Record<string, unknown>,
    environments: string[],
  ): Promise<WorkerReply>
  stream<TChunk, TReturn = unknown>(
    event: string,
    payload: Record<string, unknown>,
    environments: string[],
    openNextStream: (
      arg: Record<string, unknown>,
    ) => AsyncGenerator<unknown, unknown, unknown>,
    only?: string,
  ): AsyncGenerator<TChunk, TReturn, unknown>
  build(
    environmentId: string,
    table: unknown,
    suppressed?: unknown,
  ): Promise<WorkerReply>
  resolveTables(environmentId: string, requests: unknown): Promise<WorkerReply>
  callInterface(
    environmentId: string,
    call: { name: string; method: string; args?: unknown[] },
    callers?: unknown[],
  ): Promise<WorkerReply>
  press(
    environmentId: string,
    handle: unknown,
    event: unknown,
  ): Promise<WorkerReply>
  releasePresses(environmentId: string, handles: unknown[]): void
  flush(): Promise<number>
  abortOp(opId: number, reason?: string): void
  dispatchStream(
    event: string,
    payload: Record<string, unknown>,
  ): Promise<number>
  pullStream(id: number): void
  stop(): Promise<number>
}
