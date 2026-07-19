import type { ArgumentCompletion } from '../../types/command.js'
import {
  type GlobalConfig,
  getGlobalConfig,
  saveGlobalConfig,
} from '../../utils/config.js'
import { PERMISSION_MODES } from '../../utils/permissions/PermissionMode.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import type { ThemeSetting } from '../../utils/theme.js'

/**
 * densable eKr / bdy / aor / tKr (2.1.211) — /config key=value typeahead + apply.
 *
 * densable builds keys from the live Settings panel (onChange handlers). Fork
 * uses a static catalog of the common settable ids with direct writers so
 * completions and apply work without mounting React.
 */

export type ConfigKeyValue = { key: string; raw: string }

export type ApplyConfigResult = { ok: boolean; message: string }

type SettableKey = {
  id: string
  label: string
  options?: string[]
  hint?: string
  /** When false, typeahead still shows key= but apply tells user to open panel. */
  applyable?: boolean
  write?: (value: string) => ApplyConfigResult | Promise<ApplyConfigResult>
}

const BOOLEAN = ['true', 'false'] as const

const HELP_TOKENS = new Set(['help', '-h', '--help'])
const LIST_TOKENS = new Set([
  'list',
  'show',
  'display',
  'current',
  'view',
  'get',
  'check',
  'describe',
  'print',
  'version',
  'about',
  'status',
  '?',
])

function parseBoolean(
  raw: string,
): { ok: true; value: boolean } | { ok: false } {
  const t = raw.toLowerCase()
  if (['true', '1', 'on', 'yes'].includes(t)) return { ok: true, value: true }
  if (['false', '0', 'off', 'no'].includes(t)) return { ok: true, value: false }
  return { ok: false }
}

function writeGlobalBoolean(
  key: keyof GlobalConfig,
  label: string,
  raw: string,
): ApplyConfigResult {
  const parsed = parseBoolean(raw)
  if (!parsed.ok) {
    return {
      ok: false,
      message: `${label} takes true or false, not "${raw}".`,
    }
  }
  saveGlobalConfig(current => ({ ...current, [key]: parsed.value }))
  return {
    ok: true,
    message: `Set ${label} to ${parsed.value ? 'true' : 'false'}`,
  }
}

function writeLocalSettingsBoolean(
  key: string,
  label: string,
  raw: string,
): ApplyConfigResult {
  const parsed = parseBoolean(raw)
  if (!parsed.ok) {
    return {
      ok: false,
      message: `${label} takes true or false, not "${raw}".`,
    }
  }
  const result = updateSettingsForSource('localSettings', {
    [key]: parsed.value,
  })
  if (result.error) {
    return {
      ok: false,
      message: `Couldn't save ${label}: ${result.error.message}`,
    }
  }
  return {
    ok: true,
    message: `Set ${label} to ${parsed.value ? 'true' : 'false'}`,
  }
}

function writeUserSettingsBoolean(
  key: string,
  label: string,
  raw: string,
): ApplyConfigResult {
  const parsed = parseBoolean(raw)
  if (!parsed.ok) {
    return {
      ok: false,
      message: `${label} takes true or false, not "${raw}".`,
    }
  }
  const result = updateSettingsForSource('userSettings', {
    [key]: parsed.value,
  })
  if (result.error) {
    return {
      ok: false,
      message: `Couldn't save ${label}: ${result.error.message}`,
    }
  }
  return {
    ok: true,
    message: `Set ${label} to ${parsed.value ? 'true' : 'false'}`,
  }
}

function writeEnumValue(
  options: string[],
  label: string,
  raw: string,
  apply: (matched: string) => ApplyConfigResult,
): ApplyConfigResult {
  const matched = options.find(o => o.toLowerCase() === raw.toLowerCase())
  if (!matched) {
    return {
      ok: false,
      message: `${label} takes one of: ${options.join(', ')}.`,
    }
  }
  return apply(matched)
}

const THEME_OPTIONS = [
  'dark',
  'light',
  'dark-daltonized',
  'light-daltonized',
  'dark-ansi',
  'light-ansi',
] as const

