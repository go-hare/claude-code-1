import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import {
  setCwdState,
  setOriginalCwd,
  setSessionTrustAccepted,
  getSessionId,
  getSessionProjectDir,
  switchSession,
} from '../../../bootstrap/state.js'
import {
  acceptTrustForDirectory,
  projectTrustConfigKey,
  relocateSessionCwd,
} from '../../../commands/cd/cdCommand.js'
import {
  getProjectPathForConfig,
  resetTrustDialogAcceptedCacheForTesting,
  saveGlobalConfig,
} from '../../config.js'
import { applyPermissionUpdate } from '../../permissions/PermissionUpdate.js'
import { resetProjectGrantsGateWarningsForTests } from '../../permissions/projectGrantsGate.js'
import {
  getRenderVersion,
  invalidateAllRenders,
  resetRenderVersionsForTests,
  subscribeRenderInvalidation,
} from '../../render/invalidateAllRenders.js'
import {
  clearDynamicSkills,
  getDynamicSkills,
} from '../../../skills/loadSkillsDir.js'
import { normalizePathForConfigKey } from '../../path.js'
import {
  reconcileAdditionalDirectories,
  retireDepartedAdditionalDirectories,
} from '../applySettingsChange.js'
import {
  settingsChangeDetector,
  type SettingsChangeExtra,
} from '../changeDetector.js'
import { resetSettingsCache } from '../settingsCache.js'
import { resetLocalSettingsGitTrackedCache } from '../localSettingsGitTracked.js'
import { skillChangeDetector } from '../../skills/skillChangeDetector.js'

const temps: string[] = []
const suiteCwd = process.cwd()
const suiteSessionId = getSessionId()
const suiteSessionProjectDir = getSessionProjectDir()

afterEach(async () => {
  try {
    process.chdir(suiteCwd)
  } catch {
    // ignore
  }
  setCwdState(suiteCwd)
  setOriginalCwd(suiteCwd)
  switchSession(suiteSessionId, suiteSessionProjectDir)
  setSessionTrustAccepted(false)
  resetTrustDialogAcceptedCacheForTesting()
  getProjectPathForConfig.cache?.clear?.()
  resetLocalSettingsGitTrackedCache()
  resetSettingsCache()
  resetProjectGrantsGateWarningsForTests()
  resetRenderVersionsForTests()
  clearDynamicSkills()
  await settingsChangeDetector.resetForTesting()
  await skillChangeDetector.resetForTesting()
})

describe('densable 2.1.246 #52 applySettingsChange be()', () => {
  test('swaps project additionalDirectories using prevCwd', () => {
    const prev = join(mkdtempSync(join(tmpdir(), 'cd-246-prev-')), 'old-extra')
    const next = join(mkdtempSync(join(tmpdir(), 'cd-246-next-')), 'new-extra')
    temps.push(prev, next)

    let ctx = getEmptyToolPermissionContext()
    ctx = applyPermissionUpdate(ctx, {
      type: 'addDirectories',
      directories: [prev],
      destination: 'localSettings',
    })
    expect(ctx.additionalWorkingDirectories.has(prev)).toBe(true)

    ctx = reconcileAdditionalDirectories(
      ctx,
      [prev],
      [next],
      'projectSettings',
      false,
      join(prev, '..'),
    )
    expect(ctx.additionalWorkingDirectories.has(prev)).toBe(false)
    expect(ctx.additionalWorkingDirectories.has(next)).toBe(true)
  })

  test('does not remove cliArg-owned directories', () => {
    const cli = join(mkdtempSync(join(tmpdir(), 'cd-246-cli-')), 'kept')
    temps.push(cli)
    let ctx = getEmptyToolPermissionContext()
    ctx = applyPermissionUpdate(ctx, {
      type: 'addDirectories',
      directories: [cli],
      destination: 'cliArg',
    })
    ctx = reconcileAdditionalDirectories(ctx, [cli], [], 'projectSettings')
    expect(ctx.additionalWorkingDirectories.has(cli)).toBe(true)
  })
})

