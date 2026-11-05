/**
 * densable 2.1.289 plugin_dev_mods — J / go / W / wfr / Ho / bOn.
 *
 * Gold WKe source `mod_hot_reload`. Skill prompt placeholder
 * `${CLAUDE_DEV_MODS_DIR}` expands to this session's mods folder.
 */
import { mkdirSync, readdirSync, statSync } from 'fs'
import chokidar from 'chokidar'
import { mkdir, utimes } from 'fs/promises'
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
import type { ConfirmWithUserResult } from '../permissions/confirmWithUser.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { errorMessage, isENOENT } from '../errors.js'
import { createSignal } from '../signal.js'

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
  { value: 'allow' as const, label: 'Enable for this session' },
  { value: 'not_now' as const, label: 'Not now' },
]

type PluginDevModsAsk =
  | 'enable'
  | 'decline'
  | 'withdrawn'
  | 'retry'
  | 'no_one_to_ask'

export type PluginDevModsBinding = {
  canUseTool: CanUseToolFn
  toolContext: (abort: AbortController) => ToolUseContext
  reloadPlugins?: () => Promise<void>
}

type DevModLoad = 'reloaded' | 'held' | 'unbound' | 'failed'

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
  stopped: (how: 'enabled' | 'refused' | 'no_one_to_ask') => void
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

let binding: PluginDevModsBinding | undefined

type LeftoverTurnSlot = {
  turnId: number
  started: Promise<void>
  isPersonStarted: boolean
  cancelled: () => boolean
  cancel: () => void
}

/**
 * densable dRt / ZO / g_e — one current turn. Nested bind overwrites.
 * bind takes caller turnId (gold does not return id). release only if
 * turnId matches. Never export minify `dRt`/`ZO`/`g_e`/`Sss`/`yHr`/`adn`.
 */
function leftoverTurnSlot(): {
  bind: (opts: {
    turnId: number
    started?: Promise<void>
    startedBy: string
    abort: () => void
  }) => void
  release: (turnId: number) => boolean
  current: () => LeftoverTurnSlot | undefined
} {
  let current: LeftoverTurnSlot | undefined
  return {
    bind(opts) {
      let cancelled = false
      current = {
        turnId: opts.turnId,
        started: opts.started ?? Promise.resolve(),
        isPersonStarted: opts.startedBy === 'person',
        cancelled: () => cancelled,
        cancel: () => {
          if (cancelled) return
          cancelled = true
          opts.abort()
        },
      }
    },
    release(turnId) {
      if (current?.turnId !== turnId) return false
      current = undefined
      return true
    },
    current: () => current,
  }
}

const leftoverZO = leftoverTurnSlot()
const leftoverTurnBegin = createSignal()
const leftoverTurnEnd = createSignal()

