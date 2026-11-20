/**
 * densable 2.1.289 plugin_dev_mods — J / go / W / wfr / Ho / bOn.
 *
 * Gold WKe source `mod_hot_reload`. Skill prompt placeholder
 * `${CLAUDE_DEV_MODS_DIR}` expands to this session's mods folder.
 */
import { createHash } from 'crypto'
import { mkdirSync, readdirSync, statSync } from 'fs'
import chokidar from 'chokidar'
import { mkdir, readdir, readFile, stat, utimes, writeFile } from 'fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'path'
import { pathToFileURL } from 'url'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../../Tool.js'
import type { LoadedPlugin } from '../../types/plugin.js'
import type { ConfirmWithUserResult } from '../permissions/confirmWithUser.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { errorMessage, isENOENT } from '../errors.js'
import { isPersistedTrustIgnored } from './addDirPluginSettings.js'
import { evaluateClaudeAuthoredModLoadPolicy } from './functionHooksModules.js'
import {
  bindMainThreadTurn,
  getMainThreadTurn,
  releaseMainThreadTurn,
  subscribeMainThreadTurnBegin,
  subscribeMainThreadTurnEnd,
} from '../mainThreadTurn.js'

function asMeta(
  value: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

function leftoverDebug(
  message: string,
  level: 'error' | 'warn' = 'error',
): void {
  try {
    const { logForDebugging } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../debug.js') as typeof import('../debug.js')
    logForDebugging(message, { level })
  } catch {
    // ignore
  }
}

function leftoverUiLog(plugin: string, text: string): void {
  const { recordPluginUiLog } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./pluginUiLog.js') as typeof import('./pluginUiLog.js')
  recordPluginUiLog(plugin, text)
}

export const DEV_MODS_PLACEHOLDER = '${CLAUDE_DEV_MODS_DIR}'
const ASK_SOURCE = 'mod_hot_reload'
const EXPLAIN_MAX = 3
const PLUGIN_MANIFEST = join('.claude-plugin', 'plugin.json')
const WATCH_SKIP_NAMES = ['node_modules', '.git']
const WATCH_TYPES_DIR = join('.claude-plugin', 'types')

/** densable FA — `child` is under `root`. */
function leftoverPathInside(root: string, child: string): boolean {
  const rel = relative(root, child)
  return !(isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`))
}

/** densable KHr — skip hidden (except .claude-plugin), *.log, node_modules/.git, session log. */
function leftoverWatchSkipName(
  path: string,
  logPath: string | undefined,
): boolean {
  const name = basename(path)
  const hidden = name.startsWith('.') && name !== '.claude-plugin'
  const latest =
    logPath !== undefined &&
    (path === logPath || path === join(dirname(logPath), 'latest'))
  return (
    WATCH_SKIP_NAMES.includes(name) || hidden || name.endsWith('.log') || latest
  )
}

/**
 * densable YHr(folder, o6(), ()=>!1) — ignore node_modules/.git ancestors,
 * `.claude-plugin/types`, and KHr names. Gold `r` is always false so KHr wins.
 */
function leftoverModsWatchIgnored(
  folder: string,
  logPath: string | undefined,
): (watched: string) => boolean {
  const typesRoot = join(folder, WATCH_TYPES_DIR)
  return (watched: string) => {
    const resolved = resolve(watched)
    const rel = leftoverPathInside(folder, resolved)
      ? relative(folder, resolved)
      : resolved
    const parts = rel === '' ? [] : rel.split(sep)
    const ancestors = leftoverPathInside(folder, resolved)
      ? parts.map((_, i) => join(folder, ...parts.slice(0, i + 1)))
      : [resolved]
    if (ancestors.some(p => WATCH_SKIP_NAMES.includes(basename(p)))) return true
    if (leftoverPathInside(typesRoot, resolved)) return true
    return ancestors.some(p => leftoverWatchSkipName(p, logPath))
  }
}

const ASK_CHOICES = [
  { value: 'explain' as const, label: 'How does this work?' },
  { value: 'allow' as const, label: 'Turn them on' },
  {
    value: 'not_now' as const,
    label: 'Not now',
    description:
      'New and changed mods load without asking the next time this session starts.',
  },
]

export const DEV_MODS_QUESTION =
  'Turn on the mods Claude writes in this session?'

type PluginDevModsAsk =
  | 'enable'
  | 'decline'
  | 'withdrawn'
  | 'retry'
  | 'closed'
  | 'unpicked'
  | 'no_one_to_ask'

export type PluginDevModsBinding = {
  canUseTool: CanUseToolFn
  toolContext: (abort: AbortController) => ToolUseContext
  reloadPlugins?: () => Promise<void>
  permissionMode?: () => string | undefined
  sendDisplayRows?: (rows: unknown[]) => void
  surface?: string
}

type DevModLoad = 'reloaded' | 'held' | 'kept-out' | 'unbound' | 'failed'

type LeftoverModsWatch = {
  declined: () => string[]
  isClosed: () => boolean
  dispose: () => Promise<void>
}

type Stage =
  | {
      stage: 'wanted' | 'present' | 'consented' | 'enabled' | 'off'
      folder: string
      loaded?: string[]
    }
  | {
      stage: 'watching'
      folder: string
      loaded?: string[]
      watch: LeftoverModsWatch
    }

type LeftoverJsSlot<T> = {
  set: (value: T | undefined) => void
  get: () => T | undefined
}

/**
 * densable js() — `{set,get}` cell. Never export minify `js`.
 */
function leftoverJsSlot<T>(): LeftoverJsSlot<T> {
  let value: T | undefined
  return {
    set: (next: T | undefined) => {
      value = next
    },
    get: () => value,
  }
}

/**
 * densable et(js(), dispose) — pin dispose on registerCleanup. Never
 * export minify `et`.
 */
function leftoverEtSlot<T>(
  slot: LeftoverJsSlot<T>,
  dispose: (cell: LeftoverJsSlot<T>) => void,
): LeftoverJsSlot<T> {
  registerCleanup(() => dispose(slot))
  return slot
}

type LeftoverWatchRoot = {
  close: () => void | Promise<void>
}

type LeftoverWatchDeps = {
  watchRoot: (folder: string, onChange: () => void) => LeftoverWatchRoot
  loaded: string[]
  listChildren: (folder: string) => Promise<string[] | undefined>
  refusal: () => string | undefined
  ask: (folder: string, signal?: AbortSignal) => Promise<PluginDevModsAsk>
  enable: (folder: string) => Promise<void>
  deferred: () => void
  withdrawn: () => void
  unanswered: () => void
  stopped: (how: 'enabled' | 'refused' | 'no_one_to_ask' | 'no_pick') => void
  isYesStanding?: () => boolean
  clock: {
    now: () => number
    setTimeout: (
      fn: () => void,
      ms: number,
      opts?: { unref?: boolean },
    ) => () => void
  }
  turn: {
    isRunning: () => boolean
    isPersonTurn: () => boolean
    onBegin: (fn: () => void) => () => void
    onEnd: (fn: () => void) => () => void
  }
  quietMs: number
}

const QUIET_MS = 2000

/** densable pH / mIo / gIo / lOr / Kpn / yde analog — et(js()). */
const leftoverDevModsStage = leftoverEtSlot(leftoverJsSlot<Stage>(), cell => {
  const current = cell.get()
  if (current?.stage === 'watching') {
    void current.watch.dispose().catch(() => undefined)
  }
  cell.set(undefined)
})
const leftoverDevModsExpander = leftoverEtSlot(
  leftoverJsSlot<
    (text: string, opts: { isPreload?: boolean }) => Promise<string>
  >(),
  cell => cell.set(undefined),
)
const leftoverDevModsCatchUp = leftoverEtSlot(
  leftoverJsSlot<() => void>(),
  cell => cell.set(undefined),
)
const leftoverDevModsTurnEndUtimes = leftoverEtSlot(
  leftoverJsSlot<() => void>(),
  cell => {
    cell.get()?.()
    cell.set(undefined)
  },
)
const leftoverNoOneOff = leftoverEtSlot(leftoverJsSlot<string>(), cell =>
  cell.set(undefined),
)
const leftoverJoinPluginDir = leftoverEtSlot(
  leftoverJsSlot<{ joinPluginDir: (folder: string) => void }>(),
  cell => cell.set(undefined),
)
const leftoverEnabledDirs = leftoverEtSlot(leftoverJsSlot<string[]>(), cell =>
  cell.set(undefined),
)
const leftoverPresentDirs = leftoverEtSlot(leftoverJsSlot<string[]>(), cell =>
  cell.set(undefined),
)
const leftoverDeclinedFolders = leftoverEtSlot(
  leftoverJsSlot<string[]>(),
  cell => cell.set(undefined),
)

let binding: PluginDevModsBinding | undefined

type LeftoverTurnSlot = {
  turnId: number
  started: Promise<void>
  isPersonStarted: boolean
  cancelled: () => boolean
  cancel: () => void
}

const leftoverDevModsTurn = {
  isRunning(): boolean {
    return getMainThreadTurn() !== undefined
  },
  isPersonTurn(): boolean {
    return getMainThreadTurn()?.isPersonStarted === true
  },
  onBegin(fn: () => void): () => void {
    return subscribeMainThreadTurnBegin(fn)
  },
  onEnd(fn: () => void): () => void {
    return subscribeMainThreadTurnEnd(fn)
  },
}

/** densable n1 — `n.flat()`, resolve-keyed unique, first path wins. */
function leftoverUniqueDirs(...groups: string[][]): string[] {
  const seen = new Map<string, string>()
  for (const folder of groups.flat()) {
    const key = resolve(folder)
    if (!seen.has(key)) seen.set(key, folder)
  }
  return [...seen.values()]
}

const leftoverJoinedDevModsDirs = new Set<string>()
registerCleanup(() => leftoverJoinedDevModsDirs.clear())

let leftoverSessionSwitchSubscribed = false

function leftoverEnsureSessionSwitchIsolation(): void {
  if (leftoverSessionSwitchSubscribed) return
  try {
    const { onSessionSwitch } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
    leftoverSessionSwitchSubscribed = true
    const off = onSessionSwitch(() => {
      leftoverPruneForeignSessionDevModsDirs(sessionDevModsFolder())
    })
    registerCleanup(() => {
      off()
      leftoverSessionSwitchSubscribed = false
    })
  } catch {
    // bootstrap state optional in isolated unit tests
  }
}

function leftoverIsForeignDevModsDir(
  dir: string,
  currentResolved: string,
  devModsRootResolved: string,
): boolean {
  const resolved = resolve(dir)
  if (resolved === currentResolved) return false
  if (leftoverJoinedDevModsDirs.has(resolved)) return true
  return (
    resolved !== devModsRootResolved &&
    dirname(resolved) === devModsRootResolved
  )
}

function leftoverPruneForeignSessionDevModsDirs(currentFolder: string): void {
  const currentResolved = resolve(currentFolder)
  let devModsRootResolved = dirname(currentResolved)
  try {
    const { getClaudeConfigHomeDir } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../envUtils.js') as typeof import('../envUtils.js')
    devModsRootResolved = resolve(join(getClaudeConfigHomeDir(), 'dev-mods'))
  } catch {
    // fallback to dirname(currentResolved)
  }
  const keep = (dir: string): boolean =>
    !leftoverIsForeignDevModsDir(dir, currentResolved, devModsRootResolved)

  const enabled = leftoverEnabledDirs.get()
  if (enabled !== undefined) {
    const nextEnabled = enabled.filter(keep)
    leftoverEnabledDirs.set(nextEnabled.length > 0 ? nextEnabled : undefined)
  }
  const present = leftoverPresentDirs.get()
  if (present !== undefined) {
    const nextPresent = present.filter(keep)
    leftoverPresentDirs.set(nextPresent.length > 0 ? nextPresent : undefined)
  }
  const noOne = leftoverNoOneOff.get()
  if (
    noOne !== undefined &&
    leftoverIsForeignDevModsDir(noOne, currentResolved, devModsRootResolved)
  ) {
    leftoverNoOneOff.set(undefined)
  }
  const stage = leftoverDevModsStage.get()
  if (stage !== undefined && resolve(stage.folder) !== currentResolved) {
    if (stage.stage === 'watching') {
      void stage.watch.dispose().catch(error => {
        leftoverDebug(
          `dev mods: the watch did not close: ${errorMessage(error)}`,
        )
      })
    }
    leftoverDevModsStage.set(undefined)
  }
  try {
    const { getInlinePlugins, setInlinePlugins } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
    const prevInline = getInlinePlugins()
    const nextInline = prevInline.filter(keep)
    if (nextInline.length !== prevInline.length) {
      setInlinePlugins(nextInline)
      try {
        const { clearPluginCache } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('./pluginLoader.js') as typeof import('./pluginLoader.js')
        clearPluginCache('dev-mods: prune foreign session folder')
      } catch {
        // optional
      }
    }
  } catch {
    // bootstrap state optional
  }
}

function leftoverPinJoinPluginDir(): void {
  leftoverEnsureSessionSwitchIsolation()
  leftoverJoinPluginDir.set({
    joinPluginDir(folder: string) {
      leftoverJoinedDevModsDirs.add(resolve(folder))
      const { getInlinePlugins, setInlinePlugins } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
      setInlinePlugins(leftoverUniqueDirs(getInlinePlugins(), [folder]))
    },
  })
}

export function bindPluginDevModsSession(
  next: PluginDevModsBinding | undefined,
): void {
  binding = next
  if (next === undefined) leftoverJoinPluginDir.set(undefined)
  else leftoverPinJoinPluginDir()
}

/**
 * densable mpr — this turn's opener is a non-meta user message whose
 * origin is missing or kind human. A continuation that already passed an
 * assistant is not a person turn.
 */
export function isDevModsPersonTurn(
  messages: readonly {
    type?: string
    isMeta?: boolean
    origin?: { kind?: string }
  }[],
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.type === 'assistant') return false
    if (message?.type === 'user' && message.isMeta !== true) {
      return message.origin === undefined || message.origin.kind === 'human'
    }
  }
  return false
}

let leftoverTurnSeq = 0
let leftoverBoundTurnId: string | undefined

export function markPluginDevModsTurnRunning(
  running: boolean,
  person = false,
): void {
  if (running) {
    leftoverTurnSeq += 1
    const turnId = `dev-mods-${leftoverTurnSeq}`
    leftoverBoundTurnId = turnId
    bindMainThreadTurn({
      turnId,
      started: Promise.resolve(),
      startedBy: person ? 'person' : 'system',
      abort: () => {},
    })
    return
  }
  // densable yHr(turnId) — release only the bound id, not whatever is current.
  const turnId = leftoverBoundTurnId
  leftoverBoundTurnId = undefined
  if (turnId !== undefined) releaseMainThreadTurn(turnId)
}

/** densable Sss / yHr — bind turnId, release only that id. */
export function trackPluginDevModsTurn(opts?: {
  person?: boolean
  abort?: () => void
}): Disposable {
  leftoverTurnSeq += 1
  const turnId = `dev-mods-${leftoverTurnSeq}`
  const person = opts?.person === true
  bindMainThreadTurn({
    turnId,
    started: Promise.resolve(),
    startedBy: person ? 'person' : 'system',
    abort: opts?.abort ?? (() => {}),
  })
  return {
    [Symbol.dispose]() {
      releaseMainThreadTurn(turnId)
    },
  }
}

export function sessionDevModsFolder(): string {
  const { getClaudeConfigHomeDir } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../envUtils.js') as typeof import('../envUtils.js')
  const { getSessionId } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
  // Gold O9 rft is `join(we(), "dev-mods")`; dirname(pluginRoot) or its
  // parent matching rft is provenance `dev_mods`. Nest the session folder
  // so live mods attribute as gold, not plugin_dir.
  return join(getClaudeConfigHomeDir(), 'dev-mods', getSessionId())
}

function mapAsk(
  result: ConfirmWithUserResult<(typeof ASK_CHOICES)[number]['value']>,
): PluginDevModsAsk | 'explain' {
  switch (result.kind) {
    case 'chose':
      return result.value === 'allow'
        ? 'enable'
        : result.value === 'not_now'
          ? 'decline'
          : 'explain'
    case 'declined':
      return 'decline'
    case 'aborted':
      return 'withdrawn'
    case 'unanswered':
      switch (result.reason as string) {
        case 'no_one_to_ask':
          return 'no_one_to_ask'
        case 'host_closed':
          return 'closed'
        case 'no_selection':
          return 'unpicked'
        case 'error':
        default:
          return 'retry'
      }
  }
}

function folderMarkdown(folder: string): string {
  try {
    const href = pathToFileURL(folder)
      .href.replaceAll('(', '%28')
      .replaceAll(')', '%29')
    return `[this session's folder](${href})`
  } catch {
    return `this session's folder (${folder})`
  }
}

function notePluginDevMods(text: string): void {
  try {
    const { enqueuePendingNotification } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../messageQueueManager.js') as typeof import('../messageQueueManager.js')
    const { getSessionId } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
    type AgentId = import('../../types/ids.js').AgentId
    enqueuePendingNotification({
      value: text,
      mode: 'task-notification',
      skipAttachments: true,
      isMeta: true,
      // densable D() agentId:Ve() mode:task-notification skipAttachments:!0
      // isMeta:hEo priority:next shouldQuery:!1 passive:!0. Ve analog is getSessionId().
      agentId: getSessionId() as unknown as AgentId,
      shouldQuery: false,
      passive: true,
      priority: 'next',
    })
  } catch {
    // ignore
  }
}

/** densable To[] — off-reason copy for D({kind:"off"}). */
const REFUSAL_OFF: Record<string, string> = {
  hooks_modules_off: 'hooks modules are switched off in this process',
  all_hooks_disabled: 'the organization disables all hooks',
  sideload_disabled: 'the organization forbids side-loaded plugins',
  local_dirs_blocked: 'the organization blocks plugins from local folders',
  managed_hooks_only: 'the organization allows only managed hooks',
  hooks_disabled_in_settings:
    'hooks are turned off in your settings (disableAllHooks)',
  safe_mode: 'the session runs in safe mode',
  diskless: 'this kind of cloud session has no disk to load mods from',
  bare_mode: 'the session runs in bare mode',
  dont_ask: 'the session is in dontAsk mode',
  untrusted: 'the workspace is not trusted',
}

const NO_ONE_TO_ASK_OFF = 'nobody could be asked'
const NO_PICK_OFF = 'the question got no pick three times'

/** densable Kpn.get */
export function leftoverDevModsCatchUpSlot(): (() => void) | undefined {
  return leftoverDevModsCatchUp.get()
}

/** densable mIo.get */
export function leftoverDevModsExpanderSlot():
  | ((text: string, opts: { isPreload?: boolean }) => Promise<string>)
  | undefined {
  return leftoverDevModsExpander.get()
}

function pinLeftoverDevModsCatchUp(): void {
  leftoverDevModsCatchUp.set(leftoverCatchUp)
}

function leftoverOffNote(folder: string, reason: string): void {
  const where = folderMarkdown(folder)
  notePluginDevMods(
    `Mod hot-reloading is off in this session (${reason}): mods under ${where} are not loaded.`,
  )
}

/** densable So / B / Ye — refused → To[g()]; no_one_to_ask → B; no_pick → je. */
function leftoverStopped(
  folder: string,
  how: 'enabled' | 'refused' | 'no_one_to_ask' | 'no_pick',
): void {
  if (how === 'enabled') return
  if (how === 'no_one_to_ask') {
    if (leftoverNoOneOff.get() === folder) return
    leftoverNoOneOff.set(folder)
    leftoverOffNote(folder, NO_ONE_TO_ASK_OFF)
    return
  }
  if (how === 'no_pick') {
    leftoverOffNote(folder, NO_PICK_OFF)
    return
  }
  const refusal = leftoverPluginDevModsRefusalProbe()
  if (refusal === undefined) return
  leftoverPluginDevModsRefusalDot(refusal)
  const reason = REFUSAL_OFF[refusal]
  if (reason === undefined) return
  leftoverOffNote(folder, reason)
}

function loadWhen(when: 'now' | 'turn-end'): string {
  return when === 'now' ? 'now' : 'when this turn ends'
}

function shortQuestion(_folder: string, when: 'now' | 'turn-end'): string {
  return `${DEV_MODS_QUESTION}\n\nThey'll load ${loadWhen(when)}, and they'll reload whenever they change. A mod is code, and it runs with the same access you have here.`
}

function longQuestion(_folder: string, when: 'now' | 'turn-end'): string {
  return [
    DEV_MODS_QUESTION,
    '',
    'A mod is a small program that changes how Claude looks or behaves here.',
    'Claude wrote these mods, and they run with the same access you have.',
    when === 'now'
      ? "If you turn them on, they'll load now and reload whenever they change."
      : "Once they're on, they load when this turn ends and reload when they change.",
    'That lasts for the rest of this session, even if it restarts.',
    'If you choose Not now, nothing new will load until this session next starts.',
    "You can see what's loaded, and turn it off, with /plugin.",
  ].join('\n')
}

/** densable XD — !diskless && tengu_plugin_hooks_modules default true. */
export function leftoverHooksModulesOn(): boolean {
  try {
    const { isDisklessLaunch } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../sessionHost.js') as typeof import('../sessionHost.js')
    if (isDisklessLaunch()) return false
  } catch {
    /* default on */
  }
  try {
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../services/analytics/growthbook.js') as typeof import('../../services/analytics/growthbook.js')
    return getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_plugin_hooks_modules',
      true,
    )
  } catch {
    return true
  }
}

/** densable A8 — disableSideloadFlags only. LT() is command-source, not this row. */
/** densable A8 — policySettings.disableSideloadFlags. Never export minify `A8`. */
export function leftoverSideloadDisabled(): boolean {
  try {
    const { getSettingsForSource } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../settings/settings.js') as typeof import('../settings/settings.js')
    return getSettingsForSource('policySettings')?.disableSideloadFlags === true
  } catch {
    return false
  }
}

/** densable C8 — blockedMarketplaces skills-dir first, then allowlist. */
function leftoverLocalDirsAllowed(): boolean {
  try {
    const { getBlockedMarketplaces, getStrictKnownMarketplaces } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./marketplaceHelpers.js') as typeof import('./marketplaceHelpers.js')
    if (
      getBlockedMarketplaces()?.some(
        entry => (entry as { source?: string }).source === 'skills-dir',
      )
    ) {
      return false
    }
    const allowlist = getStrictKnownMarketplaces()
    if (allowlist === null) return true
    return allowlist.some(
      entry => (entry as { source?: string }).source === 'skills-dir',
    )
  } catch {
    return true
  }
}

function leftoverPluginDevModsRefusalProbe(): string | undefined {
  // densable g / so[] — silent probe. logEvent only leftoverStartWatch /
  // leftoverStopped refused. Never export minify `g`.
  const rows: { refusal: string; isRefused: () => boolean }[] = [
    {
      refusal: 'diskless',
      isRefused: () => {
        try {
          const { isDisklessLaunch } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../sessionHost.js') as typeof import('../sessionHost.js')
          return isDisklessLaunch()
        } catch {
          return false
        }
      },
    },
    {
      refusal: 'hooks_modules_off',
      isRefused: () => !leftoverHooksModulesOn(),
    },
    {
      refusal: 'all_hooks_disabled',
      isRefused: () => {
        try {
          const { shouldDisableAllHooksIncludingManaged } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../hooks/hooksConfigSnapshot.js') as typeof import('../hooks/hooksConfigSnapshot.js')
          return shouldDisableAllHooksIncludingManaged()
        } catch {
          return false
        }
      },
    },
    {
      refusal: 'sideload_disabled',
      isRefused: leftoverSideloadDisabled,
    },
    {
      refusal: 'local_dirs_blocked',
      isRefused: () => !leftoverLocalDirsAllowed(),
    },
    {
      refusal: 'managed_hooks_only',
      isRefused: () => {
        try {
          const { getSettingsForSource } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../settings/settings.js') as typeof import('../settings/settings.js')
          return (
            getSettingsForSource('policySettings')?.allowManagedHooksOnly ===
            true
          )
        } catch {
          return false
        }
      },
    },
    {
      refusal: 'hooks_disabled_in_settings',
      isRefused: () => {
        try {
          const { getSettings_DEPRECATED, getSettingsForSource } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../settings/settings.js') as typeof import('../settings/settings.js')
          return (
            getSettings_DEPRECATED().disableAllHooks === true &&
            getSettingsForSource('policySettings')?.disableAllHooks !== true
          )
        } catch {
          return false
        }
      },
    },
    {
      refusal: 'safe_mode',
      isRefused: () => {
        try {
          const { isSafeModeEnabled } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../safeMode.js') as typeof import('../safeMode.js')
          return isSafeModeEnabled()
        } catch {
          return false
        }
      },
    },
    {
      refusal: 'bare_mode',
      isRefused: () => {
        try {
          const { isBareMode } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../envUtils.js') as typeof import('../envUtils.js')
          return isBareMode()
        } catch {
          return false
        }
      },
    },
    {
      refusal: 'dont_ask',
      isRefused: () => binding?.permissionMode?.() === 'dontAsk',
    },
    {
      refusal: 'untrusted',
      isRefused: () => {
        if (isPersistedTrustIgnored()) return true
        try {
          const { checkHasTrustDialogAccepted } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../config.js') as typeof import('../config.js')
          return !checkHasTrustDialogAccepted()
        } catch {
          return false
        }
      },
    },
  ]
  return rows.find(row => row.isRefused())?.refusal
}

function leftoverPluginDevModsRefusalDot(refusal: string): void {
  try {
    const { logEvent } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
    logEvent('plugin_dev_mods', { reason: asMeta(refusal) })
  } catch {
    // ignore
  }
}

/** densable g used by watch. Silent probe — never logEvent here. */
export function pluginDevModsRefusal(): string | undefined {
  return leftoverPluginDevModsRefusalProbe()
}

/** densable W — someone can answer, or binding is not ready yet. */
export function canAskPluginDevMods(): boolean {
  if (binding === undefined) return true
  try {
    const { canConfirmWithUser } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../permissions/confirmWithUser.js') as typeof import('../permissions/confirmWithUser.js')
    return canConfirmWithUser(binding.toolContext(new AbortController()))
  } catch (error) {
    leftoverDebug(`dev mods: no context to ask in yet: ${errorMessage(error)}`)
    return true
  }
}

/**
 * 325 `C` (#1938) — auto-enable Claude-authored mods in `bypassPermissions` or
 * non-circuit-broken `auto` mode, even when managed `allowUnsandboxedCommands: false`
 * or `allowManagedDomainsOnly` is active; never in `dontAsk`.
 */
export function canAutoEnablePluginDevMods(): boolean {
  const mode = binding?.permissionMode?.()
  let isAutoCircuitBroken = false
  if (mode === 'auto') {
    try {
      const { getPlatform } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../platform.js') as typeof import('../platform.js')
      const plat = getPlatform()
      if (plat === 'windows' || plat === 'wsl') return false
    } catch {
      return false
    }
    try {
      const { isAutoModeCircuitBroken } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../permissions/autoModeState.js') as typeof import('../permissions/autoModeState.js')
      isAutoCircuitBroken = isAutoModeCircuitBroken()
    } catch {
      isAutoCircuitBroken = false
    }
  }
  return (
    evaluateClaudeAuthoredModLoadPolicy(mode, { isAutoCircuitBroken }) ===
    'auto-enable'
  )
}

/**
 * #1952 (2.1.321): Returns true when `CLAUDE_CODE_PLUGIN_DIR_WATCH=0` / `false`
 * explicitly turns off mod file watching (including headless `.claude/skills` mods).
 */
export function isPluginDirWatchDisabledByEnv(): boolean {
  return isEnvDefinedFalsy(process.env.CLAUDE_CODE_PLUGIN_DIR_WATCH)
}

/**
 * #1952 (official `TDs`): General plugin-dir watch default — explicit env var
 * if set, otherwise on in interactive sessions and off in headless sessions.
 */
export function isPluginDirWatchEnabledByDefault(
  isNonInteractive?: boolean,
): boolean {
  const raw = process.env.CLAUDE_CODE_PLUGIN_DIR_WATCH
  if (raw !== undefined && raw.trim() !== '') {
    return isEnvTruthy(raw)
  }
  if (isNonInteractive !== undefined) {
    return !isNonInteractive
  }
  try {
    const { getIsNonInteractiveSession } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
    return !getIsNonInteractiveSession()
  } catch {
    return true
  }
}

/**
 * #1952 (official `HAo` / `LAo`): Select which mod directories should be
 * watched. Even in headless sessions, `.claude/skills` mod folders (`skillModDirs`)
 * are watched by default unless `CLAUDE_CODE_PLUGIN_DIR_WATCH=0` is set.
 */
export function filterWatchedModDirs(
  dirs: readonly string[],
  opts?: {
    skillModDirs?: readonly string[]
    excludedDirs?: readonly string[]
    isNonInteractive?: boolean
  },
): string[] {
  if (isPluginDirWatchDisabledByEnv()) {
    return []
  }
  const skillSet = new Set((opts?.skillModDirs ?? []).map(d => resolve(d)))
  if (isPluginDirWatchEnabledByDefault(opts?.isNonInteractive)) {
    const excludedSet = new Set((opts?.excludedDirs ?? []).map(d => resolve(d)))
    return dirs.filter(d => {
      const r = resolve(d)
      return skillSet.has(r) || !excludedSet.has(r)
    })
  }
  return dirs.filter(d => skillSet.has(resolve(d)))
}

/**
 * #1858 (2.1.321): Select plugins eligible for `.claude-plugin/types/`
 * generation under `--plugin-dir`. Built-in plugins (`isBuiltin === true`) are
 * always excluded so `--plugin-dir .` / `--plugin-dir ./builtin` never writes
 * generated type files into a `builtin` directory.
 */
export function selectPluginDirTypeTargets(
  plugins: readonly LoadedPlugin[],
  pluginDirs: readonly string[],
): LoadedPlugin[] {
  const resolvedDirs = pluginDirs.map(d => resolve(d))
  return plugins.filter(plugin => {
    if (plugin.isBuiltin === true) {
      return false
    }
    const pluginPath = resolve(plugin.path)
    return resolvedDirs.some(dir => {
      const rel = relative(dir, pluginPath)
      if (rel === '') return true
      return !isAbsolute(rel) && !rel.startsWith('..') && !rel.includes(sep)
    })
  })
}

/**
 * #1858: Lay `.claude-plugin/types/` for a non-builtin `--plugin-dir` plugin.
 * Filters out built-in plugins (`!isBuiltin`) unless they explicitly declare
 * `manifest.types`, preventing writes into a `builtin` folder.
 */
export async function layPluginDirTypes(
  plugin: LoadedPlugin,
  allLoaded: readonly LoadedPlugin[],
  opts?: { version?: string },
): Promise<{ typeRoot: string; written: string[] } | undefined> {
  if (plugin.isBuiltin === true) {
    return undefined
  }
  const pluginRoot = resolve(plugin.path)
  const typeRoot = join(pluginRoot, WATCH_TYPES_DIR)
  if (!leftoverPathInside(pluginRoot, typeRoot)) {
    return undefined
  }

  const peerNames = allLoaded
    .filter(
      peer =>
        peer.name !== plugin.name &&
        peer.isBuiltin !== true &&
        peer.name !== '' &&
        peer.name !== '.' &&
        peer.name !== '..' &&
        !peer.name.includes('/') &&
        !peer.name.includes('\\'),
    )
    .map(peer => peer.name)

  const entries = ['claude-code', ...new Set(peerNames)]
  const written: string[] = []
  await mkdir(join(typeRoot, 'claude-code'), { recursive: true })

  const gitignorePath = join(typeRoot, '.gitignore')
  await writeFile(gitignorePath, '*\n', 'utf8')
  written.push('.claude-plugin/types/.gitignore')

  const version = opts?.version ?? '0.0.0'
  const coreDtsPath = join(typeRoot, 'claude-code', 'index.d.ts')
  await writeFile(
    coreDtsPath,
    `// Generated by Claude Code ${version} for --plugin-dir type resolution\nexport {}\n`,
    'utf8',
  )
  written.push('.claude-plugin/types/claude-code/index.d.ts')

  const tsconfigPath = join(typeRoot, 'tsconfig.json')
  const tsconfig = {
    compilerOptions: {
      noEmit: true,
      types: entries,
      typeRoots: ['.'],
    },
  }
  await writeFile(
    tsconfigPath,
    `${JSON.stringify(tsconfig, null, 2)}\n`,
    'utf8',
  )
  written.push('.claude-plugin/types/tsconfig.json')

  return { typeRoot, written }
}

/**
 * #1858: Production entry point called from `pluginLoader.ts` to lay
 * `.claude-plugin/types/` for `--plugin-dir` plugins (excluding built-in plugins).
 */
export async function layPluginDirTypesForLoadedPlugins(
  plugins: readonly LoadedPlugin[],
  pluginDirs: readonly string[],
): Promise<void> {
  const targets = selectPluginDirTypeTargets(plugins, pluginDirs)
  await Promise.all(
    targets.map(plugin =>
      layPluginDirTypes(plugin, plugins).catch(err => {
        leftoverDebug(
          `type root of ${plugin.name} not laid: ${errorMessage(err)}`,
          'warn',
        )
      }),
    ),
  )
}

const DEV_MODS_DECLINED_UI_TEXT = 'Not turned on.'

function safeUiRecord(fn: () => void): void {
  try {
    fn()
  } catch (err) {
    try {
      const { logEvent } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
      logEvent('plugin_dev_mods', { reason: asMeta('answer_not_shown') })
    } catch {
      // ignore
    }
    leftoverDebug(errorMessage(err))
  }
}

function buildAskDisplayRows(toolUseId: string, answer: string): unknown[] {
  const questions = [
    {
      question: DEV_MODS_QUESTION,
      header: 'Mods',
      options: ASK_CHOICES.filter(c => c.value !== 'explain').map(c => ({
        label: c.label,
        description: '',
      })),
      multiSelect: false,
    },
  ]
  const toolUseResult = {
    questions,
    answers: { [DEV_MODS_QUESTION]: answer },
  }
  const { createAssistantMessage, createUserMessage } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../messages.js') as typeof import('../messages.js')
  const { AskUserQuestionTool } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@claude-code/builtin-tools/tools/AskUserQuestionTool/AskUserQuestionTool.js') as typeof import('@claude-code/builtin-tools/tools/AskUserQuestionTool/AskUserQuestionTool.js')
  const assistantMsg = createAssistantMessage({
    content: [
      {
        type: 'tool_use',
        id: toolUseId,
        name: 'AskUserQuestion',
        input: { questions },
      },
    ],
    isVirtual: true,
  })
  const userMsg = createUserMessage({
    content: [
      AskUserQuestionTool.mapToolResultToToolResultBlockParam(
        toolUseResult,
        toolUseId,
      ),
    ],
    toolUseResult,
    isVirtual: true,
  })
  return [
    {
      ...assistantMsg,
      message: { ...assistantMsg.message, stop_reason: 'tool_use' },
    },
    userMsg,
  ]
}

function recordAnswerInUi(
  raw: ConfirmWithUserResult<'explain' | 'allow' | 'not_now'>,
  toolUseId: string,
): void {
  safeUiRecord(() => {
    const activeBinding = binding
    const choiceLabel =
      raw.kind === 'chose'
        ? ASK_CHOICES.find(c => c.value === raw.value)?.label
        : undefined
    const answerText = raw.kind === 'declined' ? raw.typedAnswer : choiceLabel
    if (answerText !== undefined) {
      activeBinding?.sendDisplayRows?.(
        buildAskDisplayRows(toolUseId, answerText),
      )
    }
    if (choiceLabel !== undefined && activeBinding?.surface === 'terminal') {
      leftoverUiLog('Mods', `${DEV_MODS_QUESTION} → ${choiceLabel}`)
    }
  })
  if (raw.kind === 'declined') {
    safeUiRecord(() => leftoverUiLog('Mods', DEV_MODS_DECLINED_UI_TEXT))
  }
}

/** densable J — recurse explain up to 3. */
async function askPluginDevModsLoop(
  folder: string,
  abort: AbortController,
  depth: number,
): Promise<PluginDevModsAsk> {
  if (binding === undefined) return 'no_one_to_ask'
  const { confirmWithUser } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../permissions/confirmWithUser.js') as typeof import('../permissions/confirmWithUser.js')
  const when = leftoverDevModsTurn.isRunning() ? 'turn-end' : 'now'
  const question =
    depth === 0 ? shortQuestion(folder, when) : longQuestion(folder, when)
  const captured = { id: '' }
  const activeCanUseTool = binding.canUseTool
  const raw = await confirmWithUser({
    canUseTool: (...args) => {
      captured.id = args[4]
      return activeCanUseTool(...args)
    },
    toolUseContext: binding.toolContext(abort),
    source: ASK_SOURCE,
    header: 'Mods',
    question,
    choices: ASK_CHOICES,
    personOnly: true,
  })
  const mapped = mapAsk(raw)
  const isTypedOther =
    mapped === 'decline' &&
    raw.kind === 'declined' &&
    raw.typedAnswer !== undefined &&
    !/^\[.*\]$/u.test(raw.typedAnswer)
  if (mapped !== 'explain' && !isTypedOther) {
    recordAnswerInUi(raw, captured.id)
    return mapped
  }
  if (mapped === 'explain') {
    try {
      const { logEvent } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
      logEvent('plugin_dev_mods', { answer: asMeta('explain') })
    } catch {
      // ignore
    }
  }
  if (depth < EXPLAIN_MAX) {
    return askPluginDevModsLoop(folder, abort, depth + 1)
  }
  recordAnswerInUi(
    isTypedOther
      ? raw
      : ({ kind: 'declined' } as ConfirmWithUserResult<
          'explain' | 'allow' | 'not_now'
        >),
    captured.id,
  )
  return 'decline'
}

/** densable go */
export async function askPluginDevMods(
  folder: string,
  signal?: AbortSignal,
): Promise<PluginDevModsAsk> {
  if (binding === undefined) {
    try {
      const { logEvent } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
      logEvent('plugin_dev_mods', { reason: asMeta('no_session') })
    } catch {
      // ignore
    }
    return 'no_one_to_ask'
  }
  const abort = new AbortController()
  const onAbort = () => abort.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const answer = await askPluginDevModsLoop(folder, abort, 0)
    try {
      const { logEvent } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
      if (answer === 'no_one_to_ask') {
        logEvent('plugin_dev_mods', { reason: asMeta('no_one_to_ask') })
      } else {
        logEvent('plugin_dev_mods', { answer: asMeta(answer) })
      }
    } catch {
      // ignore
    }
    return answer
  } catch (error) {
    try {
      const { logForDebugging } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../debug.js') as typeof import('../debug.js')
      const { errorMessage } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../errors.js') as typeof import('../errors.js')
      logForDebugging(
        `dev mods: the ask failed, asked again later: ${errorMessage(error)}`,
        { level: 'error' },
      )
    } catch {
      // ignore
    }
    return 'retry'
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

export function listPluginDevModChildren(folder: string): string[] | undefined {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter(
        entry =>
          (entry.isDirectory() || entry.isSymbolicLink()) &&
          !entry.name.startsWith('.'),
      )
      .map(entry => entry.name)
      .filter(name => {
        try {
          return statSync(join(folder, name, PLUGIN_MANIFEST)).isFile()
        } catch {
          return false
        }
      })
      .toSorted()
  } catch (error) {
    if (isENOENT(error)) return undefined
    throw error
  }
}

function devModLoadSentence(
  where: string,
  outcome: DevModLoad,
  isUnasked = false,
  keptOutCause?: string,
): string {
  const actor = isUnasked
    ? 'The permission mode turned on'
    : 'The person enabled'
  switch (outcome) {
    case 'held':
      return `${actor} mod hot-reloading for this session, but the mods under ${where} wait for /reload-plugins (the load would rewrite the prompt cache): they are NOT loaded yet.`
    case 'kept-out':
      return `${actor} mod hot-reloading for this session, but the hooks modules of the mods under ${where} had NOT loaded when this notice was written. They count as a person's hooks modules, not an organization's. The reason: ${keptOutCause ?? 'policy or rollout flag'}. You get no further notice about them, so do not say they are running, and /reload-plugins does not load them sooner. A mod with no hooks module did load.`
    case 'unbound':
      return `${actor} mod hot-reloading for this session, but the mods under ${where} did not load (this session cannot reload its plugins; only a restart loads them).`
    case 'failed':
      return `${actor} mod hot-reloading for this session, but the mods under ${where} did not load (the load failed; the transcript says why, and /reload-plugins tries again).`
    case 'reloaded':
      return `${actor} mod hot-reloading for this session and the mods under ${where} loaded: they load and reload by themselves as their files change; the transcript names any mod that failed.`
  }
}

function stripTrailingSentencePunct(text: string): string {
  return text.trimEnd().replace(/[.!?]$/u, '')
}

export type DevModReloadStatusEvent =
  | { kind: 'reloaded'; refused?: string; earlierStopped?: boolean }
  | { kind: 'unnamed' }
  | { kind: 'restart' }
  | { kind: 'vetoed'; isServing: boolean }
  | { kind: 'failed'; isServing: boolean; reason: string }
  | { kind: 'folder-failed'; hadLoaded: boolean; reason: string }
  | { kind: 'paused' }
  | { kind: 'folder-paused' }
  | { kind: 'removed'; stayedLoaded: boolean }

/** Upstream v2.1.304 `Yfo` / `Vfo` — human-readable mod status lines. */
export function formatDevModReloadStatus(
  event: DevModReloadStatusEvent,
): string | undefined {
  switch (event.kind) {
    case 'reloaded':
      if (event.refused === undefined) {
        return 'This mod reloaded after a change to its files.'
      }
      return event.earlierStopped
        ? `This mod didn't load, and the earlier version is no longer running: ${stripTrailingSentencePunct(event.refused)}.`
        : `This mod didn't load: ${stripTrailingSentencePunct(event.refused)}.`
    case 'unnamed':
      return 'This mod no longer names any code to run, so nothing of it is running.'
    case 'restart':
      return "This mod changed in a way that needs a restart. It'll load the next time this session starts."
    case 'vetoed':
      return event.isServing
        ? 'A change to this mod was blocked by one of your hooks, so the earlier version is still running.'
        : undefined
    case 'failed':
      return event.isServing
        ? `This mod's change didn't load, so the earlier version is still running: ${stripTrailingSentencePunct(event.reason)}.`
        : undefined
    case 'folder-failed':
      return event.hadLoaded
        ? `Couldn't reload: ${stripTrailingSentencePunct(event.reason)}. The earlier versions are still running.`
        : undefined
    case 'paused':
      return 'This mod is changing very often, so reloading is paused. The latest version loads once the changes stop.'
    case 'folder-paused':
      return undefined
    case 'removed':
      return event.stayedLoaded
        ? 'This mod was removed. It stays loaded until this session restarts.'
        : "This mod was removed, so it's no longer loaded."
  }
}

/** Upstream v2.1.304 `tbo` — distinguish kept previous version on reload failure. */
export function formatDevModReloadFailure(
  name: string,
  error: unknown,
  previousVersionKept: boolean,
): string {
  const detail = leftoverWae(name, error)
  return previousVersionKept
    ? `reload failed, the previous version stays loaded: ${detail}`
    : `reload failed: ${detail}`
}

function devModLine(outcome: DevModLoad, loaded: boolean): string | undefined {
  if (outcome === 'failed') return undefined
  if (outcome === 'held') {
    return "in this session's mods folder, on hold: /reload-plugins applies it"
  }
  if (outcome === 'unbound') {
    return "in this session's mods folder; restart to apply"
  }
  if (outcome === 'kept-out') {
    return loaded
      ? 'This mod is now loaded.'
      : "in this session's mods folder, not loaded; /plugin shows why"
  }
  return loaded
    ? 'This mod is now loaded.'
    : "in this session's mods folder, not loaded; /plugin shows why"
}

function recordDevModLines(folder: string, outcome: DevModLoad): void {
  const { recordPluginUiLog } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./pluginUiLog.js') as typeof import('./pluginUiLog.js')
  const present = listPluginDevModChildren(folder) ?? []
  if (outcome !== 'reloaded') {
    const text = devModLine(outcome, false)
    if (text === undefined) return
    for (const name of present) recordPluginUiLog(name, text)
    return
  }
  let enabled: Array<{ name: string; path: string }> = []
  try {
    enabled =
      binding?.toolContext(new AbortController()).getAppState().plugins
        .enabled ?? []
  } catch {
    enabled = []
  }
  const loadedChild = new Set<string>()
  for (const plugin of enabled) {
    const child = present.find(name => {
      const root = join(folder, name)
      return plugin.path === root || plugin.path.startsWith(root + sep)
    })
    if (child === undefined) continue
    loadedChild.add(child)
    const text = devModLine('reloaded', true)
    if (text !== undefined) recordPluginUiLog(plugin.name, text)
  }
  const missing = devModLine('reloaded', false)
  if (missing === undefined) return
  for (const name of present) {
    if (!loadedChild.has(name)) recordPluginUiLog(name, missing)
  }
}

export type DevModFileStamp = {
  size: number
  hash: string
}

export type DevModTrackedStamp = {
  ctimeMs: number
  stamp?: DevModFileStamp
}

export type DevModStampState = {
  read?: DevModFileStamp
  taken?: DevModTrackedStamp
  isServed?: boolean
}

/**
 * #635: SEA `Wpe(e, n)` — compare two file `{ size, hash }` fingerprints.
 */
export function compareFileStamp(
  a: DevModFileStamp | undefined,
  b: DevModFileStamp | undefined,
): 'same' | 'other' | 'unknown' {
  if (a === undefined || b === undefined) return 'unknown'
  return a.size === b.size && a.hash === b.hash ? 'same' : 'other'
}

/**
 * #635: SEA `wxt(e, n, r)` — decide whether a file change event should trigger
 * a mod hot reload (`undefined`) or be skipped (`'served' | 'retold' | 'clock'`).
 */
export function classifyFileStampChange(
  next: DevModTrackedStamp,
  state: DevModStampState,
  readAtMs: number,
): 'served' | 'retold' | 'clock' | undefined {
  const vsRead = compareFileStamp(next.stamp, state.read)
  const vsTaken =
    next.ctimeMs === state.taken?.ctimeMs
      ? compareFileStamp(next.stamp, state.taken?.stamp)
      : 'other'
  const isNewContent = vsRead === 'other' && vsTaken !== 'same'
  const isAlreadyServed = vsRead === 'same' && Boolean(state.isServed)
  const isRetold = vsTaken !== 'other'
  const isStaleClock = next.ctimeMs <= readAtMs
  return isNewContent
    ? undefined
    : isAlreadyServed
      ? 'served'
      : isRetold
        ? 'retold'
        : isStaleClock
          ? 'clock'
          : undefined
}

export function createDevModStampTracker(now: () => number = Date.now) {
  const files = new Map<string, DevModStampState>()
  const forgotten = new Set<string>()
  let readAtMs = 0

  return {
    shouldReload(filePath: string, next: DevModTrackedStamp): boolean {
      const wasForgotten = forgotten.delete(filePath)
      const state = files.get(filePath) ?? {}
      const effectiveReadAtMs = wasForgotten ? 0 : readAtMs
      const skip = classifyFileStampChange(next, state, effectiveReadAtMs)
      if (skip !== undefined) {
        return false
      }
      files.set(filePath, {
        ...state,
        taken: next,
      })
      return true
    },
    markReloaded(succeeded: boolean): void {
      readAtMs = now()
      for (const [path, state] of files) {
        if (succeeded && state.taken?.stamp !== undefined) {
          files.set(path, {
            read: state.taken.stamp,
            taken: state.taken,
            isServed: true,
          })
        } else if (!succeeded) {
          files.set(path, {
            ...state,
            isServed: false,
          })
        }
      }
    },
    forget(filePath: string): void {
      files.delete(filePath)
      forgotten.add(filePath)
    },
    getState(filePath: string): DevModStampState | undefined {
      return files.get(filePath)
    },
    getPendingCtimeMs(): number[] {
      const ctimes: number[] = []
      for (const state of files.values()) {
        if (state.taken?.ctimeMs === undefined) continue
        const isPending =
          !state.isServed ||
          state.read === undefined ||
          state.taken.stamp === undefined ||
          state.taken.stamp.size !== state.read.size ||
          state.taken.stamp.hash !== state.read.hash
        if (isPending) {
          ctimes.push(state.taken.ctimeMs)
        }
      }
      return ctimes
    },
  }
}

const activeDevModStampTracker = createDevModStampTracker()

async function readDevModTrackedStamp(
  filePath: string,
): Promise<DevModTrackedStamp | undefined> {
  try {
    const [st, bytes] = await Promise.all([stat(filePath), readFile(filePath)])
    if (!st.isFile()) return undefined
    const hash = createHash('sha256').update(bytes).digest('hex')
    return {
      ctimeMs: st.ctimeMs,
      stamp: { size: st.size, hash },
    }
  } catch {
    return undefined
  }
}

/**
 * Official 2.1.328 (#623) `Rn` inside `kn(Xn, so)`: when a turn-begin rescan
 * finishes while the turn is still running, check whether any pending file was
 * saved *after* the turn began (`Math.floor(ctimeMs) > turnStartedAt && <= now`).
 * If so, defer the reload until turn end instead of reloading mid-turn!
 */
export function shouldDeferModReloadAfterTurnBegin(options: {
  turnStartedAt: number | undefined
  isTurnRunning: boolean
  pendingCtimeMs: readonly number[]
  nowMs: number
}): boolean {
  const { turnStartedAt, isTurnRunning, pendingCtimeMs, nowMs } = options
  if (turnStartedAt === undefined || !isTurnRunning) return false
  return pendingCtimeMs.some(ctime => {
    const floored = Math.floor(ctime)
    return floored > turnStartedAt && floored <= nowMs
  })
}

let activeDevModTurnStartedAt: number | undefined

async function collectFolderPendingCtimeMs(
  folder: string,
  depth = 0,
): Promise<number[]> {
  if (depth > 3) return []
  const ctimes: number[] = []
  try {
    const entries = await readdir(folder, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const fullPath = join(folder, entry.name)
      if (entry.isFile()) {
        const st = await stat(fullPath).catch(() => undefined)
        if (st?.isFile()) {
          ctimes.push(st.ctimeMs)
        }
      } else if (entry.isDirectory()) {
        const nested = await collectFolderPendingCtimeMs(fullPath, depth + 1)
        ctimes.push(...nested)
      }
    }
  } catch {
    // best-effort scan
  }
  return ctimes
}

/** densable gqn / M9t — held when a reload would bust the prompt cache or a mod changed mid-turn (#623). */
async function reloadDevMods(opts?: {
  folder?: string
  pendingCtimeMs?: readonly number[]
  nowMs?: number
}): Promise<DevModLoad> {
  if (binding?.reloadPlugins === undefined) return 'unbound'
  let pendingCtimeMs = opts?.pendingCtimeMs
  if (pendingCtimeMs === undefined) {
    const trackerCtimes = activeDevModStampTracker.getPendingCtimeMs()
    if (trackerCtimes.length > 0) {
      pendingCtimeMs = trackerCtimes
    } else if (opts?.folder) {
      pendingCtimeMs = await collectFolderPendingCtimeMs(opts.folder)
    }
  }
  if (
    pendingCtimeMs !== undefined &&
    pendingCtimeMs.length > 0 &&
    shouldDeferModReloadAfterTurnBegin({
      turnStartedAt: activeDevModTurnStartedAt,
      isTurnRunning: leftoverDevModsTurn.isRunning(),
      pendingCtimeMs,
      nowMs: opts?.nowMs ?? Date.now(),
    })
  ) {
    return 'held'
  }
  try {
    const ctx = binding.toolContext(new AbortController())
    const { assessPluginReloadCacheImpact } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./activateAfterInstall.js') as typeof import('./activateAfterInstall.js')
    const impact = await assessPluginReloadCacheImpact({
      model: ctx.options.mainLoopModel,
      mcpClients: ctx.options.mcpClients,
    })
    if (impact.wouldInvalidateCache) {
      ctx.setAppState(prev =>
        prev.plugins.needsRefresh
          ? prev
          : {
              ...prev,
              plugins: { ...prev.plugins, needsRefresh: true },
            },
      )
      return 'held'
    }
    await binding.reloadPlugins()
    activeDevModLastReloadFailed = false
    activeDevModStampTracker.markReloaded(true)
    return 'reloaded'
  } catch (error) {
    activeDevModLastReloadFailed = true
    activeDevModStampTracker.markReloaded(false)
    const msg = errorMessage(error)
    leftoverUiLog(
      'dev-mods',
      formatDevModReloadFailure('dev-mods', error, true),
    )
    try {
      const { logForDebugging } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../debug.js') as typeof import('../debug.js')
      logForDebugging(`dev mods: reload failed: ${msg}`, {
        level: 'error',
      })
    } catch {
      // ignore
    }
    return 'failed'
  }
}

function leftoverJoinSessionPluginDir(folder: string): void {
  leftoverJoinPluginDir.get()?.joinPluginDir(folder)
}

function leftoverSaveDevModsFolder(folder: string): void {
  try {
    const { saveDevModsFolder } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../sessionStorage.js') as typeof import('../sessionStorage.js')
    const storageV5 = binding?.toolContext(new AbortController()).storageV5
    saveDevModsFolder(folder, storageV5)
  } catch {
    // persist optional until session file exists
  }
}

async function leftoverTouchFolder(folder: string): Promise<void> {
  const now = new Date()
  await utimes(folder, now, now).catch(error => {
    leftoverDebug(
      `dev mods: ${folder} keeps its old time: ${errorMessage(error)}`,
    )
  })
}

function leftoverPinTurnEndTouch(): void {
  if (leftoverDevModsTurnEndUtimes.get() !== undefined) return
  const offBegin = leftoverDevModsTurn.onBegin(() => {
    activeDevModTurnStartedAt = Date.now()
  })
  const offEnd = leftoverDevModsTurn.onEnd(() => {
    activeDevModTurnStartedAt = undefined
    try {
      for (const folder of [
        ...(leftoverEnabledDirs.get() ?? []),
        ...(leftoverPresentDirs.get() ?? []),
      ]) {
        void leftoverTouchFolder(folder)
      }
    } catch (error) {
      leftoverDebug(
        `dev mods: the turn-end refresh failed: ${errorMessage(error)}`,
      )
    }
  })
  leftoverDevModsTurnEndUtimes.set(() => {
    offBegin()
    offEnd()
  })
}

/** densable Wae — strip a leading `${name}: ` from the thrown message. */
function leftoverWae(name: string, error: unknown): string {
  const raw = errorMessage(error)
  const prefix = `${name}: `
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
}

function leftoverEnableFailed(
  folder: string,
  error: unknown,
  reason: 'enable_failed' | 'load_failed',
): DevModLoad {
  const name = basename(folder)
  leftoverUiLog(
    name,
    `reload failed, the previous version stays loaded: ${leftoverWae(name, error)}`,
  )
  leftoverDebug(
    `dev mods: ${reason === 'enable_failed' ? 'enabling' : 'loading'} ${folder} failed: ${errorMessage(error)}`,
  )
  try {
    const { logEvent } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
    logEvent('plugin_dev_mods', { reason: asMeta(reason) })
  } catch {
    // ignore
  }
  return 'failed'
}

/** densable j — person Enable / consented catch-up. `{enabled:!0}`, no D(). */
async function leftoverEnableDevMods(
  folder: string,
  isUnasked = false,
): Promise<DevModLoad> {
  try {
    leftoverDevModsStage.set({ stage: 'enabled', folder })
    leftoverJoinSessionPluginDir(folder)
    leftoverEnabledDirs.set(
      leftoverUniqueDirs(leftoverEnabledDirs.get() ?? [], [folder]),
    )
    leftoverPinTurnEndTouch()
    await leftoverTouchFolder(folder)
    await leftoverTick(0)
    if (resolve(folder) !== resolve(sessionDevModsFolder())) {
      leftoverPruneForeignSessionDevModsDirs(sessionDevModsFolder())
      return 'unbound'
    }
    if (!isUnasked) {
      leftoverSaveDevModsFolder(folder)
    }
    const outcome = await reloadDevMods({ folder })
    recordDevModLines(folder, outcome)
    try {
      const { logEvent } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
      logEvent('plugin_dev_mods', { enabled: true })
    } catch {
      // ignore
    }
    return outcome
  } catch (error) {
    return leftoverEnableFailed(folder, error, 'enable_failed')
  }
}

/** densable Co — nonempty present folder at start. `{loaded_at_start:!0}`, then M(). */
async function leftoverLoadDevModsAtStart(folder: string): Promise<void> {
  try {
    const children = listPluginDevModChildren(folder)
    if (children === undefined || children.length === 0) {
      const canWatch =
        children !== undefined &&
        (canAskPluginDevMods() || canAutoEnablePluginDevMods())
      leftoverDevModsStage.set(
        canWatch ? { stage: 'wanted', folder, loaded: children } : undefined,
      )
      await leftoverStartWatch()
      return
    }
    leftoverDevModsStage.set({ stage: 'wanted', folder, loaded: children })
    leftoverPresentDirs.set(
      leftoverUniqueDirs(leftoverPresentDirs.get() ?? [], [folder]),
    )
    leftoverJoinSessionPluginDir(folder)
    leftoverPinTurnEndTouch()
    await leftoverTouchFolder(folder)
    await leftoverTick(0)
    if (resolve(folder) !== resolve(sessionDevModsFolder())) {
      leftoverPruneForeignSessionDevModsDirs(sessionDevModsFolder())
      return
    }
    recordDevModLines(folder, await reloadDevMods({ folder }))
    try {
      const { logEvent } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
      logEvent('plugin_dev_mods', { loaded_at_start: true })
    } catch {
      // ignore
    }
    await leftoverStartWatch()
  } catch (error) {
    const current = leftoverDevModsStage.get()
    if (
      (current?.stage === 'wanted' || current?.stage === 'present') &&
      current.folder === folder
    ) {
      leftoverDevModsStage.set({ stage: 'wanted', folder })
      void leftoverStartWatch()
    }
    leftoverEnableFailed(folder, error, 'load_failed')
  }
}

function leftoverNoteKind(
  folder: string,
  kind:
    | {
        kind: 'enabled'
        load: DevModLoad
        isUnasked?: boolean
        keptOutCause?: string
      }
    | { kind: 'declined' }
    | { kind: 'unanswered' }
    | { kind: 'off'; reason: string },
): void {
  const where = folderMarkdown(folder)
  switch (kind.kind) {
    case 'enabled':
      notePluginDevMods(
        devModLoadSentence(where, kind.load, kind.isUnasked, kind.keptOutCause),
      )
      return
    case 'declined':
      notePluginDevMods(
        `The person declined mod hot-reloading: what this run wrote under ${where} is written but NOT loaded (a mod that loaded when the session started keeps running as it loaded). Do not say the change is running. It loads the next time this session starts (/reload-plugins reloads only a mod that loaded at the start); the person can ask again.`,
      )
      return
    case 'unanswered':
      notePluginDevMods(
        `The person has not answered the mod hot-reloading question yet; it is asked again once a turn ends. What this run wrote under ${where} is written but NOT loaded yet. Do not say it was declined, and do not suggest --plugin-dir or a restart.`,
      )
      return
    case 'off':
      leftoverOffNote(folder, kind.reason)
  }
}

/** densable yo — watch stopped → wanted / off. enabled is already set by j. */
function leftoverWatchStopped(
  folder: string,
  how: 'enabled' | 'refused' | 'no_one_to_ask' | 'no_pick',
): void {
  const current = leftoverDevModsStage.get()
  if (current?.stage !== 'watching' || current.folder !== folder) return
  switch (how) {
    case 'refused':
      leftoverDevModsStage.set({
        stage: 'wanted',
        folder,
        ...(current.loaded !== undefined ? { loaded: current.loaded } : {}),
      })
      return
    case 'no_one_to_ask':
    case 'no_pick':
      leftoverDevModsStage.set({ stage: 'off', folder })
      return
    case 'enabled':
      return
  }
}

function leftoverClock(): LeftoverWatchDeps['clock'] {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms, opts) => {
      const timer = setTimeout(fn, ms)
      if (opts?.unref) timer.unref?.()
      return () => clearTimeout(timer)
    },
  }
}