describe('densable 2.1.246 ft departed + Obe retire', () => {
  test('relocate returns project additionalDirectories expanded against prev cwd', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-246-dep-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-246-dep-b-'))
    const extra = join(a, 'old-extra')
    temps.push(a, b, extra)
    mkdirSync(extra)
    mkdirSync(join(a, '.claude'), { recursive: true })
    writeFileSync(
      join(a, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { additionalDirectories: ['old-extra'] } }),
    )
    setCwdState(a)
    setOriginalCwd(a)
    process.chdir(a)
    getProjectPathForConfig.cache?.clear?.()
    resetSettingsCache()
    const r = await relocateSessionCwd(b, 'cd_command')
    expect(r.departedAdditionalDirectories).toContain(resolve(extra))
  })

  test('Obe drops departed dirs and no-ops when none are live', () => {
    const extra = join(mkdtempSync(join(tmpdir(), 'cd-246-obe-')), 'gone')
    temps.push(extra)
    let ctx = getEmptyToolPermissionContext()
    ctx = applyPermissionUpdate(ctx, {
      type: 'addDirectories',
      directories: [extra],
      destination: 'localSettings',
    })
    const retired = retireDepartedAdditionalDirectories(ctx, [extra])
    expect(retired.additionalWorkingDirectories.has(extra)).toBe(false)
    expect(retireDepartedAdditionalDirectories(retired, [extra])).toBe(retired)
  })
})

describe('densable 2.1.246 #52 notifyChange extra', () => {
  test('fans out prevCwd to subscribers', () => {
    const seen: Array<{ source: string; extra?: SettingsChangeExtra }> = []
    const unsub = settingsChangeDetector.subscribe((source, extra) => {
      seen.push({ source, extra })
    })
    settingsChangeDetector.notifyChange('projectSettings', {
      prevCwd: '/old/project',
    })
    unsub()
    expect(seen).toEqual([
      { source: 'projectSettings', extra: { prevCwd: '/old/project' } },
    ])
  })

  test('fans out trustFlip to subscribers', () => {
    const seen: Array<{ source: string; extra?: SettingsChangeExtra }> = []
    const unsub = settingsChangeDetector.subscribe((source, extra) => {
      seen.push({ source, extra })
    })
    settingsChangeDetector.notifyChange('projectSettings', { trustFlip: true })
    unsub()
    expect(seen).toEqual([
      { source: 'projectSettings', extra: { trustFlip: true } },
    ])
  })
})

describe('densable 2.1.246 #52 watcher rehome no-op when idle', () => {
  test('settings rehome returns without initialize', async () => {
    await expect(settingsChangeDetector.rehome()).resolves.toBeUndefined()
  })

  test('skill rehome returns without initialize', async () => {
    await expect(skillChangeDetector.rehome()).resolves.toBeUndefined()
  })
})

describe('densable 2.1.246 #52 /cd apply-now notice', () => {
  test('model notice names project settings/hooks/MCP/skills from the new dir', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-246-notice-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-246-notice-b-'))
    temps.push(a, b)
    setCwdState(a)
    process.chdir(a)
    const r = await relocateSessionCwd(b, 'cd_command')
    expect(r.modelMessage).toContain(
      'Project settings (permission rules, hooks)',
    )
    expect(r.modelMessage).toContain('project MCP servers')
    expect(r.modelMessage).toContain('project skills now come from')
    expect(r.modelMessage).toContain('settings stay in effect for this process')
  })
})

describe('densable 2.1.246 #52 A() + ke(de("skills"))', () => {
  test('clears loadAllPlugins memo so Te sees dest plugin MCP', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-246-plug-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-246-plug-b-'))
    temps.push(a, b)
    const { loadAllPlugins } = await import('../../plugins/pluginLoader.js')
    loadAllPlugins.cache?.set(
      undefined,
      Promise.resolve({
        enabled: [],
        disabled: [],
        errors: [],
      }),
    )
    expect(loadAllPlugins.cache?.has(undefined)).toBe(true)
    setCwdState(a)
    setOriginalCwd(a)
    process.chdir(a)
    await relocateSessionCwd(b, 'cd_command')
    expect(loadAllPlugins.cache?.has(undefined)).toBe(false)
  })

  test('clears getProjectPathForConfig memo so the new originalCwd is used', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-246-proj-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-246-proj-b-'))
    temps.push(a, b)
    setCwdState(a)
    setOriginalCwd(a)
    process.chdir(a)
    getProjectPathForConfig.cache?.clear?.()
    const keyA = getProjectPathForConfig()
    await relocateSessionCwd(b, 'cd_command')
    const keyB = getProjectPathForConfig()
    expect(keyA).not.toBe(keyB)
    expect(keyB).toBe(normalizePathForConfigKey(resolve(b)))
  })

  test('registers skills from the new directory .claude/skills', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-246-skill-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-246-skill-b-'))
    temps.push(a, b)
    const skillDir = join(b, '.claude', 'skills', 'cd-246-probe')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: cd-246-probe',
        'description: Probe skill registered by /cd apply-now',
        '---',
        '',
        'Used only by the 2.1.246 /cd skill-register test.',
      ].join('\n'),
    )
    clearDynamicSkills()
    setCwdState(a)
    setOriginalCwd(a)
    process.chdir(a)
    await relocateSessionCwd(b, 'cd_command')
    expect(getDynamicSkills().some(s => s.name === 'cd-246-probe')).toBe(true)
  })
})

