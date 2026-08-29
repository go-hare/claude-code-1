/**
 * densable V3w/TPl/uhs — auto-mode-setup write path.
 * Gold: gold-wide-V3w / TPl / uhs / svr.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetSettingsCache } from '../../../utils/settings/settingsCache.js'
import {
  AUTO_MODE_DEFAULTS_SENTINEL,
  AutoModeSetupWriteError,
  formatAutoModeSavedMessage,
  isRemovableAllowRule,
  mergeEnvironmentAppend,
  mergeRuleArray,
  proposalToAutoModeWrite,
  saveAutoModeSetup,
  validateAutoModeWriteInput,
  writeAutoModeSetup,
} from '../write.js'

const TEST_ROOT = join(
  tmpdir(),
  `claude-auto-mode-setup-write-${process.pid}-${Date.now()}`,
)

describe('autoModeSetup write (densable V3w/TPl)', () => {
  let prevConfigDir: string | undefined

  beforeEach(() => {
    prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    rmSync(TEST_ROOT, { recursive: true, force: true })
    mkdirSync(TEST_ROOT, { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = TEST_ROOT
    resetSettingsCache()
  })

  afterEach(() => {
    if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    resetSettingsCache()
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  test('TPl rejects empty environment and missing $defaults on rules', () => {
    expect(
      validateAutoModeWriteInput({
        autoMode: { environment: [] },
      }),
    ).toContain('environment is empty')
    expect(
      validateAutoModeWriteInput({
        autoMode: {
          environment: ['### Org-wide', '**Organization**: acme'],
          allow: ['Bash(ls:*)'],
        },
      }),
    ).toContain(`missing the literal entry "${AUTO_MODE_DEFAULTS_SENTINEL}"`)
    expect(
      validateAutoModeWriteInput({
        autoMode: {
          environment: [AUTO_MODE_DEFAULTS_SENTINEL],
        },
      }),
    ).toContain('must not contain')
  })

  test('append merges environment sections and seeds $defaults on allow', async () => {
    writeFileSync(
      join(TEST_ROOT, 'settings.json'),
      JSON.stringify(
        {
          autoMode: {
            environment: ['### Org-wide', '**Organization**: old'],
            soft_deny: [AUTO_MODE_DEFAULTS_SENTINEL, 'Bash(rm:*)'],
          },
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )
    resetSettingsCache()

    const result = await writeAutoModeSetup({
      mode: 'append',
      autoMode: {
        environment: [
          '### Org-wide',
          '**Organization**: acme',
          '### User-specific',
          '**Primary use**: hobby',
        ],
        allow: [AUTO_MODE_DEFAULTS_SENTINEL, 'Bash(gh:*)'],
      },
    })

    expect(result.environmentEntriesPreserved).toBe(2)
    expect(result.autoModeKeysWritten).toEqual(['environment', 'allow'])
    const written = JSON.parse(
      readFileSync(join(TEST_ROOT, 'settings.json'), 'utf-8'),
    )
    expect(written.autoMode.environment).toContain('**Organization**: old')
    expect(written.autoMode.environment).toContain('**Organization**: acme')
    expect(written.autoMode.environment).toContain('### User-specific')
    expect(written.autoMode.allow[0]).toBe(AUTO_MODE_DEFAULTS_SENTINEL)
    expect(written.autoMode.soft_deny).toEqual([
      AUTO_MODE_DEFAULTS_SENTINEL,
      'Bash(rm:*)',
    ])
  })

  test('removeFromPermissionsAllow filters allow list', async () => {
    writeFileSync(
      join(TEST_ROOT, 'settings.json'),
      JSON.stringify(
        {
          permissions: {
            allow: ['Bash(ls:*)', 'Bash(rm:*)', 'Read'],
            deny: ['WebFetch'],
          },
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )
    resetSettingsCache()

    const result = await saveAutoModeSetup({
      removeFromPermissionsAllow: ['Bash(rm:*)', 'Bash(missing:*)'],
    })
    expect(result.permissionsAllowRemoved).toEqual(['Bash(rm:*)'])
    expect(result.permissionsAllowNotFound).toEqual(['Bash(missing:*)'])
    expect(result.permissionsAllowSkipped).toBe(false)
    const written = JSON.parse(
      readFileSync(join(TEST_ROOT, 'settings.json'), 'utf-8'),
    )
    expect(written.permissions.allow).toEqual(['Bash(ls:*)', 'Read'])
    expect(written.permissions.deny).toEqual(['WebFetch'])
  })

  test('permissionsAllowSkipped when allow is not an array', async () => {
    writeFileSync(
      join(TEST_ROOT, 'settings.json'),
      JSON.stringify({ permissions: { allow: 'Bash' } }, null, 2) + '\n',
      'utf-8',
    )
    resetSettingsCache()
    const result = await writeAutoModeSetup({
      removeFromPermissionsAllow: ['Bash(ls:*)'],
    })
    expect(result.permissionsAllowSkipped).toBe(true)
    expect(result.permissionsAllowRemoved).toEqual([])
  })

  test('invalid_input throws AutoModeSetupWriteError', async () => {
    await expect(
      writeAutoModeSetup({ autoMode: { environment: [] } }),
    ).rejects.toMatchObject({
      name: 'AutoModeSetupWriteError',
      code: 'invalid_input',
    } satisfies Partial<AutoModeSetupWriteError>)
  })

  test('schema-invalid settings still append (x_ raw snapshot; not replace)', async () => {
    writeFileSync(
      join(TEST_ROOT, 'settings.json'),
      JSON.stringify(
        {
          cleanupPeriodDays: 'not-a-number',
          autoMode: {
            environment: ['### Org-wide', '**Organization**: old'],
            soft_deny: [AUTO_MODE_DEFAULTS_SENTINEL, 'Bash(rm:*)'],
          },
          permissions: { deny: ['WebFetch'] },
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )
    resetSettingsCache()

    const result = await writeAutoModeSetup({
      mode: 'append',
      autoMode: {
        environment: ['### Org-wide', '**Organization**: acme'],
      },
    })
    expect(result.environmentEntriesPreserved).toBe(2)
    const written = JSON.parse(
      readFileSync(join(TEST_ROOT, 'settings.json'), 'utf-8'),
    )
    expect(written.autoMode.environment).toContain('**Organization**: old')
    expect(written.autoMode.environment).toContain('**Organization**: acme')
    expect(written.autoMode.soft_deny).toEqual([
      AUTO_MODE_DEFAULTS_SENTINEL,
      'Bash(rm:*)',
    ])
    expect(written.cleanupPeriodDays).toBe('not-a-number')
    expect(written.permissions.deny).toEqual(['WebFetch'])
  })

  test('invalid JSON throws settings_file_invalid without overwrite', async () => {
    const path = join(TEST_ROOT, 'settings.json')
    writeFileSync(path, '{not json', 'utf-8')
    resetSettingsCache()
    await expect(
      writeAutoModeSetup({
        autoMode: { environment: ['### Org-wide', '**Organization**: acme'] },
      }),
    ).rejects.toMatchObject({
      name: 'AutoModeSetupWriteError',
      code: 'settings_file_invalid',
    } satisfies Partial<AutoModeSetupWriteError>)
    expect(readFileSync(path, 'utf-8')).toBe('{not json')
  })
})

describe('autoModeSetup write helpers', () => {
  test('uhs omits empty rule arrays', () => {
    expect(
      proposalToAutoModeWrite({
        environment: ['e'],
        allow: [],
        soft_deny: ['$defaults', 'x'],
        hard_deny: [],
      }),
    ).toEqual({
      environment: ['e'],
      soft_deny: ['$defaults', 'x'],
    })
  })

  test('Frn rejects credential URLs and multiline', () => {
    expect(isRemovableAllowRule('Bash(ls:*)')).toBe(true)
    expect(isRemovableAllowRule('http://user:pass@host/x')).toBe(false)
    expect(isRemovableAllowRule('Bash(a\nb)')).toBe(false)
  })

  test('K3w / q3w basics', () => {
    expect(mergeRuleArray('allow', [], ['$defaults', 'Bash(gh:*)'])).toEqual([
      '$defaults',
      'Bash(gh:*)',
    ])
    expect(
      mergeEnvironmentAppend(['### A', 'old'], ['### A', 'old', 'new']),
    ).toEqual(['### A', 'old', 'new'])
  })

  test('wEo mentions config command', () => {
    const msg = formatAutoModeSavedMessage(
      {
        filePath: '/tmp/settings.json',
        autoModeKeysWritten: ['environment'],
        environmentEntriesPreserved: 1,
        permissionsAllowRemoved: ['Bash(rm:*)'],
        permissionsAllowNotFound: [],
        permissionsAllowSkipped: false,
        warnings: [],
      },
      { removed: 1, skipped: 0 },
    )
    expect(msg).toContain('claude auto-mode config')
    expect(msg).toContain('kept 1 existing environment entry')
    expect(msg).toContain('removed 1 permissions.allow entry')
  })
})
