/**
 * Official 2.1.331 alignment tests for `/config`, `configShorthand`, `Settings/Config.tsx`,
 * `USER_INTENT_SETTING_KEYS`, `useTypeahead` command-arg completions, and `FileEditTool`
 * `settings.json` pre-validation.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileEditTool } from '../../../../packages/builtin-tools/src/tools/FileEditTool/FileEditTool.js'
import {
  getIsInteractive,
  getOriginalCwd,
  setCwdState,
  setFlagSettingsInline,
  setIsInteractive,
  setIsRemoteMode,
  setOriginalCwd,
} from '../../../bootstrap/state.js'
import { isVimModeEnabled } from '../../../components/PromptInput/utils.js'
import {
  buildRemoteControlSettingRow,
  ceFromCommandContext,
  coerceLanguageConfigInput,
  describeConfigRowsWithHooks,
  getConfigModelOptions,
  getConfigOverrideNotice,
  getRemoteControlLockInfo,
  hKe,
  isClawdFileProgressRowVisible,
  persistPluginConfigOption,
  pluginConfigSettings,
  resetConfigRowSeenFlagsForTesting,
  UNATTENDED_SERVING_LABELS,
  wrapSettingWithConfigSetHook,
} from '../../../components/Settings/Config.js'
import { fetchCommandArgumentSuggestions } from '../../../hooks/useTypeahead.js'
import {
  clearGrowthBookConfigOverrides,
  setGrowthBookConfigOverride,
} from '../../../services/analytics/growthbook.js'
import { getDefaultAppState } from '../../../state/AppStateStore.js'
import type { LocalJSXCommandContext } from '../../../types/command.js'
import type { LoadedPlugin } from '../../../types/plugin.js'
import {
  getCurrentProjectConfig,
  getGlobalConfig,
  getRemoteControlAtStartup,
  resolveUserIntentSetting,
  saveCurrentProjectConfig,
  saveGlobalConfig,
  saveUserIntentSetting,
  USER_INTENT_SETTING_KEYS,
} from '../../../utils/config.js'
import { fileHistoryEnabled } from '../../../utils/fileHistory.js'
import { setLoadedFunctionHooksModules } from '../../../utils/plugins/functionHooksModules.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../../utils/settings/settings.js'
import { resetSettingsCache } from '../../../utils/settings/settingsCache.js'
import { SettingsSchema } from '../../../utils/settings/types.js'
import {
  captureTeammateModeSnapshot,
  getTeammateModeFromSnapshot,
} from '../../../utils/swarm/backends/teammateModeSnapshot.js'
import {
  applyConfigSetting,
  applyConfigShorthandFromArgs,
  ConfigSettingRefusalError,
  getConfigArgumentCompletions,
  getConfigSettingsCatalog,
} from '../configShorthand.js'
import configCommand from '../index.js'

let tempRoot: string
let tempConfigDir: string
let tempProjectDir: string
let prevConfigDir: string | undefined
let prevCwd: string
let prevOriginalCwd: string
let prevAnthropicApiKey: string | undefined
let prevDisableGb: string | undefined
let prevFcOverrides: string | undefined
let prevAgentTeams: string | undefined
let prevInteractive: boolean

function makeMockContext(
  overrides: {
    mainLoopModel?: string | null
    verbose?: boolean
    thinkingEnabled?: boolean
    pluginsEnabled?: LoadedPlugin[]
    reloadPlugins?: () => Promise<void>
  } = {},
): {
  context: LocalJSXCommandContext
  getState: () => ReturnType<typeof getDefaultAppState>
} {
  let state = getDefaultAppState()
  if (overrides.mainLoopModel !== undefined) {
    state = { ...state, mainLoopModel: overrides.mainLoopModel }
  }
  if (overrides.verbose !== undefined) {
    state = { ...state, verbose: overrides.verbose }
  }
  if (overrides.thinkingEnabled !== undefined) {
    state = { ...state, thinkingEnabled: overrides.thinkingEnabled }
  }
  if (overrides.pluginsEnabled !== undefined) {
    state = {
      ...state,
      plugins: { ...state.plugins, enabled: overrides.pluginsEnabled },
    }
  }
  const context = {
    getAppState: () => state,
    setAppState: (
      updater: (
        prev: ReturnType<typeof getDefaultAppState>,
      ) => ReturnType<typeof getDefaultAppState>,
    ) => {
      state = updater(state)
    },
    options: {
      mcpClients: [],
      ideInstallationStatus: null,
      theme: 'dark',
    },
    reloadPlugins: overrides.reloadPlugins,
  } as unknown as LocalJSXCommandContext
  return { context, getState: () => state }
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'cc-config-331-'))
  tempConfigDir = join(tempRoot, 'claude-home')
  tempProjectDir = join(tempRoot, 'project')
  mkdirSync(tempConfigDir, { recursive: true })
  mkdirSync(join(tempProjectDir, '.claude'), { recursive: true })
  prevConfigDir = process.env.CLAUDE_CONFIG_DIR
  prevCwd = process.cwd()
  prevOriginalCwd = getOriginalCwd()
  prevAnthropicApiKey = process.env.ANTHROPIC_API_KEY
  prevDisableGb = process.env.DISABLE_GROWTHBOOK
  prevFcOverrides = process.env.CLAUDE_INTERNAL_FC_OVERRIDES
  prevAgentTeams = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  prevInteractive = getIsInteractive()
  process.env.CLAUDE_CONFIG_DIR = tempConfigDir
  process.env.DISABLE_GROWTHBOOK = '1'
  delete process.env.CLAUDE_INTERNAL_FC_OVERRIDES
  delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  delete process.env.ANTHROPIC_API_KEY
  setOriginalCwd(tempProjectDir)
  setCwdState(tempProjectDir)
  setIsInteractive(true)
  setIsRemoteMode(false)
  setFlagSettingsInline(null)
  clearGrowthBookConfigOverrides()
  setLoadedFunctionHooksModules([])
  resetConfigRowSeenFlagsForTesting()
  resetSettingsCache()
  saveGlobalConfig(current => ({
    ...current,
    theme: 'dark',
    editorMode: 'normal',
    verbose: false,
    preferredNotifChannel: 'auto',
    autoCompactEnabled: true,
    fileCheckpointingEnabled: true,
    showTurnDuration: true,
    terminalProgressBarEnabled: true,
    teammateMode: undefined,
    remoteControlAtStartup: undefined,
    claudeInChromeDefaultEnabled: false,
    defaultToAgentsView: false,
  }))
})

afterEach(() => {
  setLoadedFunctionHooksModules([])
  setIsRemoteMode(false)
  setFlagSettingsInline(null)
  clearGrowthBookConfigOverrides()
  resetConfigRowSeenFlagsForTesting()
  if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
  if (prevAnthropicApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = prevAnthropicApiKey
  if (prevDisableGb === undefined) delete process.env.DISABLE_GROWTHBOOK
  else process.env.DISABLE_GROWTHBOOK = prevDisableGb
  if (prevFcOverrides === undefined)
    delete process.env.CLAUDE_INTERNAL_FC_OVERRIDES
  else process.env.CLAUDE_INTERNAL_FC_OVERRIDES = prevFcOverrides
  if (prevAgentTeams === undefined) {
    delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  } else {
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = prevAgentTeams
  }
  setIsInteractive(prevInteractive)
  setOriginalCwd(prevOriginalCwd)
  setCwdState(prevCwd)
  resetSettingsCache()
  try {
    rmSync(tempRoot, { recursive: true, force: true })
  } catch {
    // ignore cleanup error
  }
})

describe('[P0-10] /config key=value for theme, model, outputStyle, language', () => {
  test('theme persists to userSettings headless and calls live setTheme when provided', async () => {
    const { context } = makeMockContext()
    const msg = await applyConfigShorthandFromArgs('theme=light', context)
    expect(msg).toBe('Set Theme to light')
    resetSettingsCache()
    expect(getSettingsForSource('userSettings')?.theme).toBe('light')

    const appliedThemes: string[] = []
    const liveMsg = await applyConfigShorthandFromArgs(
      'theme=dark-ansi',
      context,
      {
        setTheme: t => {
          appliedThemes.push(t)
        },
      },
    )
    expect(liveMsg).toBe('Set Theme to dark-ansi')
    expect(appliedThemes).toEqual(['dark-ansi'])

    const bad = await applyConfigShorthandFromArgs('theme=neon-pink', context)
    expect(bad).toContain('Theme takes one of:')
    expect(bad).toContain('For custom themes, use /theme.')
  })

  test('model persists to userSettings, updates AppState, and supports default', async () => {
    const { context, getState } = makeMockContext({ mainLoopModel: null })
    expect(getConfigModelOptions()).toContain('default')
    expect(getConfigModelOptions()).toContain('opus')

    const msg = await applyConfigShorthandFromArgs('model=opus', context)
    expect(msg).toContain('Set Model to opus')
    expect(getState().mainLoopModel).toBe('opus')
    resetSettingsCache()
    expect(getSettingsForSource('userSettings')?.model).toBe('opus')

    const resetMsg = await applyConfigShorthandFromArgs(
      'model=default',
      context,
    )
    expect(resetMsg).toContain('Set Model to default')
    expect(getState().mainLoopModel).toBeNull()
    resetSettingsCache()
    expect(getSettingsForSource('userSettings')?.model).toBeUndefined()
  })

  test('outputStyle persists to localSettings and reports unchanged style', async () => {
    const { context } = makeMockContext()
    const msg = await applyConfigShorthandFromArgs(
      'outputStyle=Concise',
      context,
    )
    expect(msg).toBe('Set Output style to Concise')
    resetSettingsCache()
    expect(getSettingsForSource('localSettings')?.outputStyle).toBe('Concise')

    const sameMsg = await applyConfigShorthandFromArgs(
      'outputStyle=Concise',
      context,
    )
    expect(sameMsg).toBe(
      'Set Output style to Concise (already the current style)',
    )

    const bad = await applyConfigShorthandFromArgs(
      'outputStyle=NonExistent',
      context,
    )
    expect(bad).toContain('Output style takes one of:')
    expect(bad).toContain('For custom styles, open /config.')
  })

  test('language coerces ISO codes/aliases and persists to userSettings', async () => {
    expect(coerceLanguageConfigInput('ja')).toBe('Japanese')
    expect(coerceLanguageConfigInput('jp')).toBe('Japanese')
    expect(coerceLanguageConfigInput('cn')).toBe('Chinese')
    expect(coerceLanguageConfigInput('tw')).toContain('Traditional')
    expect(coerceLanguageConfigInput('default')).toBe('default')
    expect(coerceLanguageConfigInput('brazilian portuguese')).toBe(
      'Brazilian Portuguese',
    )

    const { context } = makeMockContext()
    const msg = await applyConfigShorthandFromArgs('language=ja', context)
    expect(msg).toBe('Set Language to Japanese')
    resetSettingsCache()
    expect(getSettingsForSource('userSettings')?.language).toBe('Japanese')

    const resetMsg = await applyConfigShorthandFromArgs(
      'language=default',
      context,
    )
    expect(resetMsg).toBe('Set Language to default')
    resetSettingsCache()
    expect(getSettingsForSource('userSettings')?.language).toBeUndefined()
  })

  test('config.tsx mounts ConfigShorthandRunner using useTheme() for interactive shorthand', () => {
    const configTsxSrc = readFileSync(
      join(import.meta.dir, '../config.tsx'),
      'utf8',
    )
    expect(configTsxSrc).toContain('useTheme()')
    expect(configTsxSrc).toContain('ConfigShorthandRunner')
    expect(configTsxSrc).toContain('{ setTheme }')
  })
})

describe('[P0-11] USER_INTENT_SETTING_KEYS schema + unified read/write + runtime readers', () => {
  test('SettingsSchema accepts all 10 newly added USER_INTENT_SETTING_KEYS', () => {
    expect(USER_INTENT_SETTING_KEYS).toHaveLength(16)
    const parsed = SettingsSchema().safeParse({
      editorMode: 'vim',
      verbose: true,
      preferredNotifChannel: 'kitty',
      fileCheckpointingEnabled: false,
      showTurnDuration: false,
      terminalProgressBarEnabled: false,
      todoFeatureEnabled: false,
      autoUploadSessions: true,
      inputNeededNotifEnabled: true,
      agentPushNotifEnabled: true,
      teammateMode: 'iterm2',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.editorMode).toBe('vim')
      expect(parsed.data.verbose).toBe(true)
      expect(parsed.data.preferredNotifChannel).toBe('kitty')
      expect(parsed.data.fileCheckpointingEnabled).toBe(false)
      expect(parsed.data.showTurnDuration).toBe(false)
      expect(parsed.data.terminalProgressBarEnabled).toBe(false)
      expect(parsed.data.todoFeatureEnabled).toBe(false)
      expect(parsed.data.autoUploadSessions).toBe(true)
      expect(parsed.data.inputNeededNotifEnabled).toBe(true)
      expect(parsed.data.agentPushNotifEnabled).toBe(true)
      expect(parsed.data.teammateMode).toBe('iterm2')
    }
  })

  test('resolveUserIntentSetting prefers settings.json over legacy ~/.claude.json', () => {
    saveGlobalConfig(c => ({ ...c, editorMode: 'vim' }))
    expect(resolveUserIntentSetting('editorMode', 'normal')).toEqual({
      value: 'vim',
      source: 'legacyGlobalConfig',
    })

    saveUserIntentSetting('editorMode', 'normal')
    resetSettingsCache()
    expect(resolveUserIntentSetting('editorMode', 'normal')).toEqual({
      value: 'normal',
      source: 'userSettings',
    })
  })

  test('runtime readers honor userSettings immediately (vim, fileHistory, teammateMode)', async () => {
    const { context } = makeMockContext()
    // editor=vim -> userSettings -> isVimModeEnabled()
    expect(isVimModeEnabled()).toBe(false)
    await applyConfigShorthandFromArgs('editor=vim', context)
    resetSettingsCache()
    expect(getSettingsForSource('userSettings')?.editorMode).toBe('vim')
    expect(isVimModeEnabled()).toBe(true)

    // checkpoints=false -> userSettings -> fileHistoryEnabled()
    expect(fileHistoryEnabled()).toBe(true)
    await applyConfigShorthandFromArgs('checkpoints=false', context)
    resetSettingsCache()
    expect(getSettingsForSource('userSettings')?.fileCheckpointingEnabled).toBe(
      false,
    )
    expect(fileHistoryEnabled()).toBe(false)

    // teammateMode=iterm2 -> userSettings -> captureTeammateModeSnapshot()
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
    await applyConfigShorthandFromArgs('teammateMode=iterm2', context)
    resetSettingsCache()
    expect(getSettingsForSource('userSettings')?.teammateMode).toBe('iterm2')
    captureTeammateModeSnapshot()
    expect(getTeammateModeFromSnapshot()).toBe('iterm2')

    // progressBar, turnDuration, verbose, notifChannel persist to userSettings
    await applyConfigShorthandFromArgs(
      'progressBar=false turnDuration=false verbose=true notifChannel=kitty',
      context,
    )
    resetSettingsCache()
    const userSettings = getSettingsForSource('userSettings')
    expect(userSettings?.terminalProgressBarEnabled).toBe(false)
    expect(userSettings?.showTurnDuration).toBe(false)
    expect(userSettings?.verbose).toBe(true)
    expect(userSettings?.preferredNotifChannel).toBe('kitty')
  })

  test('remoteControl writes userSettings so getRemoteControlAtStartup() stays in sync', async () => {
    const { context } = makeMockContext()
    const rows = await getConfigSettingsCatalog(context, {
      includeHooks: false,
    })
    const rcRow = rows.find(r => r.id === 'remoteControl')
    if (rcRow) {
      const res = await applyConfigSetting('remoteControl', 'true', rows)
      expect(res.ok).toBe(true)
      resetSettingsCache()
      expect(getSettingsForSource('userSettings')?.remoteControlAtStartup).toBe(
        true,
      )
      expect(getRemoteControlAtStartup()).toBe(true)

      saveGlobalConfig(c => ({ ...c, remoteControlAtStartup: true }))
      const resetRes = await applyConfigSetting(
        'remoteControl',
        'default',
        rows,
      )
      expect(resetRes.ok).toBe(true)
      resetSettingsCache()
      expect(
        getSettingsForSource('userSettings')?.remoteControlAtStartup,
      ).toBeUndefined()
      expect(getGlobalConfig().remoteControlAtStartup).toBeUndefined()
    } else {
      // Even if bridge gate is off in test env, saveUserIntentSetting round-trips
      saveUserIntentSetting('remoteControlAtStartup', true)
      resetSettingsCache()
      expect(getRemoteControlAtStartup()).toBe(true)
    }
  })
})

describe('[P0-12] Plugin /config plugin.key=value awaited persistence & reload', () => {
  const samplePlugin: LoadedPlugin = {
    name: 'demo-plugin',
    source: 'demo-plugin@local',
    path: '/tmp/demo-plugin',
    enabled: true,
    manifest: {
      name: 'demo-plugin',
      userConfig: {
        autoSync: {
          type: 'boolean',
          title: 'Auto sync',
          description: 'Sync automatically',
          default: false,
        },
        mode: {
          type: 'string',
          title: 'Sync mode',
          description: 'How to sync',
          options: ['fast', 'full'],
          default: 'fast',
        },
      },
    },
  } as unknown as LoadedPlugin

  test('awaits disk persistence and reloadPlugins before resolving', async () => {
    let reloaded = false
    const { context } = makeMockContext({
      pluginsEnabled: [samplePlugin],
      reloadPlugins: async () => {
        await new Promise(resolve => setTimeout(resolve, 15))
        reloaded = true
      },
    })
    const msg = await applyConfigShorthandFromArgs(
      'demo-plugin.autoSync=true',
      context,
    )
    expect(msg).toBe('Set Auto sync to true')
    expect(reloaded).toBe(true)
    resetSettingsCache()
    expect(
      getSettingsForSource('userSettings')?.pluginConfigs?.['demo-plugin@local']
        ?.options?.autoSync,
    ).toBe(true)
  })

  test('returns reload failure suffix when reloadPlugins throws', async () => {
    const res = await persistPluginConfigOption(
      samplePlugin,
      'mode',
      'full',
      undefined,
      async () => {
        throw new Error('reload failed')
      },
    )
    expect(res?.error).toBeUndefined()
    expect(res?.messageSuffix).toContain('did not reload')
  })

  test('locked plugin option returns ConfigSettingRefusalError', async () => {
    const rows = pluginConfigSettings([samplePlugin], {
      refusal: 'locked by remote',
    })
    const res = await rows[0]!.onChange(true as never)
    expect((res as { error?: unknown })?.error).toBeInstanceOf(
      ConfigSettingRefusalError,
    )
  })
})

describe('[P0-13] Security & consent-gate fixes (permissionMode, apiKey, chrome)', () => {
  test('permissionMode excludes bypassPermissions', async () => {
    const { context } = makeMockContext()
    const rows = await getConfigSettingsCatalog(context, {
      includeHooks: false,
    })
    const permRow = rows.find(r => r.id === 'permissionMode')
    expect(permRow).toBeDefined()
    expect(permRow!.options).not.toContain('bypassPermissions')

    const refused = await applyConfigSetting(
      'permissionMode',
      'bypassPermissions',
      rows,
    )
    expect(refused.ok).toBe(false)
    expect(refused.kind).toBe('refusal')
  })

  test('apiKey and chrome are consentGated and block shorthand enabling', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test-secret-key-1234567890'
    const { context } = makeMockContext()
    const rows = await getConfigSettingsCatalog(context, {
      includeHooks: false,
    })

    const apiKeyRow = rows.find(r => r.id === 'apiKey')
    expect(apiKeyRow?.consentGated).toBe(true)
    const apiEnable = await applyConfigSetting('apiKey', 'true', rows)
    expect(apiEnable.ok).toBe(false)
    expect(apiEnable.message).toContain("can't be enabled with key=value")

    const chromeRow = rows.find(r => r.id === 'chrome')
    expect(chromeRow?.consentGated).toBe(true)
    const chromeEnable = await applyConfigSetting('chrome', 'true', rows)
    expect(chromeEnable.ok).toBe(false)
    expect(chromeEnable.message).toContain("can't be enabled with key=value")
  })
})

describe('[P1-14] getArgumentCompletions in useTypeahead and getConfigArgumentCompletions', () => {
  test('synthesizes true/false for booleans, filters non-settable rows, shows optionsHint', async () => {
    const { context } = makeMockContext()
    const keyItems = await getConfigArgumentCompletions('', context)
    const keys = keyItems.map(i => i.value)
    expect(keys).toContain('tips=')
    expect(keys).toContain('theme=')
    expect(keys).toContain('language=')
    expect(keys).toContain('model=')
    expect(keys).toContain('outputStyle=')
    expect(keys).not.toContain('chrome=')
    expect(keys).not.toContain('autoUpdatesChannel=')
    expect(keys).not.toContain('agentsView=')

    const tipsItem = keyItems.find(i => i.value === 'tips=')
    expect(tipsItem?.description).toBe('true | false')
    const langItem = keyItems.find(i => i.value === 'language=')
    expect(langItem?.description).toContain('ISO code')

    const boolVals = await getConfigArgumentCompletions('tips=t', context)
    expect(boolVals).toEqual([{ value: 'tips=true', isFinal: true }])
  })

  test('fetchCommandArgumentSuggestions maps partial key= and final key=val replacements', async () => {
    const { context } = makeMockContext()
    const keySuggestions = await fetchCommandArgumentSuggestions(
      '/config th',
      configCommand.getArgumentCompletions!,
      context,
    )
    const themeItem = keySuggestions.find(s => s.id === 'command-arg-theme=')
    expect(themeItem).toBeDefined()
    expect(themeItem?.metadata).toEqual({
      replacement: '/config theme=',
      partial: true,
    })

    const valSuggestions = await fetchCommandArgumentSuggestions(
      '/config tips=f',
      configCommand.getArgumentCompletions!,
      context,
    )
    expect(valSuggestions).toEqual([
      {
        id: 'command-arg-tips=false',
        displayText: 'tips=false',
        description: undefined,
        metadata: {
          replacement: '/config tips=false',
          partial: false,
        },
      },
    ])
  })
})

describe('[P1-15] FileEditTool settings.json pre-edit simulation avoids $$/$& corruption', () => {
  test('allows $$ and $& in new_string and strips trailing newline on deletion', async () => {
    const settingsPath = join(tempConfigDir, 'settings.json')
    const initial = '{\n  "model": "sonnet",\n  "language": "English"\n}\n'
    writeFileSync(settingsPath, initial, 'utf8')
    const { context } = makeMockContext()
    const readFileState = new Map<
      string,
      {
        content: string
        timestamp: number
        offset: undefined
        limit: undefined
      }
    >()
    readFileState.set(settingsPath, {
      content: initial,
      timestamp: Date.now() + 10_000,
      offset: undefined,
      limit: undefined,
    })
    const editCtx = {
      ...context,
      readFileState,
    } as unknown as LocalJSXCommandContext

    // Replacement containing $$ and $& — broken .replace(old, new) would turn $& into old_string!
    const dollarRes = await FileEditTool.validateInput!(
      {
        file_path: settingsPath,
        old_string: '"English"',
        new_string: '"$HOME/$$/$&/ok"',
      },
      editCtx,
    )
    expect(dollarRes.result).toBe(true)

    // Deletion (new_string === '') should strip trailing newline cleanly
    const deleteRes = await FileEditTool.validateInput!(
      {
        file_path: settingsPath,
        old_string: ',\n  "language": "English"',
        new_string: '',
      },
      editCtx,
    )
    expect(deleteRes.result).toBe(true)
  })
})

describe('[P1-17] Error propagation & ConfigSettingRefusalError on remoteHomeSettings', () => {
  test('propagates F/B write errors as save-failure instead of silently succeeding', async () => {
    const { context } = makeMockContext()
    const baseBag = ceFromCommandContext(context)
    const failingError = new Error('EACCES: permission denied')
    const { settings } = hKe({
      ...baseBag,
      F: () => ({ error: failingError }),
      B: () => ({ error: failingError }),
    })
    const autoCompactRow = settings.find(s => s.id === 'autoCompact')!
    const res = await applyConfigSetting('autoCompact', 'false', [
      autoCompactRow as never,
    ])
    expect(res.ok).toBe(false)
    expect(res.kind).toBe('save-failure')
    expect(res.message).toContain('EACCES')
  })

  test('remoteHomeSettings refusal uses ConfigSettingRefusalError', async () => {
    saveGlobalConfig(c => ({ ...c, remoteHomeSettingsMode: 'forward' }))
    const { context } = makeMockContext()
    const { settings } = hKe(ceFromCommandContext(context))
    const row = settings.find(s => s.id === 'remoteHomeSettings')
    expect(row).toBeDefined()
    const res = await row!.onChange(true as never)
    expect((res as { error?: unknown })?.error).toBeInstanceOf(
      ConfigSettingRefusalError,
    )
  })
})

describe('[P1-18] Clear legacy localSettings shadow on tips & reduceMotion', () => {
  test('clears pre-existing localSettings shadow when saving tips or reduceMotion', async () => {
    updateSettingsForSource('localSettings', {
      spinnerTipsEnabled: false,
      prefersReducedMotion: true,
    })
    resetSettingsCache()
    expect(getSettingsForSource('localSettings')?.spinnerTipsEnabled).toBe(
      false,
    )
    expect(getSettingsForSource('localSettings')?.prefersReducedMotion).toBe(
      true,
    )

    const { context } = makeMockContext()
    await applyConfigShorthandFromArgs('tips=true reduceMotion=false', context)
    resetSettingsCache()
    expect(getSettingsForSource('userSettings')?.spinnerTipsEnabled).toBe(true)
    expect(getSettingsForSource('userSettings')?.prefersReducedMotion).toBe(
      false,
    )
    expect(
      getSettingsForSource('localSettings')?.spinnerTipsEnabled,
    ).toBeUndefined()
    expect(
      getSettingsForSource('localSettings')?.prefersReducedMotion,
    ).toBeUndefined()
  })

  test('syncs localSettings when projectSettings contradicts user choice', async () => {
    updateSettingsForSource('projectSettings', { spinnerTipsEnabled: false })
    resetSettingsCache()
    const { context } = makeMockContext()
    await applyConfigShorthandFromArgs('tips=true', context)
    resetSettingsCache()
    expect(getSettingsForSource('userSettings')?.spinnerTipsEnabled).toBe(true)
    expect(getSettingsForSource('localSettings')?.spinnerTipsEnabled).toBe(true)
  })
})

describe('[P1-19] getConfigOverrideNotice avoids false self-override on outputStyle', () => {
  test('localSettings.outputStyle does not self-warn, flagSettings.outputStyle does', () => {
    updateSettingsForSource('localSettings', { outputStyle: 'Concise' })
    resetSettingsCache()
    expect(getConfigOverrideNotice('outputStyle')).toBeUndefined()
    expect(
      getConfigOverrideNotice('outputStyle', 'localSettings'),
    ).toBeUndefined()

    setFlagSettingsInline({ outputStyle: 'Learning' })
    resetSettingsCache()
    expect(getConfigOverrideNotice('outputStyle')).toContain(
      'override what you save here',
    )
  })
})

describe('[P1-20] Lock enforcement on thinking, remoteControl, askUserQuestionTimeout', () => {
  test('thinking locks off for Fable 5 models while allowing true', async () => {
    const { context } = makeMockContext({
      mainLoopModel: 'claude-fable-5-20260601',
    })
    const rows = await getConfigSettingsCatalog(context, {
      includeHooks: false,
    })
    const thinkingRow = rows.find(r => r.id === 'thinking')
    expect(thinkingRow?.lock).toBeDefined()
    expect(thinkingRow?.lock?.reason).toContain("Thinking can't be turned off")

    const offRes = await applyConfigSetting('thinking', 'false', rows)
    expect(offRes.ok).toBe(false)
    expect(offRes.message).toContain("Thinking can't be turned off")

    const onRes = await applyConfigSetting('thinking', 'true', rows)
    expect(onRes.ok).toBe(true)
  })

  test('remoteControl locks when disableRemoteControl is set in managed settings', async () => {
    setFlagSettingsInline({ disableRemoteControl: true })
    resetSettingsCache()
    const lockInfo = getRemoteControlLockInfo()
    expect(lockInfo).not.toBeNull()
    expect(lockInfo?.source).toBe('managed')
    expect(lockInfo?.reason).toContain('disableRemoteControl')

    const rcRow = buildRemoteControlSettingRow(false, lockInfo, selected => {
      if (selected !== 'false') {
        return { error: new ConfigSettingRefusalError(lockInfo!.reason) }
      }
      return undefined
    })
    expect(rcRow.lock?.writableWhileLocked).toEqual(['false'])

    const enableRes = await applyConfigSetting('remoteControl', 'true', [
      rcRow as never,
    ])
    expect(enableRes.ok).toBe(false)
    const disableRes = await applyConfigSetting('remoteControl', 'false', [
      rcRow as never,
    ])
    expect(disableRes.ok).toBe(true)
  })

  test('askUserQuestionTimeout is hidden when managed by flagSettings', async () => {
    setFlagSettingsInline({ askUserQuestionTimeout: '60s' })
    resetSettingsCache()
    const { context } = makeMockContext()
    const { settings } = hKe(ceFromCommandContext(context))
    expect(
      settings.find(s => s.id === 'askUserQuestionTimeout'),
    ).toBeUndefined()
  })
})

describe('[P1-21] config.set and config.describe plugin hooks across /config', () => {
  test('config.set hook can deny or rewrite values in /config shorthand', async () => {
    setLoadedFunctionHooksModules([
      {
        name: 'policy-plugin',
        patterns: ['config.set'],
        hooks: [
          {
            pattern: 'config.set',
            hook: async (_api, e, next) => {
              const ev = e as { key?: string; value?: unknown }
              if (ev.key === 'tips') return { deny: 'tips pinned by plugin' }
              if (ev.key === 'theme') return next({ ...ev, value: 'light' })
              return next(ev)
            },
          },
        ],
      },
    ])

    const { context } = makeMockContext()
    const denied = await applyConfigShorthandFromArgs('tips=false', context)
    expect(denied).toContain('tips pinned by plugin')
    resetSettingsCache()
    expect(
      getSettingsForSource('userSettings')?.spinnerTipsEnabled,
    ).toBeUndefined()

    const rewritten = await applyConfigShorthandFromArgs('theme=dark', context)
    expect(rewritten).toContain('Set Theme to dark')
    resetSettingsCache()
    expect(getSettingsForSource('userSettings')?.theme).toBe('light')
  })

  test('config.describe hook hides and relabels rows', async () => {
    setLoadedFunctionHooksModules([
      {
        name: 'ui-plugin',
        patterns: ['config.describe'],
        hooks: [
          {
            pattern: 'config.describe',
            hook: async (_api, e, next) => {
              const ev = e as { key?: string; label?: string }
              if (ev.key === 'tips') return { ...ev, isHidden: true }
              if (ev.key === 'theme') return { ...ev, label: 'Color Palette' }
              return next(ev)
            },
          },
        ],
      },
    ])

    const { context } = makeMockContext()
    const { settings } = hKe(ceFromCommandContext(context))
    const overrides = await describeConfigRowsWithHooks(settings)
    expect(overrides.get('tips')?.hidden).toBe(true)
    expect(overrides.get('theme')).toEqual({
      label: 'Color Palette',
      hidden: false,
    })

    const catalog = await getConfigSettingsCatalog(context)
    expect(catalog.find(r => r.id === 'tips')).toBeUndefined()
    expect(catalog.find(r => r.id === 'theme')?.label).toBe('Color Palette')

    // Also verify wrapSettingWithConfigSetHook is a no-op when no config.set hook exists
    const row = settings[0]!
    expect(wrapSettingWithConfigSetHook(row)).toBe(row)
  })
})

describe('[P1-22] defaultToAgentsView stays settable under tengu_maple_sundial', () => {
  test('defaultToAgentsView works via shorthand even when mapleSundial groups it into agentsView', async () => {
    setGrowthBookConfigOverride('tengu_maple_sundial', true)
    const { context } = makeMockContext()
    const bag = { ...ceFromCommandContext(context), mapleSundial: true }
    const { settings, dialogFieldRows } = hKe(bag)
    const hasAgentsView = settings.some(s => s.id === 'agentsView')
    const hasDialogDefault = dialogFieldRows.some(
      s => s.id === 'defaultToAgentsView',
    )
    if (hasDialogDefault) {
      expect(hasAgentsView).toBe(true)
      expect(settings.some(s => s.id === 'defaultToAgentsView')).toBe(false)
      const catalog = await getConfigSettingsCatalog(context, {
        includeHooks: false,
      })
      expect(catalog.some(r => r.id === 'defaultToAgentsView')).toBe(true)
      const res = await applyConfigShorthandFromArgs(
        'defaultToAgentsView=true',
        context,
      )
      expect(res).toContain('Set Open agents view by default to true')
      expect(getGlobalConfig().defaultToAgentsView).toBe(true)
    }
  })
})

describe('[P1-23] 6 official 2.1.331 /config catalog rows', () => {
  test('clawdFileProgress gated by tengu_piped_planet (hidden on Apple_Terminal) and persists clawdFileProgressEnabled', async () => {
    const { context } = makeMockContext()
    expect(
      hKe(
        ceFromCommandContext(context, { terminalOverride: 'iTerm.app' }),
      ).settings.find(s => s.id === 'clawdFileProgress'),
    ).toBeUndefined()

    process.env.CLAUDE_INTERNAL_FC_OVERRIDES = JSON.stringify({
      tengu_piped_planet: true,
    })
    // Official 2.1.331 g$t(): hidden on Apple_Terminal, visible on iTerm.app
    expect(isClawdFileProgressRowVisible('Apple_Terminal')).toBe(false)
    expect(isClawdFileProgressRowVisible('iTerm.app')).toBe(true)

    const { settings } = hKe(
      ceFromCommandContext(context, { terminalOverride: 'iTerm.app' }),
    )
    const row = settings.find(s => s.id === 'clawdFileProgress')
    expect(row).toBeDefined()
    const res = await applyConfigSetting('clawdFileProgress', 'true', [
      row as never,
    ])
    expect(res.ok).toBe(true)
    expect(res.message).toContain('Set Show Clawd carrying files to true')
    resetSettingsCache()
    expect(getSettingsForSource('userSettings')?.clawdFileProgressEnabled).toBe(
      true,
    )
  })

  test('orgMemoryRead & orgMemoryWrites persist to project config', async () => {
    saveCurrentProjectConfig(prev => ({
      ...prev,
      orgMemoryRead: false,
      orgMemoryWrites: true,
    }))
    const { context } = makeMockContext()
    const { settings } = hKe(ceFromCommandContext(context))
    const readRow = settings.find(s => s.id === 'orgMemoryRead')
    const writeRow = settings.find(s => s.id === 'orgMemoryWrites')
    expect(readRow).toBeDefined()
    expect(writeRow).toBeDefined()
    expect(writeRow?.consentGated).toBe(true)

    await readRow!.onChange(true as never)
    expect(getCurrentProjectConfig().orgMemoryRead).toBeUndefined()
  })

  test('unattendedServing respects remoteTools.allowUnattendedServing lock & persists consent', async () => {
    const { context } = makeMockContext()
    expect(
      hKe(ceFromCommandContext(context)).settings.find(
        s => s.id === 'unattendedServing',
      ),
    ).toBeUndefined()

    updateSettingsForSource('userSettings', {
      remoteTools: { allowUnattendedServing: false },
    })
    resetSettingsCache()
    const { settings } = hKe(
      ceFromCommandContext(context, { remoteToolServingOn: true }),
    )
    const row = settings.find(s => s.id === 'unattendedServing')
    expect(row).toBeDefined()
    expect(row?.consentGated).toBe(true)
    expect(row?.lock?.reason).toContain('remoteTools.allowUnattendedServing')
    expect(row?.lock?.writableWhileLocked).toEqual([
      UNATTENDED_SERVING_LABELS.declined,
    ])

    const acceptRes = await row!.onChange(
      UNATTENDED_SERVING_LABELS.accepted as never,
    )
    expect((acceptRes as { error?: unknown })?.error).toBeInstanceOf(
      ConfigSettingRefusalError,
    )
  })

  test('alwaysDeliverInSession updates session state and is consentGated', () => {
    const { context } = makeMockContext()
    let stored:
      | { scope: 'mine' | 'anyone'; madeIn: 'bypass' | 'prompting' }
      | undefined
    const { settings } = hKe(
      ceFromCommandContext(context, {
        alwaysDeliver: {
          current: undefined,
          sessionClass: 'prompting',
          set: next => {
            stored = next
          },
        },
      }),
    )
    const row = settings.find(s => s.id === 'alwaysDeliverInSession')
    expect(row).toBeDefined()
    expect(row?.consentGated).toBe(true)
    row!.onChange('from anyone' as never)
    expect(stored).toEqual({ scope: 'anyone', madeIn: 'prompting' })
  })

  test('remoteMessageReceipts gated by tengu_toasty_phoenix and persists to userSettings', async () => {
    const { context } = makeMockContext()
    expect(
      hKe(ceFromCommandContext(context)).settings.find(
        s => s.id === 'remoteMessageReceipts',
      ),
    ).toBeUndefined()

    setGrowthBookConfigOverride('tengu_toasty_phoenix', true)
    const { settings } = hKe(ceFromCommandContext(context))
    const row = settings.find(s => s.id === 'remoteMessageReceipts')
    expect(row).toBeDefined()
    expect(row?.consentGated).toBe(true)
    await row!.onChange('off' as never)
    resetSettingsCache()
    expect(getSettingsForSource('userSettings')?.remoteMessageReceipts).toBe(
      'off',
    )
  })
})
