import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resetSettingsCache } from '../../../utils/settings/settingsCache.js'
import { AUTO_MODE_DEFAULTS_SENTINEL } from '../write.js'
import {
  addAutoModeRule,
  deleteAutoModeRule,
  dropEmptyEnvironmentHeaders,
  isAutoModeEnvironmentDocument,
  validateAutoModeRuleInput,
} from '../permissionTabWrite.js'

describe('densable $t / yce builtin switch', () => {
  test('SEA uLs().value is hardcoded true; Yr is not a second switch', () => {
    expect(isAutoModeEnvironmentDocument()).toBe(true)
    const src = readFileSync(
      join(import.meta.dir, '../permissionTabWrite.ts'),
      'utf8',
    )
    expect(src).toContain('uLs(){return{value:!0,src:"default"}}')
    expect(src).toContain('Auto tab confirm UI, not a second builtin switch')
  })
})

describe('validateAutoModeRuleInput (official Ki)', () => {
  test('rejects the $defaults sentinel', () => {
    expect(
      validateAutoModeRuleInput('allow', AUTO_MODE_DEFAULTS_SENTINEL),
    ).toContain('reserved')
  })

  test('rejects environment ### headers on the single-rule path', () => {
    expect(validateAutoModeRuleInput('environment', '### Host')).toContain(
      'section headers',
    )
  })

  test('accepts a plain sentence', () => {
    expect(
      validateAutoModeRuleInput(
        'allow',
        'Deploys from this machine are production.',
      ),
    ).toBeNull()
  })
})

describe('dropEmptyEnvironmentHeaders (official nc)', () => {
  test('drops a trailing header with no entry', () => {
    expect(
      dropEmptyEnvironmentHeaders(['### Host', 'laptop', '### Empty']),
    ).toEqual(['### Host', 'laptop'])
  })
})

describe('addAutoModeRule (official Hi)', () => {
  const prev = process.env.CLAUDE_CONFIG_DIR
  let dir: string

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `am-tab-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    mkdirSync(dir, { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = dir
    resetSettingsCache()
    writeFileSync(join(dir, 'settings.json'), '{}\n')
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prev
    resetSettingsCache()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test('seeds $defaults on the first non-environment rule', async () => {
    await addAutoModeRule('allow', 'Deploys from this machine are production.')
    const written = JSON.parse(
      readFileSync(join(dir, 'settings.json'), 'utf8'),
    ) as {
      autoMode?: { allow?: string[] }
    }
    expect(written.autoMode?.allow).toEqual([
      AUTO_MODE_DEFAULTS_SENTINEL,
      'Deploys from this machine are production.',
    ])
  })

  test('refuses environment single-entry add in document mode', async () => {
    await expect(addAutoModeRule('environment', 'laptop')).rejects.toThrow(
      'edited as a document',
    )
  })

  test('delete refuses the sentinel', async () => {
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        autoMode: { allow: [AUTO_MODE_DEFAULTS_SENTINEL, 'keep'] },
      }) + '\n',
    )
    resetSettingsCache()
    await expect(
      deleteAutoModeRule('allow', 0, AUTO_MODE_DEFAULTS_SENTINEL),
    ).rejects.toThrow('splice plumbing')
  })
})