const SETTABLE_KEYS: SettableKey[] = [
  {
    id: 'autoCompactEnabled',
    label: 'Auto-compact',
    options: [...BOOLEAN],
    write: raw => writeGlobalBoolean('autoCompactEnabled', 'Auto-compact', raw),
  },
  {
    id: 'spinnerTipsEnabled',
    label: 'Show tips',
    options: [...BOOLEAN],
    write: raw =>
      writeLocalSettingsBoolean('spinnerTipsEnabled', 'Show tips', raw),
  },
  {
    id: 'cacheWarningEnabled',
    label: 'Cache warnings',
    options: [...BOOLEAN],
    write: raw =>
      writeLocalSettingsBoolean('cacheWarningEnabled', 'Cache warnings', raw),
  },
  {
    id: 'prefersReducedMotion',
    label: 'Reduce motion',
    options: [...BOOLEAN],
    write: raw =>
      writeLocalSettingsBoolean('prefersReducedMotion', 'Reduce motion', raw),
  },
  {
    id: 'thinkingEnabled',
    label: 'Thinking mode',
    options: [...BOOLEAN],
    write: raw => {
      const parsed = parseBoolean(raw)
      if (!parsed.ok) {
        return {
          ok: false,
          message: `Thinking mode takes true or false, not "${raw}".`,
        }
      }
      // densable Config.tsx: alwaysThinkingEnabled false when off; undefined when on
      const result = updateSettingsForSource('userSettings', {
        alwaysThinkingEnabled: parsed.value ? undefined : false,
      })
      if (result.error) {
        return {
          ok: false,
          message: `Couldn't save Thinking mode: ${result.error.message}`,
        }
      }
      return {
        ok: true,
        message: `Set Thinking mode to ${parsed.value ? 'true' : 'false'} (reopen session for full effect)`,
      }
    },
  },
  {
    id: 'fastMode',
    label: 'Fast mode',
    options: [...BOOLEAN],
    write: raw => writeUserSettingsBoolean('fastMode', 'Fast mode', raw),
  },
  {
    id: 'promptSuggestionEnabled',
    label: 'Prompt suggestions',
    options: [...BOOLEAN],
    write: raw =>
      writeUserSettingsBoolean(
        'promptSuggestionEnabled',
        'Prompt suggestions',
        raw,
      ),
  },
  {
    id: 'poorMode',
    label: 'Budget mode',
    options: [...BOOLEAN],
    write: raw => writeUserSettingsBoolean('poorMode', 'Budget mode', raw),
  },
  {
    id: 'speculationEnabled',
    label: 'Speculation',
    options: [...BOOLEAN],
    write: raw =>
      writeGlobalBoolean(
        'speculationEnabled' as keyof GlobalConfig,
        'Speculation',
        raw,
      ),
  },
  {
    id: 'fileCheckpointingEnabled',
    label: 'File checkpointing',
    options: [...BOOLEAN],
    write: raw =>
      writeGlobalBoolean(
        'fileCheckpointingEnabled' as keyof GlobalConfig,
        'File checkpointing',
        raw,
      ),
  },
  {
    id: 'verbose',
    label: 'Verbose',
    options: [...BOOLEAN],
    write: raw => writeGlobalBoolean('verbose', 'Verbose', raw),
  },
  {
    id: 'terminalProgressBarEnabled',
    label: 'Terminal progress bar',
    options: [...BOOLEAN],
    write: raw =>
      writeGlobalBoolean(
        'terminalProgressBarEnabled',
        'Terminal progress bar',
        raw,
      ),
  },
  {
    id: 'showStatusInTerminalTab',
    label: 'Status in terminal tab',
    options: [...BOOLEAN],
    write: raw =>
      writeGlobalBoolean(
        'showStatusInTerminalTab' as keyof GlobalConfig,
        'Status in terminal tab',
        raw,
      ),
  },
  {
    id: 'showTurnDuration',
    label: 'Show turn duration',
    options: [...BOOLEAN],
    write: raw =>
      writeGlobalBoolean('showTurnDuration', 'Show turn duration', raw),
  },
  {
    id: 'showMessageTimestamps',
    label: 'Show message timestamps',
    options: [...BOOLEAN],
    write: raw =>
      writeGlobalBoolean(
        'showMessageTimestamps',
        'Show message timestamps',
        raw,
      ),
  },
  {
    id: 'defaultPermissionMode',
    label: 'Default permission mode',
    options: [...PERMISSION_MODES],
    write: raw =>
      writeEnumValue(
        [...PERMISSION_MODES],
        'Default permission mode',
        raw,
        matched => {
          const settings = getInitialSettings()
          const result = updateSettingsForSource('userSettings', {
            permissions: {
              ...settings?.permissions,
              defaultMode: matched as (typeof PERMISSION_MODES)[number],
            },
          })
          if (result.error) {
            return {
              ok: false,
              message: `Couldn't save Default permission mode: ${result.error.message}`,
            }
          }
          return {
            ok: true,
            message: `Set Default permission mode to ${matched}`,
          }
        },
      ),
  },
  {
    id: 'useAutoModeDuringPlan',
    label: 'Use auto mode during plan',
    options: [...BOOLEAN],
    write: raw =>
      writeUserSettingsBoolean(
        'useAutoModeDuringPlan',
        'Use auto mode during plan',
        raw,
      ),
  },
  {
    id: 'respectGitignore',
    label: 'Respect .gitignore',
    options: [...BOOLEAN],
    write: raw =>
      writeGlobalBoolean('respectGitignore', 'Respect .gitignore', raw),
  },
  {
    id: 'copyFullResponse',
    label: 'Always copy full response',
    options: [...BOOLEAN],
    write: raw =>
      writeGlobalBoolean('copyFullResponse', 'Always copy full response', raw),
  },
  {
    id: 'copyOnSelect',
    label: 'Copy on select',
    options: [...BOOLEAN],
    write: raw => writeGlobalBoolean('copyOnSelect', 'Copy on select', raw),
  },
  {
    id: 'wheelScrollAccelerationEnabled',
    label: 'Wheel scroll acceleration',
    options: [...BOOLEAN],
    write: raw =>
      writeUserSettingsBoolean(
        'wheelScrollAccelerationEnabled',
        'Wheel scroll acceleration',
        raw,
      ),
  },
  {
    id: 'autoUpdatesChannel',
    label: 'Auto-update channel',
    options: ['latest', 'stable'],
    write: raw =>
      writeEnumValue(
        ['latest', 'stable'],
        'Auto-update channel',
        raw,
        matched => {
          const channel = matched as 'latest' | 'stable'
          const result = updateSettingsForSource('userSettings', {
            autoUpdatesChannel: channel,
          })
          if (result.error) {
            return {
              ok: false,
              message: `Couldn't save Auto-update channel: ${result.error.message}`,
            }
          }
          return { ok: true, message: `Set Auto-update channel to ${channel}` }
        },
      ),
  },
  {
    id: 'theme',
    label: 'Theme',
    options: [...THEME_OPTIONS],
    write: raw =>
      writeEnumValue([...THEME_OPTIONS], 'Theme', raw, matched => {
        saveGlobalConfig(current => ({
          ...current,
          theme: matched as ThemeSetting,
        }))
        return { ok: true, message: `Set Theme to ${matched}` }
      }),
  },
  {
    id: 'notifChannel',
    label: 'Notifications',
    options: [
      'auto',
      'iterm2',
      'terminal_bell',
      'iterm2_with_bell',
      'kitty',
      'ghostty',
      'notifications_disabled',
    ],
    write: raw =>
      writeEnumValue(
        [
          'auto',
          'iterm2',
          'terminal_bell',
          'iterm2_with_bell',
          'kitty',
          'ghostty',
          'notifications_disabled',
        ],
        'Notifications',
        raw,
        matched => {
          saveGlobalConfig(current => ({
            ...current,
            preferredNotifChannel:
              matched as GlobalConfig['preferredNotifChannel'],
          }))
          return { ok: true, message: `Set Notifications to ${matched}` }
        },
      ),
  },
  {
    id: 'taskCompleteNotifEnabled',
    label: 'Push when idle',
    options: [...BOOLEAN],
    write: raw =>
      writeGlobalBoolean(
        'taskCompleteNotifEnabled' as keyof GlobalConfig,
        'Push when idle',
        raw,
      ),
  },
  {
    id: 'inputNeededNotifEnabled',
    label: 'Push when input needed',
    options: [...BOOLEAN],
    write: raw =>
      writeGlobalBoolean(
        'inputNeededNotifEnabled' as keyof GlobalConfig,
        'Push when input needed',
        raw,
      ),
  },
  {
    id: 'agentPushNotifEnabled',
    label: 'Push for agent',
    options: [...BOOLEAN],
    write: raw =>
      writeGlobalBoolean(
        'agentPushNotifEnabled' as keyof GlobalConfig,
        'Push for agent',
        raw,
      ),
  },
  {
    id: 'outputStyle',
    label: 'Output style',
    hint: 'open /config for styles',
    applyable: false,
  },
  {
    id: 'defaultView',
    label: 'Default view',
    options: ['transcript', 'chat', 'default'],
    write: raw =>
      writeEnumValue(
        ['transcript', 'chat', 'default'],
        'Default view',
        raw,
        matched => {
          const result = updateSettingsForSource('localSettings', {
            defaultView: matched,
          })
          if (result.error) {
            return {
              ok: false,
              message: `Couldn't save Default view: ${result.error.message}`,
            }
          }
          return { ok: true, message: `Set Default view to ${matched}` }
        },
      ),
  },
  {
    id: 'language',
    label: 'Language',
    hint: 'open /config for languages',
    applyable: false,
  },
  {
    id: 'editorMode',
    label: 'Editor mode',
    options: ['normal', 'vim'],
    write: raw =>
      writeEnumValue(['normal', 'vim'], 'Editor mode', raw, matched => {
        saveGlobalConfig(current => ({
          ...current,
          editorMode: matched as GlobalConfig['editorMode'],
        }))
        return { ok: true, message: `Set Editor mode to ${matched}` }
      }),
  },
  {
    id: 'askUserQuestionTimeout',
    label: 'AskUserQuestion timeout',
    options: ['60s', '5m', '10m', 'never'],
    write: raw =>
      writeEnumValue(
        ['60s', '5m', '10m', 'never'],
        'AskUserQuestion timeout',
        raw,
        matched => {
          const timeout = matched as '60s' | '5m' | '10m' | 'never'
          const result = updateSettingsForSource('userSettings', {
            askUserQuestionTimeout: timeout,
          })
          if (result.error) {
            return {
              ok: false,
              message: `Couldn't save AskUserQuestion timeout: ${result.error.message}`,
            }
          }
          return {
            ok: true,
            message: `Set AskUserQuestion timeout to ${timeout}`,
          }
        },
      ),
  },
  {
    id: 'prStatusFooterEnabled',
    label: 'PR status footer',
    options: [...BOOLEAN],
    write: raw =>
      writeGlobalBoolean(
        'prStatusFooterEnabled' as keyof GlobalConfig,
        'PR status footer',
        raw,
      ),
  },
  {
    id: 'model',
    label: 'Model',
    hint: 'open /config or /model',
    applyable: false,
  },
  {
    id: 'diffTool',
    label: 'Diff tool',
    options: ['terminal', 'auto'],
    write: raw =>
      writeEnumValue(['terminal', 'auto'], 'Diff tool', raw, matched => {
        saveGlobalConfig(current => ({
          ...current,
          diffTool: matched as GlobalConfig['diffTool'],
        }))
        return { ok: true, message: `Set Diff tool to ${matched}` }
      }),
  },
  {
    id: 'autoConnectIde',
    label: 'Auto-connect IDE',
    options: [...BOOLEAN],
    write: raw => writeGlobalBoolean('autoConnectIde', 'Auto-connect IDE', raw),
  },
  {
    id: 'autoInstallIdeExtension',
    label: 'Auto-install IDE extension',
    options: [...BOOLEAN],
    write: raw =>
      writeGlobalBoolean(
        'autoInstallIdeExtension',
        'Auto-install IDE extension',
        raw,
      ),
  },
  {
    id: 'claudeInChromeDefaultEnabled',
    label: 'Claude in Chrome default',
    options: [...BOOLEAN],
    write: raw =>
      writeGlobalBoolean(
        'claudeInChromeDefaultEnabled' as keyof GlobalConfig,
        'Claude in Chrome default',
        raw,
      ),
  },
  {
    id: 'teammateMode',
    label: 'Teammate mode',
    options: ['auto', 'tmux', 'in-process'],
    write: raw =>
      writeEnumValue(
        ['auto', 'tmux', 'in-process'],
        'Teammate mode',
        raw,
        matched => {
          saveGlobalConfig(current => ({
            ...current,
            teammateMode: matched as GlobalConfig['teammateMode'],
          }))
          return { ok: true, message: `Set Teammate mode to ${matched}` }
        },
      ),
  },
  {
    id: 'remoteControlAtStartup',
    label: 'Remote Control at startup',
    options: ['true', 'false', 'default'],
    write: raw =>
      writeEnumValue(
        ['true', 'false', 'default'],
        'Remote Control at startup',
        raw,
        matched => {
          // densable / Config.tsx: default unsets key; true/false store boolean
          if (matched === 'default') {
            saveGlobalConfig(current => {
              if (current.remoteControlAtStartup === undefined) return current
              const next = { ...current }
              delete next.remoteControlAtStartup
              return next
            })
            return {
              ok: true,
              message: 'Set Remote Control at startup to default',
            }
          }
          const enabled = matched === 'true'
          saveGlobalConfig(current => {
            if (current.remoteControlAtStartup === enabled) return current
            return { ...current, remoteControlAtStartup: enabled }
          })
          return {
            ok: true,
            message: `Set Remote Control at startup to ${matched}`,
          }
        },
      ),
  },
]