describe('densable 2.1.246 #52 gated project grants notice', () => {
  test('parent-only trust + project allow rules → NOT applied notice', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'cd-246-gate-p-'))
    const child = join(parent, 'nested')
    mkdirSync(child)
    mkdirSync(join(child, '.claude'), { recursive: true })
    writeFileSync(
      join(child, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(echo *)'] } }),
    )
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
    setCwdState(parent)
    setOriginalCwd(parent)
    process.chdir(parent)
    const r = await relocateSessionCwd(child, 'cd_command')
    expect(r.modelMessage).toContain('they are NOT applied')
    expect(r.modelMessage).toContain('trusted only through a parent directory')
  })

  test('own trust latch suppresses the gated notice', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'cd-246-own-p-'))
    const child = join(parent, 'nested')
    mkdirSync(child)
    mkdirSync(join(child, '.claude'), { recursive: true })
    writeFileSync(
      join(child, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(echo *)'] } }),
    )
    temps.push(parent)
    acceptTrustForDirectory(child)
    setCwdState(parent)
    setOriginalCwd(parent)
    process.chdir(parent)
    const r = await relocateSessionCwd(child, 'cd_command')
    expect(r.modelMessage).not.toContain('they are NOT applied')
  })

  test('local-only git-tracked allow rules → NOT applied notice', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-246-loc-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-246-loc-b-'))
    temps.push(a, b)
    mkdirSync(join(b, '.claude'), { recursive: true })
    writeFileSync(
      join(b, '.claude', 'settings.local.json'),
      JSON.stringify({ permissions: { allow: ['Bash(echo *)'] } }),
    )
    const init = spawnSync('git', ['init'], { cwd: b, encoding: 'utf8' })
    expect(init.status).toBe(0)
    const add = spawnSync('git', ['add', '.claude/settings.local.json'], {
      cwd: b,
      encoding: 'utf8',
    })
    expect(add.status).toBe(0)
    setSessionTrustAccepted(true)
    resetTrustDialogAcceptedCacheForTesting()
    resetLocalSettingsGitTrackedCache()
    setCwdState(a)
    setOriginalCwd(a)
    process.chdir(a)
    const r = await relocateSessionCwd(b, 'cd_command')
    expect(r.projectGrantsGated).toBe(true)
    expect(r.modelMessage).toContain('they are NOT applied')
  })
})

describe('densable 2.1.246 #52 invalidateAllRenders', () => {
  test('relocate bumps ui.render version', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-246-rend-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-246-rend-b-'))
    temps.push(a, b)
    resetRenderVersionsForTests()
    setCwdState(a)
    setOriginalCwd(a)
    process.chdir(a)
    expect(getRenderVersion('ui.render')).toBe(0)
    await relocateSessionCwd(b, 'cd_command')
    expect(getRenderVersion('ui.render')).toBe(1)
  })

  test('invalidate notifies subscribers', () => {
    resetRenderVersionsForTests()
    let calls = 0
    const unsub = subscribeRenderInvalidation(() => {
      calls++
    })
    invalidateAllRenders()
    expect(calls).toBe(1)
    expect(getRenderVersion('ui.render')).toBe(1)
    unsub()
    invalidateAllRenders()
    expect(calls).toBe(1)
  })
})