/** densable Ldr / YM — plugin `ee(0)` does not unref. Never export minify `YM`. */
function leftoverYmClock(): LeftoverWatchDeps['clock'] {
  return leftoverClock()
}

/** densable ee(t, abort, {clock, unref, throwOnAbort, abortError}). Never export minify `ee`. */
function leftoverTick(
  ms = 0,
  abort?: AbortSignal,
  opts?: {
    clock?: LeftoverWatchDeps['clock']
    unref?: boolean
    throwOnAbort?: boolean
    abortError?: () => Error
  },
): Promise<void> {
  return new Promise((resolveTick, rejectTick) => {
    const fail = () => rejectTick(opts?.abortError?.() ?? new Error('aborted'))
    if (abort?.aborted) {
      if (opts?.throwOnAbort || opts?.abortError) fail()
      else resolveTick()
      return
    }
    const clock = opts?.clock ?? leftoverYmClock()
    const cancel = clock.setTimeout(
      () => {
        abort?.removeEventListener('abort', onAbort)
        resolveTick()
      },
      ms,
      { unref: opts?.unref },
    )
    function onAbort(): void {
      cancel()
      if (opts?.throwOnAbort || opts?.abortError) fail()
      else resolveTick()
    }
    abort?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Official 2.1.323 #2040 (`Mfo`): determine whether a watch event on `filePath`
 * should trigger a mod hot reload. When the last reload failed (`failedReload`),
 * ignore the stale pre-failure `trackedFiles` filter (`trackedFiles = undefined`)
 * so a newly created code or manifest file under the mod directory triggers a reload.
 */
const MOD_CODE_OR_MANIFEST_RE =
  /(?:\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)|(?:^|[\\/])(?:plugin|hooks|settings)\.json)$/i

export function isRelevantModWatchFile(
  filePath: string,
  manifests: ReadonlySet<string>,
  trackedFiles: ReadonlySet<string> | undefined,
  failedReload = false,
): boolean {
  const effectiveTracked = failedReload ? undefined : trackedFiles
  const resolved = resolve(filePath)
  if (manifests.has(resolved)) return true
  if (effectiveTracked !== undefined) {
    return effectiveTracked.has(resolved)
  }
  return MOD_CODE_OR_MANIFEST_RE.test(resolved)
}

/**
 * #1751 (2.1.319) + #2040 (2.1.323): Event handlers for dev-mod watching.
 * - `onUnlink` clears the cached stamp in `tracker` and bumps the per-path
 *   sequence number so any in-flight `readStamp` from an earlier `add`/`change`
 *   cannot write back a stale stamp or suppress a subsequent re-creation.
 * - `onFileChange` checks sequence staleness and treats a transient missing
 *   file (`tracked === undefined`) by forgetting any cached stamp and firing
 *   `onChange`.
 * - When the last reload failed (`opts?.isReloadFailed?.() === true`), the
 *   watcher drops any stale tracked-file filter so a file created right after
 *   the failure always triggers a reload.
 */
export function createDevModWatchHandlers(
  tracker: ReturnType<typeof createDevModStampTracker>,
  onChange: () => void,
  readStamp: (
    filePath: string,
  ) => Promise<DevModTrackedStamp | undefined> = readDevModTrackedStamp,
  opts?: {
    manifests?: ReadonlySet<string>
    getTrackedFiles?: () => ReadonlySet<string> | undefined
    isReloadFailed?: () => boolean
  },
): {
  onFileChange: (filePath: string) => Promise<void>
  onUnlink: (filePath: string) => void
  onDirEvent: () => void
} {
  const seqByPath = new Map<string, number>()
  const bump = (filePath: string): number => {
    const next = (seqByPath.get(filePath) ?? 0) + 1
    seqByPath.set(filePath, next)
    return next
  }

  return {
    async onFileChange(filePath: string): Promise<void> {
      const failedReload = opts?.isReloadFailed?.() === true
      if (opts?.manifests !== undefined) {
        const trackedFiles = opts.getTrackedFiles?.()
        if (
          !isRelevantModWatchFile(
            filePath,
            opts.manifests,
            trackedFiles,
            failedReload,
          )
        ) {
          return
        }
      }
      const seq = bump(filePath)
      const tracked = await readStamp(filePath)
      // If an unlink or newer file event arrived while stat/readFile was in flight,
      // discard this stale result so it cannot poison the stamp tracker.
      if (seqByPath.get(filePath) !== seq) {
        return
      }
      if (tracked === undefined) {
        // File vanished between add/change and stat/readFile — forget stale stamp
        // and still trigger reload so deletion + return are never missed.
        tracker.forget(filePath)
        onChange()
        return
      }
      if (failedReload) {
        // #2040: after a failed reload, forget any stale stamp for this file
        // so newly created or restored files trigger a recovery reload.
        tracker.forget(filePath)
      }
      if (tracker.shouldReload(filePath, tracked)) {
        onChange()
      }
    },
    onUnlink(filePath: string): void {
      bump(filePath)
      tracker.forget(filePath)
      onChange()
    },
    onDirEvent(): void {
      onChange()
    },
  }
}

/** Official 2.1.323 #2040: tracks whether the most recent mod reload failed. */
let activeDevModLastReloadFailed = false

/** densable Ro — chokidar persistent, ignoreInitial, followSymlinks:!1, 400ms. */
function leftoverWatchRoot(
  folder: string,
  onChange: () => void,
): LeftoverWatchRoot {
  let logPath: string | undefined
  try {
    const { getProject } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../sessionStorage.js') as typeof import('../sessionStorage.js')
    logPath = getProject().sessionFile ?? undefined
  } catch {
    logPath = undefined
  }
  const watcher = chokidar.watch(folder, {
    persistent: true,
    ignoreInitial: true,
    followSymlinks: false,
    ignorePermissionErrors: true,
    ignored: leftoverModsWatchIgnored(folder, logPath),
    usePolling: true,
    interval: 400,
    binaryInterval: 400,
  })
  const handlers = createDevModWatchHandlers(
    activeDevModStampTracker,
    onChange,
    readDevModTrackedStamp,
    {
      isReloadFailed: () => activeDevModLastReloadFailed,
    },
  )
  const fireIfChanged = (filePath: string) => {
    void handlers.onFileChange(filePath)
  }
  watcher.on('add', fireIfChanged)
  watcher.on('addDir', handlers.onDirEvent)
  watcher.on('change', fireIfChanged)
  watcher.on('unlink', handlers.onUnlink)
  watcher.on('unlinkDir', handlers.onDirEvent)
  watcher.on('error', (error: unknown) => {
    leftoverDebug(
      `dev mods: the watch on ${folder}: ${errorMessage(error)}`,
      'warn',
    )
  })
  return { close: () => watcher.close() }
}

const MAX_UNPICKED = 3

/**
 * densable ho(folder, deps) — inject watchRoot/clock/turn. Never export minify `ho`.
 */
function leftoverWatchDevModsFolder(
  folder: string,
  deps: LeftoverWatchDeps,
): LeftoverModsWatch {
  const declined = new Set<string>()
  const loaded = new Set(deps.loaded)
  let dirty = false
  let deferEnable = false
  let declineDuringTurn = false
  let turnGen = 0
  let askedAt = Number.NEGATIVE_INFINITY
  let pending = false
  let unpickedCount = 0
  let askedByPersonTurn = false
  let lastWasUnpicked = false
  let unansweredSent = false
  let asking = false
  let closed = false
  let askAbort: AbortController | undefined
  let cancelTimer: (() => void) | undefined
  const watchRoot = deps.watchRoot(folder, () => {
    dirty = true
    schedule()
  })
  const offBegin = deps.turn.onBegin(() => {
    turnGen += 1
    askedByPersonTurn = deps.turn.isPersonTurn()
    // #1772: Roll back unpicked count when the user sends a real message turn
    // instead of answering the hot-reload prompt, preventing premature 3-turn shutoff.
    if (lastWasUnpicked && askedByPersonTurn) {
      unpickedCount = Math.max(0, unpickedCount - 1)
    }
    lastWasUnpicked = false
    // Upstream v2.1.304 (#1014): the prompt stays up when a new turn starts.
  })
  const offEnd = deps.turn.onEnd(() => {
    void runSafe(onTurnEnd)
  })

  function clearTimer(): void {
    cancelTimer?.()
    cancelTimer = undefined
  }

  function schedule(): void {
    if (closed || deferEnable) return
    clearTimer()
    if (deps.turn.isRunning()) {
      void runSafe(runAsk)
      return
    }
    cancelTimer = deps.clock.setTimeout(
      () => {
        void runSafe(runAsk)
      },
      deps.quietMs,
      { unref: true },
    )
  }

  async function runSafe(fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (error) {
      leftoverDebug(
        `dev mods: the watch on ${folder} failed: ${errorMessage(error)}`,
      )
    }
  }

  async function onTurnEnd(): Promise<void> {
    if (declineDuringTurn) {
      declineDuringTurn = false
      for (const name of (await deps.listChildren(folder)) ?? []) {
        declined.add(name)
      }
    }
    if (deferEnable) {
      if (deps.isYesStanding?.() ?? true) {
        await finishEnable()
        return
      }
      deferEnable = false
      askedAt = turnGen - 1
      await runAsk()
      return
    }
    if (pending) {
      pending = false
      await runAsk()
    }
  }

  async function finishEnable(): Promise<void> {
    if (closed) return
    if (deps.refusal()) {
      await dispose()
      deps.stopped('refused')
      return
    }
    await Promise.all([dispose(), deps.enable(folder)])
    deps.stopped('enabled')
  }

  async function runAsk(): Promise<void> {
    cancelTimer = undefined
    const firstDirty =
      deps.turn.isRunning() && dirty && askedAt === Number.NEGATIVE_INFINITY
    const closedOrDeferred = closed || deferEnable
    const runningNotFirst = deps.turn.isRunning() && !firstDirty
    if (closedOrDeferred || asking || runningNotFirst || askedAt === turnGen) {
      pending = !closedOrDeferred
      return
    }
    asking = true
    let retryNow = false
    try {
      const novel = firstDirty
        ? []
        : ((await deps.listChildren(folder)) ?? []).filter(
            name => !declined.has(name),
          )
      const should =
        firstDirty ||
        (novel.length > 0 && (dirty || novel.some(name => !loaded.has(name))))
      if (closed || !should) return
      if (deps.turn.isRunning() && !firstDirty) {
        pending = true
        return
      }
      if (deps.refusal()) {
        await dispose()
        deps.stopped('refused')
        return
      }
      askedAt = turnGen
      askedByPersonTurn = false
      lastWasUnpicked = false
      const abort = new AbortController()
      askAbort = abort
      const answer = await deps.ask(folder, abort.signal).finally(() => {
        askAbort = undefined
      })
      if (closed) return
      switch (answer) {
        case 'enable':
          if (deps.turn.isRunning() && !deps.refusal()) {
            deferEnable = true
            deps.deferred()
            return
          }
          await finishEnable()
          return
        case 'decline': {
          unansweredSent = false
          unpickedCount = 0
          declineDuringTurn = deps.turn.isRunning()
          const present = await deps.listChildren(folder)
          for (const name of [...novel, ...(present ?? [])]) {
            declined.add(name)
          }
          return
        }
        case 'withdrawn':
          deps.withdrawn()
          if (!unansweredSent) {
            unansweredSent = true
            deps.unanswered()
          }
          pending = true
          return
        case 'retry':
          pending = true
          return
        case 'closed':
        case 'unpicked':
          if (!unansweredSent) {
            unansweredSent = true
            deps.unanswered()
          }
          if (!askedByPersonTurn) {
            unpickedCount += 1
            lastWasUnpicked = answer === 'unpicked'
          }
          if (unpickedCount >= MAX_UNPICKED) {
            await dispose()
            deps.stopped('no_pick')
            return
          }
          if (answer === 'unpicked') {
            askedAt = deps.turn.isRunning() ? turnGen - 1 : turnGen
            pending = true
            return
          }
          askedAt = turnGen - 1
          retryNow = true
          break
        case 'no_one_to_ask':
          await dispose()
          deps.stopped('no_one_to_ask')
          return
      }
    } finally {
      asking = false
    }
    if (retryNow) await runAsk()
  }

  async function dispose(): Promise<void> {
    if (closed) return
    closed = true
    pending = false
    clearTimer()
    askAbort?.abort()
    offBegin()
    offEnd()
    await watchRoot.close()
  }

  schedule()
  return {
    declined: () => [...declined],
    isClosed: () => closed,
    dispose,
  }
}

export const createDevModsWatchForTesting = leftoverWatchDevModsFolder

const DEFERRED_ENABLE_LINE =
  "Mod hot-reloading is on; this session's mods load when this turn ends."
const WITHDRAWN_LINE =
  'Mod hot-reloading was not answered; it will be asked again once a turn ends.'

/** densable M — start ho only from wanted. */
async function leftoverStartWatch(): Promise<void> {
  try {
    const current = leftoverDevModsStage.get()
    if (current?.stage !== 'wanted') return
    // #1952: Respect CLAUDE_CODE_PLUGIN_DIR_WATCH=0 to disable mod hot-reload watching.
    if (isPluginDirWatchDisabledByEnv()) return
    // densable M: if(g()!==void 0)return — silent. S/dot is the watch refusal callback.
    if (leftoverPluginDevModsRefusalProbe() !== undefined) return
    if (!canAskPluginDevMods() && !canAutoEnablePluginDevMods()) {
      try {
        const { logEvent } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
        logEvent('plugin_dev_mods', { reason: asMeta('no_one_to_ask') })
      } catch {
        // ignore
      }
      leftoverDevModsStage.set({ stage: 'off', folder: current.folder })
      if (current.loaded === undefined)
        leftoverStopped(current.folder, 'no_one_to_ask')
      return
    }
    await mkdir(current.folder, { recursive: true })
    const afterMkdir = leftoverDevModsStage.get()
    if (afterMkdir?.stage !== 'wanted') return
    const { folder, loaded } = afterMkdir
    const hold: { release?: () => void } = {}
    let isUnasked = false
    const watch = leftoverWatchDevModsFolder(folder, {
      watchRoot: leftoverWatchRoot,
      loaded: loaded ?? [],
      listChildren: async root => listPluginDevModChildren(root),
      refusal: pluginDevModsRefusal,
      ask: async (root, signal) => {
        isUnasked =
          !(leftoverDeclinedFolders.get() ?? []).includes(root) &&
          canAutoEnablePluginDevMods()
        if (isUnasked) {
          try {
            const { logEvent } =
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
            logEvent('plugin_dev_mods', { answer: asMeta('unasked') })
          } catch {
            // ignore
          }
          leftoverUiLog(
            basename(root),
            'In this permission mode the mods Claude writes turn on without asking.',
          )
          return 'enable'
        }
        const answer = await askPluginDevMods(root, signal)
        if (answer !== 'no_one_to_ask' && answer !== 'retry') {
          leftoverNoOneOff.set(undefined)
        }
        if (answer === 'decline') {
          leftoverDeclinedFolders.set([
            ...(leftoverDeclinedFolders.get() ?? []),
            root,
          ])
          leftoverNoteKind(root, { kind: 'declined' })
        }
        return answer
      },
      enable: async root => {
        leftoverNoteKind(root, {
          kind: 'enabled',
          load: await leftoverEnableDevMods(root, isUnasked),
          isUnasked,
        })
      },
      isYesStanding: () => !isUnasked || canAutoEnablePluginDevMods(),
      deferred: () => leftoverUiLog(basename(folder), DEFERRED_ENABLE_LINE),
      withdrawn: () => leftoverUiLog(basename(folder), WITHDRAWN_LINE),
      unanswered: () => leftoverNoteKind(folder, { kind: 'unanswered' }),
      stopped: how => {
        hold.release?.()
        leftoverWatchStopped(folder, how)
        leftoverStopped(folder, how)
      },
      clock: leftoverClock(),
      turn: leftoverDevModsTurn,
      quietMs: QUIET_MS,
    })
    leftoverDevModsStage.set({
      stage: 'watching',
      folder,
      watch,
      ...(loaded !== undefined ? { loaded } : {}),
    })
    hold.release = registerCleanup(() => void watch.dispose())
  } catch (error) {
    leftoverDebug(`dev mods: the watch did not start: ${errorMessage(error)}`)
  }
}

/** densable Fo — mkdir + start watch, return folder. */
export async function ensurePluginDevModsFolder(): Promise<string> {
  const folder = sessionDevModsFolder()
  leftoverEnsureSessionSwitchIsolation()
  leftoverPruneForeignSessionDevModsDirs(folder)
  try {
    const current = leftoverDevModsStage.get()
    if (current?.stage === 'watching' && current.folder !== folder) {
      await current.watch.dispose()
    }
    const after = leftoverDevModsStage.get()
    const moved = after !== undefined && after.folder !== folder
    const closedOrMoved =
      after === undefined ||
      after.stage === 'off' ||
      (after.stage === 'watching' && after.watch.isClosed())
    if (moved || closedOrMoved) {
      leftoverDevModsStage.set({ stage: 'wanted', folder })
    }
    pinLeftoverDevModsCatchUp()
    const refusal = leftoverPluginDevModsRefusalProbe()
    if (refusal !== undefined) {
      leftoverPluginDevModsRefusalDot(refusal)
      leftoverDebug(`dev mods: mod hot-reloading is off here (${refusal})`)
    }
    const stageAfter = leftoverDevModsStage.get()?.stage
    if (refusal === undefined && stageAfter === 'consented') {
      leftoverCatchUp()
    } else if (refusal === undefined) {
      if (stageAfter === 'present') {
        leftoverDevModsStage.set({ stage: 'wanted', folder })
      }
      await leftoverStartWatch()
    } else if (refusal === 'dont_ask') {
      leftoverStopped(folder, 'no_one_to_ask')
    }
  } catch (error) {
    leftoverDebug(
      `dev mods: handing out ${folder} started nothing: ${errorMessage(error)}`,
    )
  }
  return folder
}

/** densable wfr */
export async function replaceDevModsPlaceholder(
  text: string,
  opts: { isPreload?: boolean },
): Promise<string> {
  if (!text.includes(DEV_MODS_PLACEHOLDER)) return text
  const folder = opts.isPreload
    ? sessionDevModsFolder()
    : await ensurePluginDevModsFolder()
  return text.replaceAll(DEV_MODS_PLACEHOLDER, folder)
}

/** densable k — catch-up after present / consented / wanted. */
function leftoverCatchUp(): void {
  try {
    const current = leftoverDevModsStage.get()
    switch (current?.stage) {
      case 'consented':
        if (pluginDevModsRefusal() === undefined) {
          void leftoverEnableDevMods(current.folder)
        }
        return
      case 'present':
        if (binding?.permissionMode?.() === 'dontAsk') {
          leftoverDevModsStage.set({ stage: 'wanted', folder: current.folder })
        } else if (pluginDevModsRefusal() === undefined) {
          void leftoverLoadDevModsAtStart(current.folder)
        }
        return
      case 'wanted':
        void leftoverStartWatch()
        return
      case 'enabled':
        void leftoverTouchFolder(current.folder)
        return
      default:
        return
    }
  } catch (error) {
    leftoverDebug(`dev mods: the catch-up failed: ${errorMessage(error)}`)
  }
}

/** densable Ho */
export function presentPluginDevModsFolder(): void {
  const folder = sessionDevModsFolder()
  leftoverEnsureSessionSwitchIsolation()
  leftoverPruneForeignSessionDevModsDirs(folder)
  const current = leftoverDevModsStage.get()
  if (
    current !== undefined &&
    current.folder === folder &&
    current.stage !== 'off'
  ) {
    return
  }
  if (current?.stage === 'watching') {
    void current.watch.dispose().catch(error => {
      leftoverDebug(`dev mods: the watch did not close: ${errorMessage(error)}`)
    })
  }
  leftoverDevModsStage.set({ stage: 'present', folder })
  pinLeftoverDevModsCatchUp()
  leftoverCatchUp()
}

function leftoverSessionFolderMatches(folder: string): boolean {
  const { getSessionId } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
  const sessionId = getSessionId()
  return (
    /^[A-Za-z0-9_-]+$/.test(sessionId) &&
    resolve(folder) === resolve(sessionDevModsFolder())
  )
}

/** densable bOn — pin expander; consented restore or Ho. */
export function restorePluginDevModsHost(): void {
  leftoverDevModsExpander.set(replaceDevModsPlaceholder)
  leftoverEnsureSessionSwitchIsolation()
  try {
    leftoverPruneForeignSessionDevModsDirs(sessionDevModsFolder())
    const { getCurrentSessionDevModsFolder } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../sessionStorage.js') as typeof import('../sessionStorage.js')
    const folder = getCurrentSessionDevModsFolder()
    const current = leftoverDevModsStage.get()
    if (
      !(
        folder !== undefined &&
        leftoverSessionFolderMatches(folder) &&
        !(current?.stage === 'enabled' && current.folder === folder)
      )
    ) {
      presentPluginDevModsFolder()
      return
    }
    if (current?.stage === 'watching') {
      void current.watch.dispose().catch(error => {
        leftoverDebug(
          `dev mods: the watch did not close: ${errorMessage(error)}`,
        )
      })
    }
    leftoverDevModsStage.set({ stage: 'consented', folder })
    pinLeftoverDevModsCatchUp()
    if (pluginDevModsRefusal() === undefined) {
      mkdirSync(folder, { recursive: true })
      leftoverCatchUp()
    }
  } catch (error) {
    leftoverDebug(`dev mods: the restore failed: ${errorMessage(error)}`)
  }
}