function findSettable(key: string): SettableKey | undefined {
  const q = key.toLowerCase()
  return SETTABLE_KEYS.find(k => k.id.toLowerCase() === q)
}

/** densable eKr — parse `key=value` or multi `a=1 b=2`. */
export function parseConfigShorthand(input: string): ConfigKeyValue[] | null {
  const t = input.trim()
  if (!t || !t.includes('=')) return null
  const parts = t.split(/\s+/)
  if (parts.filter(p => p.includes('=')).length === 1) {
    const eq = t.indexOf('=')
    const key = t.slice(0, eq)
    if (!key || /\s/.test(key)) return null
    return [{ key, raw: t.slice(eq + 1) }]
  }
  const out: ConfigKeyValue[] = []
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq <= 0) return null
    out.push({ key: p.slice(0, eq), raw: p.slice(eq + 1) })
  }
  return out
}

/** densable tKr — help text listing settable keys. */
export function listConfigKeys(): string {
  return SETTABLE_KEYS.map(k => {
    const shape = k.options
      ? k.options.join('|')
      : k.applyable === false
        ? '<open /config>'
        : 'true|false'
    return `  ${k.id}=${shape}`
  })
    .sort()
    .join('\n')
}

/** densable Sdy — noop for static catalog (API parity). */
export function _resetSettableConfigKeysForTesting(): void {}

