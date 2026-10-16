/**
 * densable 2.1.289 plugin_dev_mods — J / go / W / wfr / Ho / bOn.
 *
 * Gold WKe source `mod_hot_reload`. Skill prompt placeholder
 * `${CLAUDE_DEV_MODS_DIR}` expands to this session's mods folder.
 */
import { mkdirSync, readdirSync, statSync, watch, type FSWatcher } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
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
let watcher: FSWatcher | undefined
let queryTurnRunning = false
let restoredFolder: string | undefined

export function bindPluginDevModsSession(
  next: PluginDevModsBinding | undefined,
): void {
  binding = next
}

export function markPluginDevModsTurnRunning(running: boolean): void {
  queryTurnRunning = running
}

export function sessionDevModsFolder(): string {
  const { getClaudeConfigHomeDir } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../envUtils.js') as typeof import('../envUtils.js')
  const { getSessionId } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
  return join(getClaudeConfigHomeDir(), getSessionId())
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
  return `this session's folder (${folder})`
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

async function enablePluginDevMods(folder: string): Promise<void> {
  const { getInlinePlugins, setInlinePlugins } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
  const current = getInlinePlugins()
  if (!current.includes(folder)) {
    setInlinePlugins([...current, folder])
  }
  restoredFolder = folder
  stage = { stage: 'enabled', folder }
  await binding?.reloadPlugins?.()
  try {
    const { logEvent } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
    logEvent('plugin_dev_mods', { enabled: true })
  } catch {
    // ignore
  }
}

function stopWatch(): void {
  watcher?.close()
  watcher = undefined
}

async function startWatch(folder: string): Promise<void> {
  if (pluginDevModsRefusal() !== undefined) return
  if (!canAskPluginDevMods()) {
    stage = { stage: 'off', folder }
    return
  }
  await mkdir(folder, { recursive: true })
  stopWatch()
  let asking = false
  const onChange = () => {
    if (asking || stage?.stage === 'enabled' || stage?.stage === 'off') {
      return
    }
    const children = listPluginDevModChildren(folder) ?? []
    if (children.length === 0) return
    asking = true
    void askPluginDevMods(folder)
      .then(async answer => {
        if (answer === 'enable') {
          stopWatch()
          await enablePluginDevMods(folder)
        } else if (answer === 'decline' || answer === 'no_one_to_ask') {
          stopWatch()
          stage = { stage: 'off', folder }
        }
      })
      .finally(() => {
        asking = false
      })
  }
  try {
    watcher = watch(folder, { persistent: true }, onChange)
  } catch {
    // watch optional
  }
  stage = { stage: 'watching', folder }
  onChange()
}

/** densable Fo — mkdir + start watch, return folder. */
export async function ensurePluginDevModsFolder(): Promise<string> {
  const folder = sessionDevModsFolder()
  if (stage?.stage === 'watching' && stage.folder !== folder) {
    stopWatch()
  }
  const closedOrMoved =
    stage === undefined ||
    stage.stage === 'off' ||
    (stage.stage === 'watching' && watcher === undefined)
  if (stage?.folder !== folder || closedOrMoved) {
    stage = { stage: 'wanted', folder }
  }
  if (pluginDevModsRefusal() === undefined) {
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
  if (pluginDevModsRefusal() === undefined) {
    const children = listPluginDevModChildren(folder)
    if (children && children.length > 0) {
      mkdirSync(folder, { recursive: true })
      void startWatch(folder)
    }
  }
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
