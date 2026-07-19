import { describe, expect, mock, test } from 'bun:test'

const globalState: Record<string, unknown> = {
  verbose: false,
  autoCompactEnabled: true,
  editorMode: 'normal',
  theme: 'dark',
  preferredNotifChannel: 'auto',
  respectGitignore: true,
  copyFullResponse: false,
  copyOnSelect: false,
  showTurnDuration: true,
  showMessageTimestamps: false,
  terminalProgressBarEnabled: true,
  autoConnectIde: false,
  autoInstallIdeExtension: false,
  diffTool: 'auto',
}

const realConfig = require('src/utils/config.ts') as Record<string, unknown>
mock.module('src/utils/config.js', () => ({
  ...realConfig,
  getGlobalConfig: () => ({ ...globalState }),
  saveGlobalConfig: (
    fn: (c: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    // densable production path replaces the whole object; Object.assign alone
    // cannot unset deleted keys (e.g. remoteControlAtStartup=default).
    const next = fn({ ...globalState })
    for (const k of Object.keys(globalState)) {
      if (!(k in next)) delete globalState[k]
    }
    Object.assign(globalState, next)
  },
}))

const settingsWrites: Array<Record<string, unknown>> = []
const realSettings = require('src/utils/settings/settings.ts') as Record<
  string,
  unknown
>
mock.module('src/utils/settings/settings.js', () => ({
  ...realSettings,
  getInitialSettings: () => ({ permissions: { defaultMode: 'default' } }),
  updateSettingsForSource: (
    _source: string,
    patch: Record<string, unknown>,
  ) => {
    settingsWrites.push(patch)
    return { error: null }
  },
}))

mock.module('src/utils/permissions/PermissionMode.js', () => ({
  PERMISSION_MODES: [
    'default',
    'plan',
    'acceptEdits',
    'bypassPermissions',
    'dontAsk',
  ],
}))

const {
  applyConfigKeyValue,
  applyConfigShorthand,
  getConfigArgumentCompletions,
  isConfigHelpOrListToken,
  listConfigKeys,
  parseConfigShorthand,
} = await import('../argumentCompletions.js')

describe('getConfigArgumentCompletions (densable bdy)', () => {
  test('lists key= completions for empty partial', () => {
    const items = getConfigArgumentCompletions([], '')
    expect(items.length).toBeGreaterThan(10)
    expect(items.every(i => i.value.endsWith('=') && i.isFinal === false)).toBe(
      true,
    )
    expect(items.every(i => i.appendSpace === false)).toBe(true)
    expect(items.some(i => i.value === 'verbose=')).toBe(true)
  })

  test('filters keys by prefix', () => {
    const items = getConfigArgumentCompletions([], 'theme')
    expect(items.map(i => i.value)).toEqual(['theme='])
  })

  test('boolean values after key=', () => {
    const items = getConfigArgumentCompletions([], 'verbose=')
    expect(items.map(i => i.value)).toEqual(['verbose=true', 'verbose=false'])
    expect(items.every(i => i.isFinal === true)).toBe(true)
  })

  test('filters enum values by prefix after =', () => {
    const items = getConfigArgumentCompletions([], 'editorMode=v')
    expect(items.map(i => i.value)).toEqual(['editorMode=vim'])
  })

  test('unknown key after = returns empty', () => {
    expect(getConfigArgumentCompletions([], 'notARealKey=true')).toEqual([])
  })
})

describe('parseConfigShorthand (densable eKr)', () => {
  test('single key=value with spaces in value', () => {
    expect(parseConfigShorthand('verbose=true')).toEqual([
      { key: 'verbose', raw: 'true' },
    ])
  })

  test('multi key=value tokens', () => {
    expect(parseConfigShorthand('verbose=true editorMode=vim')).toEqual([
      { key: 'verbose', raw: 'true' },
      { key: 'editorMode', raw: 'vim' },
    ])
  })

  test('rejects invalid', () => {
    expect(parseConfigShorthand('noequals')).toBeNull()
    expect(parseConfigShorthand('=novalue')).toBeNull()
  })
})

describe('applyConfigShorthand (densable aor/_dy)', () => {
  test('applies global boolean', async () => {
    const r = await applyConfigKeyValue('verbose', 'true')
    expect(r.ok).toBe(true)
    expect(globalState.verbose).toBe(true)
    expect(r.message).toContain('true')
  })

  test('rejects bad boolean', async () => {
    const r = await applyConfigKeyValue('verbose', 'maybe')
    expect(r.ok).toBe(false)
    expect(r.message).toContain('true or false')
  })

  test('applies enum editorMode', async () => {
    const r = await applyConfigKeyValue('editorMode', 'vim')
    expect(r.ok).toBe(true)
    expect(globalState.editorMode).toBe('vim')
  })

  test('unknown key fails', async () => {
    const r = await applyConfigKeyValue('notAKey', '1')
    expect(r.ok).toBe(false)
    expect(r.message).toContain("isn't a /config setting")
  })

  test('managed-only key points to panel', async () => {
    const r = await applyConfigKeyValue('model', 'opus')
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/can't be set|\/config|\/model/)
  })

  test('multi apply', async () => {
    const results = await applyConfigShorthand([
      { key: 'verbose', raw: 'false' },
      { key: 'theme', raw: 'light' },
    ])
    expect(results.every(r => r.ok)).toBe(true)
    expect(globalState.verbose).toBe(false)
    expect(globalState.theme).toBe('light')
  })

  test('remoteControlAtStartup true/default', async () => {
    const on = await applyConfigKeyValue('remoteControlAtStartup', 'true')
    expect(on.ok).toBe(true)
    expect(globalState.remoteControlAtStartup).toBe(true)
    const reset = await applyConfigKeyValue('remoteControlAtStartup', 'default')
    expect(reset.ok).toBe(true)
    expect(globalState.remoteControlAtStartup).toBeUndefined()
  })
})

describe('help tokens', () => {
  test('recognizes densable VZ/IHe tokens', () => {
    expect(isConfigHelpOrListToken('help')).toBe(true)
    expect(isConfigHelpOrListToken('list')).toBe(true)
    expect(isConfigHelpOrListToken('verbose=true')).toBe(false)
  })

  test('listConfigKeys is non-empty', () => {
    expect(listConfigKeys()).toContain('verbose=')
  })
})

describe('configNonInteractive Edy', () => {
  test('help returns Usage prefix', async () => {
    const { call } = await import('../config-noninteractive.js')
    const r = await call('help', {} as never)
    expect(r).toMatchObject({ type: 'text' })
    if (r.type === 'text') {
      expect(r.value.startsWith('Usage: /config key=value')).toBe(true)
      expect(r.value).toContain('verbose=')
    }
  })

  test('applies key=value', async () => {
    const { call } = await import('../config-noninteractive.js')
    const r = await call('verbose=true', {} as never)
    expect(r).toMatchObject({ type: 'text' })
    if (r.type === 'text') {
      expect(r.value).toContain('true')
    }
    expect(globalState.verbose).toBe(true)
  })

  test('invalid returns Expected key=value', async () => {
    const { call } = await import('../config-noninteractive.js')
    const r = await call('noequals', {} as never)
    expect(r).toMatchObject({ type: 'text' })
    if (r.type === 'text') {
      expect(r.value).toContain('Expected key=value')
    }
  })
})