const leftoverDevModsTurn = {
  isRunning(): boolean {
    return leftoverZO.current() !== undefined
  },
  isPersonTurn(): boolean {
    return leftoverZO.current()?.isPersonStarted === true
  },
  onBegin(fn: () => void): () => void {
    return leftoverTurnBegin.subscribe(fn)
  },
  onEnd(fn: () => void): () => void {
    return leftoverTurnEnd.subscribe(fn)
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
let leftoverBoundTurnId: number | undefined

export function markPluginDevModsTurnRunning(
  running: boolean,
  person = false,
): void {
  if (running) {
    leftoverTurnSeq += 1
    const seq = leftoverTurnSeq
    leftoverBoundTurnId = seq
    leftoverZO.bind({
      turnId: seq,
      started: Promise.resolve(),
      startedBy: person ? 'person' : 'system',
      abort: () => {},
    })
    leftoverTurnBegin.emit()
    return
  }
  // densable yHr(turnId) — release only the bound id, not whatever is current.
  const turnId = leftoverBoundTurnId
  leftoverBoundTurnId = undefined
  if (turnId !== undefined && leftoverZO.release(turnId)) leftoverTurnEnd.emit()
}

/** densable Sss / yHr — bind turnId, release only that id. */
export function trackPluginDevModsTurn(opts?: {
  person?: boolean
  abort?: () => void
}): Disposable {
  leftoverTurnSeq += 1
  const seq = leftoverTurnSeq
  const person = opts?.person === true
  leftoverZO.bind({
    turnId: seq,
    started: Promise.resolve(),
    startedBy: person ? 'person' : 'system',
    abort: opts?.abort ?? (() => {}),
  })
  leftoverTurnBegin.emit()
  return {
    [Symbol.dispose]() {
      if (leftoverZO.release(seq)) leftoverTurnEnd.emit()
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
      return result.reason === 'no_one_to_ask' ? 'no_one_to_ask' : 'retry'
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
      // densable D() agentId:Ve() mode:task-notification skipAttachments:!0
      // priority:next shouldQuery:!1 passive:!0. Ve analog is getSessionId().
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
  untrusted: 'the workspace is not trusted',
}

const NO_ONE_TO_ASK_OFF = 'nobody could be asked'

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

/** densable So / B — refused → To[g()]; no_one_to_ask → B. */
function leftoverStopped(
  folder: string,
  how: 'enabled' | 'refused' | 'no_one_to_ask',
): void {
  if (how === 'enabled') return
  if (how === 'no_one_to_ask') {
    if (leftoverNoOneOff.get() === folder) return
    leftoverNoOneOff.set(folder)
    leftoverOffNote(folder, NO_ONE_TO_ASK_OFF)
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

function shortQuestion(folder: string, when: 'now' | 'turn-end'): string {
  return `Enable hot reloading for this session?\n\nMods in ${folderMarkdown(folder)} load ${loadWhen(when)} and reload when their files change. They run with your permissions.`
}

function longQuestion(folder: string, when: 'now' | 'turn-end'): string {
  return [
    'Enable hot reloading for this session?',
    '',
    `Mods live in ${folderMarkdown(folder)}.`,
    'A mod is code Claude wrote; it runs with your permissions.',
    `Enable: they load ${loadWhen(when)} and reload when their files change.`,
    'Enable holds for this session, also after a restart.',
    'Not now: they stay unloaded until this session next starts.',
    '/plugin lists what loaded and turns it off.',
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
      refusal: 'untrusted',
      isRefused: () => {
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
  const mapped = mapAsk(
    await confirmWithUser({
      canUseTool: binding.canUseTool,
      toolUseContext: binding.toolContext(abort),
      source: ASK_SOURCE,
      header: 'Mods',
      question,
      choices: ASK_CHOICES,
      personOnly: true,
    }),
  )
  if (mapped !== 'explain') return mapped
  try {
    const { logEvent } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
    logEvent('plugin_dev_mods', { answer: asMeta('explain') })
  } catch {
    // ignore
  }
  return depth < EXPLAIN_MAX
    ? askPluginDevModsLoop(folder, abort, depth + 1)
    : 'decline'
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

function devModLoadSentence(where: string, outcome: DevModLoad): string {
  switch (outcome) {
    case 'held':
      return `The person enabled mod hot-reloading for this session, but the mods under ${where} wait for /reload-plugins (the load would rewrite the prompt cache): they are NOT loaded yet.`
    case 'unbound':
      return `The person enabled mod hot-reloading for this session, but the mods under ${where} did not load (this session cannot reload its plugins; only a restart loads them).`
    case 'failed':
      return `The person enabled mod hot-reloading for this session, but the mods under ${where} did not load (the load failed; the transcript says why, and /reload-plugins tries again).`
    case 'reloaded':
      return `The person enabled mod hot-reloading for this session and the mods under ${where} loaded: they load and reload by themselves as their files change; the transcript names any mod that failed.`
  }
}

function devModLine(outcome: DevModLoad, loaded: boolean): string | undefined {
  if (outcome === 'failed') return undefined
  if (outcome === 'held') {
    return "in this session's mods folder, on hold: /reload-plugins applies it"
  }
  if (outcome === 'unbound') {
    return "in this session's mods folder; restart to apply"
  }
  return loaded
    ? "loaded from this session's mods folder"
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

/** densable gqn / M9t — held when a reload would bust the prompt cache. */
async function reloadDevMods(): Promise<DevModLoad> {
  if (binding?.reloadPlugins === undefined) return 'unbound'
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
    return 'reloaded'
  } catch (error) {
    try {
      const { logForDebugging } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../debug.js') as typeof import('../debug.js')
      const { errorMessage } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../errors.js') as typeof import('../errors.js')
      logForDebugging(`dev mods: reload failed: ${errorMessage(error)}`, {
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
  leftoverDevModsTurnEndUtimes.set(
    leftoverDevModsTurn.onEnd(() => {
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
    }),
  )
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
async function leftoverEnableDevMods(folder: string): Promise<DevModLoad> {
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
    leftoverSaveDevModsFolder(folder)
    const outcome = await reloadDevMods()
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
      const canWatch = children !== undefined && canAskPluginDevMods()
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
    recordDevModLines(folder, await reloadDevMods())
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
    | { kind: 'enabled'; load: DevModLoad }
    | { kind: 'declined' }
    | { kind: 'unanswered' }
    | { kind: 'off'; reason: string },
): void {
  const where = folderMarkdown(folder)
  switch (kind.kind) {
    case 'enabled':
      notePluginDevMods(devModLoadSentence(where, kind.load))
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
  how: 'enabled' | 'refused' | 'no_one_to_ask',
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
  const fire = () => onChange()
  watcher.on('add', fire)
  watcher.on('addDir', fire)
  watcher.on('change', fire)
  watcher.on('unlink', fire)
  watcher.on('unlinkDir', fire)
  watcher.on('error', (error: unknown) => {
    leftoverDebug(
      `dev mods: the watch on ${folder}: ${errorMessage(error)}`,
      'warn',
    )
  })
  return { close: () => watcher.close() }
}

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
    if (
      !(
        askAbort !== undefined &&
        !askAbort.signal.aborted &&
        deps.turn.isPersonTurn()
      )
    ) {
      return
    }
    askAbort.abort()
    if (!unansweredSent) {
      unansweredSent = true
      deps.unanswered()
    }
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
      await finishEnable()
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
        case 'no_one_to_ask':
          await dispose()
          deps.stopped('no_one_to_ask')
          return
      }
    } finally {
      asking = false
    }
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

const DEFERRED_ENABLE_LINE =
  "Mod hot-reloading is on; this session's mods load when this turn ends."
const WITHDRAWN_LINE =
  'Mod hot-reloading was not answered; it will be asked again once a turn ends.'

/** densable M — start ho only from wanted. */
async function leftoverStartWatch(): Promise<void> {
  try {
    const current = leftoverDevModsStage.get()
    if (current?.stage !== 'wanted') return
    // densable M: if(g()!==void 0)return — silent. S/dot is the watch refusal callback.
    if (leftoverPluginDevModsRefusalProbe() !== undefined) return
    if (!canAskPluginDevMods()) {
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
    const watch = leftoverWatchDevModsFolder(folder, {
      watchRoot: leftoverWatchRoot,
      loaded: loaded ?? [],
      listChildren: async root => listPluginDevModChildren(root),
      refusal: pluginDevModsRefusal,
      ask: async (root, signal) => {
        const answer = await askPluginDevMods(root, signal)
        if (answer !== 'no_one_to_ask' && answer !== 'retry') {
          leftoverNoOneOff.set(undefined)
        }
        if (answer === 'decline') leftoverNoteKind(root, { kind: 'declined' })
        return answer
      },
      enable: async root => {
        leftoverNoteKind(root, {
          kind: 'enabled',
          load: await leftoverEnableDevMods(root),
        })
      },
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
    await leftoverStartWatch()
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
        if (pluginDevModsRefusal() === undefined) {
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
