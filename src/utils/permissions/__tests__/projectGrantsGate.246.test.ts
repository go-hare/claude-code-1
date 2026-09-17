import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  setCwdState,
  setOriginalCwd,
  setSessionTrustAccepted,
} from '../../../bootstrap/state.js'
import {
  acceptTrustForDirectory,
  projectTrustConfigKey,
} from '../../../commands/cd/cdCommand.js'
import {
  getProjectPathForConfig,
  resetTrustDialogAcceptedCacheForTesting,
  saveGlobalConfig,
} from '../../config.js'
import { resetSettingsCache } from '../../settings/settingsCache.js'
import {
  filterGatedAllowRules,
  hasGatedProjectOrLocalGrants,
  resetProjectGrantsGateWarningsForTests,
  shouldGateAdditionalDirectories,
} from '../projectGrantsGate.js'
import type { PermissionRule } from '../PermissionRule.js'

const temps: string[] = []
const suiteCwd = process.cwd()

afterEach(() => {
  try {
    process.chdir(suiteCwd)
  } catch {
    // ignore
  }
  setCwdState(suiteCwd)
  setOriginalCwd(suiteCwd)
  setSessionTrustAccepted(false)
  resetTrustDialogAcceptedCacheForTesting()
  resetProjectGrantsGateWarningsForTests()
  resetSettingsCache()
})

function rule(
  source: PermissionRule['source'],
  ruleBehavior: PermissionRule['ruleBehavior'],
  toolName: string,
  ruleContent?: string,
): PermissionRule {
  return {
    source,
    ruleBehavior,
    ruleValue: { toolName, ruleContent },
  }
}

function isolate(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temps.push(dir)
  setCwdState(dir)
  setOriginalCwd(dir)
  process.chdir(dir)
  getProjectPathForConfig.cache?.clear?.()
  return dir
}

describe('densable 2.1.246 #52 ky / $d', () => {
  test('untrusted drops project allow and keeps deny/ask', () => {
    isolate('ky-drop-')
    const rules = [
      rule('projectSettings', 'allow', 'Bash', 'echo *'),
      rule('projectSettings', 'deny', 'Bash', 'rm *'),
      rule('projectSettings', 'ask', 'Edit'),
      rule('userSettings', 'allow', 'Read'),
    ]
    const kept = filterGatedAllowRules(rules)
    expect(kept).toEqual([rules[1], rules[2], rules[3]])
  })

  test('this-key trust keeps project allow', () => {
    const dir = isolate('ky-keep-')
    acceptTrustForDirectory(dir)
    getProjectPathForConfig.cache?.clear?.()
    const rules = [rule('projectSettings', 'allow', 'Bash', 'echo *')]
    expect(filterGatedAllowRules(rules)).toEqual(rules)
  })

  test('$d is true for project allow only', () => {
    const dir = isolate('kd-proj-')
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(
      join(dir, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(echo *)'] } }),
    )
    resetSettingsCache()
    expect(hasGatedProjectOrLocalGrants()).toBe(true)
    expect(shouldGateAdditionalDirectories('projectSettings')).toBe(true)
    expect(shouldGateAdditionalDirectories('userSettings')).toBe(false)
  })

  test('parent trust does not un-gate this key', () => {
    const parent = mkdtempSync(join(tmpdir(), 'ky-par-'))
    const child = join(parent, 'nested')
    mkdirSync(child)
    temps.push(parent)
    saveGlobalConfig(current => ({
      ...current,
      projects: {
        ...current.projects,
        [projectTrustConfigKey(parent)]: {
          allowedTools: [],
          mcpContextUris: [],
          mcpServers: {},
          projectOnboardingSeenCount: 0,
          hasTrustDialogAccepted: true,
        },
      },
    }))
    setCwdState(child)
    setOriginalCwd(child)
    process.chdir(child)
    getProjectPathForConfig.cache?.clear?.()
    const rules = [rule('projectSettings', 'allow', 'Bash', 'echo *')]
    expect(filterGatedAllowRules(rules)).toEqual([])
  })
})