/**
 * densable bdy(e, t): e=argsSoFar (unused for single-token key=), t=partial.
 */
export function getConfigArgumentCompletions(
  _argsSoFar: string[],
  partial: string,
): ArgumentCompletion[] {
  const eq = partial.indexOf('=')
  if (eq === -1) {
    const q = partial.toLowerCase()
    return SETTABLE_KEYS.filter(k => k.id.toLowerCase().startsWith(q))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(k => ({
        value: `${k.id}=`,
        description: k.options?.slice(0, 4).join(' | ') ?? k.hint ?? undefined,
        isFinal: false,
        appendSpace: false,
      }))
  }

  const key = partial.slice(0, eq)
  const valuePartial = partial.slice(eq + 1).toLowerCase()
  const setting = findSettable(key)
  if (!setting?.options) return []

  return setting.options
    .filter(o => o.toLowerCase().startsWith(valuePartial))
    .map(o => ({
      value: `${setting.id}=${o}`,
      isFinal: true,
    }))
}

/** densable _dy — apply one key=value. */
export async function applyConfigKeyValue(
  key: string,
  raw: string,
): Promise<ApplyConfigResult> {
  const setting = findSettable(key)
  if (!setting) {
    return {
      ok: false,
      message: `${key} isn't a /config setting. Run /config to see what's available.`,
    }
  }
  if (setting.applyable === false || !setting.write) {
    return {
      ok: false,
      message: `${setting.label} can't be set with key=value — use ${setting.hint ?? '/config'}.`,
    }
  }
  return setting.write(raw)
}

/** densable aor — apply one or more pairs. */
export async function applyConfigShorthand(
  pairs: ConfigKeyValue[],
): Promise<ApplyConfigResult[]> {
  const results: ApplyConfigResult[] = []
  for (const { key, raw } of pairs) {
    results.push(await applyConfigKeyValue(key, raw))
  }
  return results
}

/** densable VZ/IHe help/list tokens. */
export function isConfigHelpOrListToken(token: string): boolean {
  const t = token.toLowerCase()
  return HELP_TOKENS.has(t) || LIST_TOKENS.has(t)
}

/** densable JO_ help/list usage (interactive local-jsx). */
export function configShorthandUsage(): string {
  return `Run /config to open settings, or /config key=value to set one directly.\n${listConfigKeys()}`
}

/** densable Edy usage (non-interactive local / shs). */
export function configNonInteractiveUsage(): string {
  return `Usage: /config key=value [key=value ...]\n${listConfigKeys()}`
}

/** Used by tests / callers that need current global snapshot. */
export function peekGlobalConfig(): GlobalConfig {
  return getGlobalConfig()
}
