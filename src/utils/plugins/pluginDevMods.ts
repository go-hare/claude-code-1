/**
 * densable 2.1.289 plugin_dev_mods — J / go / W / wfr / Ho / bOn.
 *
 * Gold WKe source `mod_hot_reload`. Skill prompt placeholder
 * `${CLAUDE_DEV_MODS_DIR}` expands to this session's mods folder.
 */
import { mkdirSync, readdirSync, statSync, watch, type FSWatcher } from 'fs'
import { mkdir, utimes } from 'fs/promises'
import { basename, join, sep } from 'path'
import { pathToFileURL } from 'url'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../../Tool.js'
import type { ConfirmWithUserResult } from '../permissions/confirmWithUser.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'

function asMeta(
  value: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

export const DEV_MODS_PLACEHOLDER = '${CLAUDE_DEV_MODS_DIR}'
const ASK_SOURCE = 'mod_hot_reload'
const EXPLAIN_MAX = 3
const PLUGIN_MANIFEST = join('.claude-plugin', 'plugin.json')

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

type Stage = {
  stage: 'wanted' | 'present' | 'watching' | 'enabled' | 'off'
  folder: string
}

let binding: PluginDevModsBinding | undefined
let stage: Stage | undefined
let queryTurnRunning = false
let queryTurnDepth = 0
let restoredFolder: string | undefined

/** densable ho — one live mods-folder watch. */
const QUIET_MS = 2000
type DevModLoad = 'reloaded' | 'held' | 'unbound' | 'failed'
type WatchCtrl = {
  folder: string
  watcher?: FSWatcher
  /** densable ho `r` — names declined this watch; new children re-ask. */
  declined: Set<string>
  /** densable ho `s` — names already loaded when the watch started. */
  loaded: Set<string>
  /** densable ho `n` — a filesystem event has fired. */
  dirty: boolean
  /** densable ho `a` — Enable during a turn; load at turn end. */
  deferEnable: boolean
  /** densable ho `i` — decline during a turn; latch children at turn end. */
  declineDuringTurn: boolean
  /** densable ho `f` — increments on each turn begin. */
  turnGen: number
  /** densable ho `L` — turnGen of the latched ask, or -Infinity. */
  askedAt: number
  /** densable ho `T` — run Q again when the turn ends. */
  pending: boolean
  /** densable ho `E` — unanswered note already sent. */
  unansweredSent: boolean
  /** densable ho `V` */
  asking: boolean
  /** densable ho `v` */
  closed: boolean
  timer?: ReturnType<typeof setTimeout>
  askAbort?: AbortController
}
let watchCtrl: WatchCtrl | undefined

export function bindPluginDevModsSession(
  next: PluginDevModsBinding | undefined,
): void {
  binding = next
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

export function markPluginDevModsTurnRunning(
  running: boolean,
  person = false,
): void {
  if (running) {
    queryTurnDepth += 1
    queryTurnRunning = true
    onDevModsTurnBegin(person)
    return
  }
  queryTurnDepth = Math.max(0, queryTurnDepth - 1)
  queryTurnRunning = queryTurnDepth > 0
  if (!queryTurnRunning) void onDevModsTurnEnd()
}

/** Dispose when the queryLoop generator closes, including nested loops. */
export function trackPluginDevModsTurn(opts?: {
  person?: boolean
}): Disposable {
  markPluginDevModsTurnRunning(true, opts?.person === true)
  return {
    [Symbol.dispose]() {
      markPluginDevModsTurnRunning(false)
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
    enqueuePendingNotification({
      value: text,
      mode: 'task-notification',
      skipAttachments: true,
      priority: 'next',
    })
  } catch {
    // ignore
  }
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

export function pluginDevModsRefusal(): string | undefined {
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
  const hit = rows.find(row => row.isRefused())
  if (hit) {
    try {
      const { logEvent } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
      logEvent('plugin_dev_mods', { reason: asMeta(hit.refusal) })
    } catch {
      // ignore
    }
  }
  return hit?.refusal
}

/** densable W — someone can answer, or binding is not ready yet. */
export function canAskPluginDevMods(): boolean {
  if (binding === undefined) return true
  try {
    const { canConfirmWithUser } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../permissions/confirmWithUser.js') as typeof import('../permissions/confirmWithUser.js')
    return canConfirmWithUser(binding.toolContext(new AbortController()))
  } catch {
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
  const when = queryTurnRunning ? 'turn-end' : 'now'
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
  } catch {
    return undefined
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

async function enablePluginDevMods(
  folder: string,
  opts?: { loadedAtStart?: boolean },
): Promise<DevModLoad> {
  const { getInlinePlugins, setInlinePlugins } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
  const current = getInlinePlugins()
  if (!current.includes(folder)) {
    setInlinePlugins([...current, folder])
  }
  restoredFolder = folder
  stage = { stage: 'enabled', folder }
  await utimes(folder, new Date(), new Date()).catch(() => undefined)
  const outcome = await reloadDevMods()
  recordDevModLines(folder, outcome)
  const where = folderMarkdown(folder)
  // densable Co — loaded_at_start is ui.log only. A person's Enable also
  // enqueues one task-notification whose sentence follows the outcome.
  if (opts?.loadedAtStart !== true) {
    notePluginDevMods(devModLoadSentence(where, outcome))
  }
  try {
    const { logEvent } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
    logEvent('plugin_dev_mods', {
      ...(opts?.loadedAtStart ? { loaded_at_start: true } : { enabled: true }),
    })
  } catch {
    // ignore
  }
  return outcome
}

function stopWatch(): void {
  const ctrl = watchCtrl
  watchCtrl = undefined
  if (ctrl === undefined) return
  ctrl.closed = true
  if (ctrl.timer !== undefined) clearTimeout(ctrl.timer)
  ctrl.askAbort?.abort()
  ctrl.watcher?.close()
}

function clearWatchTimer(ctrl: WatchCtrl): void {
  if (ctrl.timer === undefined) return
  clearTimeout(ctrl.timer)
  ctrl.timer = undefined
}

function noteUnanswered(folder: string): void {
  const where = folderMarkdown(folder)
  notePluginDevMods(
    `The person has not answered the mod hot-reloading question yet; it is asked again once a turn ends. What this run wrote under ${where} is written but NOT loaded yet. Do not say it was declined, and do not suggest --plugin-dir or a restart.`,
  )
}

function onDevModsTurnBegin(person: boolean): void {
  // densable mpr — f increments on a person turn only. A nested query
  // must not open the "already asked this turn" latch.
  if (!person) return
  const ctrl = watchCtrl
  if (ctrl === undefined || ctrl.closed) return
  ctrl.turnGen += 1
  const ask = ctrl.askAbort
  if (ask === undefined || ask.signal.aborted) return
  ask.abort()
  if (ctrl.unansweredSent) return
  ctrl.unansweredSent = true
  noteUnanswered(ctrl.folder)
}

async function onDevModsTurnEnd(): Promise<void> {
  const ctrl = watchCtrl
  if (ctrl === undefined || ctrl.closed) return
  if (ctrl.declineDuringTurn) {
    ctrl.declineDuringTurn = false
    for (const name of listPluginDevModChildren(ctrl.folder) ?? []) {
      ctrl.declined.add(name)
    }
  }
  if (ctrl.deferEnable) {
    ctrl.deferEnable = false
    await finishEnable(ctrl)
    return
  }
  if (!ctrl.pending) return
  ctrl.pending = false
  await runAsk(ctrl)
}

function scheduleAsk(ctrl: WatchCtrl): void {
  if (ctrl.closed || ctrl.deferEnable) return
  clearWatchTimer(ctrl)
  if (queryTurnRunning) {
    void runAsk(ctrl)
    return
  }
  ctrl.timer = setTimeout(() => {
    void runAsk(ctrl)
  }, QUIET_MS)
}

async function finishEnable(ctrl: WatchCtrl): Promise<void> {
  if (ctrl.closed) return
  if (pluginDevModsRefusal() !== undefined) {
    stopWatch()
    stage = { stage: 'wanted', folder: ctrl.folder }
    return
  }
  const folder = ctrl.folder
  stopWatch()
  await enablePluginDevMods(folder)
}

async function runAsk(ctrl: WatchCtrl): Promise<void> {
  if (ctrl !== watchCtrl || ctrl.closed) return
  clearWatchTimer(ctrl)
  const firstDirty =
    queryTurnRunning && ctrl.dirty && ctrl.askedAt === Number.NEGATIVE_INFINITY
  const closedOrDeferred = ctrl.closed || ctrl.deferEnable
  const runningNotFirst = queryTurnRunning && !firstDirty
  if (
    closedOrDeferred ||
    ctrl.asking ||
    runningNotFirst ||
    ctrl.askedAt === ctrl.turnGen
  ) {
    ctrl.pending = !closedOrDeferred
    return
  }
  ctrl.asking = true
  try {
    const children = listPluginDevModChildren(ctrl.folder) ?? []
    const novel = firstDirty
      ? []
      : children.filter(name => !ctrl.declined.has(name))
    const should =
      firstDirty ||
      (novel.length > 0 &&
        (ctrl.dirty || novel.some(name => !ctrl.loaded.has(name))))
    if (ctrl.closed || !should) return
    if (queryTurnRunning && !firstDirty) {
      ctrl.pending = true
      return
    }
    if (pluginDevModsRefusal() !== undefined) {
      stopWatch()
      stage = { stage: 'wanted', folder: ctrl.folder }
      return
    }
    ctrl.askedAt = ctrl.turnGen
    const abort = new AbortController()
    ctrl.askAbort = abort
    const answer = await askPluginDevMods(ctrl.folder, abort.signal).finally(
      () => {
        if (ctrl.askAbort === abort) ctrl.askAbort = undefined
      },
    )
    if (ctrl.closed) return
    switch (answer) {
      case 'enable':
        if (queryTurnRunning && pluginDevModsRefusal() === undefined) {
          ctrl.deferEnable = true
          const { recordPluginUiLog } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('./pluginUiLog.js') as typeof import('./pluginUiLog.js')
          recordPluginUiLog(
            basename(ctrl.folder),
            "Mod hot-reloading is on; this session's mods load when this turn ends.",
          )
          return
        }
        await finishEnable(ctrl)
        return
      case 'decline': {
        ctrl.unansweredSent = false
        ctrl.declineDuringTurn = queryTurnRunning
        for (const name of [
          ...novel,
          ...(listPluginDevModChildren(ctrl.folder) ?? []),
        ]) {
          ctrl.declined.add(name)
        }
        try {
          const { getInlinePlugins, setInlinePlugins } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
          const folder = ctrl.folder
          const prefix = folder.endsWith(sep) ? folder : `${folder}${sep}`
          setInlinePlugins(
            getInlinePlugins().filter(
              path => path !== folder && !path.startsWith(prefix),
            ),
          )
        } catch {
          // ignore
        }
        stage = { stage: 'watching', folder: ctrl.folder }
        notePluginDevMods(
          `The person declined mod hot-reloading: what this run wrote under ${folderMarkdown(ctrl.folder)} is written but NOT loaded (a mod that loaded when the session started keeps running as it loaded). Do not say the change is running. It loads the next time this session starts (/reload-plugins reloads only a mod that loaded at the start); the person can ask again.`,
        )
        return
      }
      case 'withdrawn': {
        const { recordPluginUiLog } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('./pluginUiLog.js') as typeof import('./pluginUiLog.js')
        recordPluginUiLog(
          basename(ctrl.folder),
          'Mod hot-reloading was not answered; it will be asked again once a turn ends.',
        )
        if (!ctrl.unansweredSent) {
          ctrl.unansweredSent = true
          noteUnanswered(ctrl.folder)
        }
        ctrl.askedAt = Number.NEGATIVE_INFINITY
        ctrl.pending = true
        return
      }
      case 'retry':
        ctrl.askedAt = Number.NEGATIVE_INFINITY
        ctrl.pending = true
        return
      case 'no_one_to_ask':
        stopWatch()
        stage = { stage: 'off', folder: ctrl.folder }
        return
    }
  } finally {
    ctrl.asking = false
  }
}

async function startWatch(folder: string): Promise<void> {
  if (pluginDevModsRefusal() !== undefined) return
  if (!canAskPluginDevMods()) {
    stage = { stage: 'off', folder }
    return
  }
  await mkdir(folder, { recursive: true })
  stopWatch()
  const ctrl: WatchCtrl = {
    folder,
    declined: new Set(),
    loaded: new Set(),
    dirty: false,
    deferEnable: false,
    declineDuringTurn: false,
    turnGen: 0,
    askedAt: Number.NEGATIVE_INFINITY,
    pending: false,
    unansweredSent: false,
    asking: false,
    closed: false,
  }
  watchCtrl = ctrl
  const onChange = () => {
    if (ctrl.closed || ctrl !== watchCtrl) return
    ctrl.dirty = true
    scheduleAsk(ctrl)
  }
  try {
    ctrl.watcher = watch(folder, { persistent: true }, onChange)
  } catch {
    // watch optional
  }
  stage = { stage: 'watching', folder }
  scheduleAsk(ctrl)
}

/** densable Fo — mkdir + start watch, return folder. */
export async function ensurePluginDevModsFolder(): Promise<string> {
  const folder = sessionDevModsFolder()
  if (stage?.stage === 'enabled' && stage.folder === folder) {
    return folder
  }
  if (stage?.stage === 'watching' && stage.folder !== folder) {
    stopWatch()
  }
  const closedOrMoved =
    stage === undefined ||
    stage.stage === 'off' ||
    (stage.stage === 'watching' && watchCtrl?.watcher === undefined)
  if (stage?.folder !== folder || closedOrMoved) {
    stage = { stage: 'wanted', folder }
  }
  if (pluginDevModsRefusal() === undefined && stage?.stage !== 'enabled') {
    await startWatch(folder)
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

/** densable Ho */
export function presentPluginDevModsFolder(): void {
  const folder = sessionDevModsFolder()
  if (stage !== undefined && stage.folder === folder && stage.stage !== 'off') {
    return
  }
  stopWatch()
  stage = { stage: 'present', folder }
  if (pluginDevModsRefusal() !== undefined) return
  const children = listPluginDevModChildren(folder)
  if (children && children.length > 0) {
    mkdirSync(folder, { recursive: true })
    void enablePluginDevMods(folder, { loadedAtStart: true })
    return
  }
  void startWatch(folder)
}

/** densable bOn — install expander + present or restore enabled folder. */
export function restorePluginDevModsHost(): void {
  try {
    const folder = restoredFolder
    if (
      folder !== undefined &&
      folder === sessionDevModsFolder() &&
      stage?.stage === 'enabled' &&
      stage.folder === folder
    ) {
      return
    }
    presentPluginDevModsFolder()
  } catch (error) {
    try {
      const { logForDebugging } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../debug.js') as typeof import('../debug.js')
      const { errorMessage } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../errors.js') as typeof import('../errors.js')
      logForDebugging(`dev mods: ${errorMessage(error)}`, { level: 'error' })
    } catch {
      // ignore
    }
  }
}
