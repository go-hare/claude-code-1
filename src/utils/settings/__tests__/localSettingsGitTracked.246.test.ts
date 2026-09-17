import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import {
  setCwdState,
  setOriginalCwd,
  setSessionTrustAccepted,
} from '../../../bootstrap/state.js'
import {
  getProjectPathForConfig,
  resetTrustDialogAcceptedCacheForTesting,
} from '../../config.js'
import {
  isHomeOrDotClaudeWorkspace,
  isLocalSettingsGitTracked,
  probeLocalSettingsGitTrackedAt,
  resetLocalSettingsGitTrackedCache,
} from '../localSettingsGitTracked.js'

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
  // Memoized with no key, so the first caller in the process pins it for every
  // later one — setCwdState/chdir alone will not move it. Production clears it
  // the same way on /cd (cdCommand `Qte`).
  getProjectPathForConfig.cache?.clear?.()
  resetTrustDialogAcceptedCacheForTesting()
  resetLocalSettingsGitTrackedCache()
})

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  expect(result.status).toBe(0)
}

describe('densable 2.1.246 #52 Hte / XB', () => {
  test('YB: originalCwd === cwd/.claude is home-like', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hte-yb-'))
    temps.push(cwd)
    expect(isHomeOrDotClaudeWorkspace(cwd, join(cwd, '.claude'))).toBe(true)
  })

  test('XB: $HOME is untracked', () => {
    expect(probeLocalSettingsGitTrackedAt(homedir())).toBe('untracked')
  })

  test('XB: symlink .claude is tracked', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hte-sym-'))
    const target = mkdtempSync(join(tmpdir(), 'hte-sym-tgt-'))
    temps.push(dir, target)
    mkdirSync(join(target, '.claude'), { recursive: true })
    try {
      symlinkSync(join(target, '.claude'), join(dir, '.claude'), 'dir')
    } catch {
      return
    }
    expect(probeLocalSettingsGitTrackedAt(dir)).toBe('tracked')
  })

  test('XB: ls-files match is tracked; miss is untracked', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hte-ls-'))
    temps.push(dir)
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(
      join(dir, '.claude', 'settings.local.json'),
      JSON.stringify({ permissions: { allow: ['Bash(echo *)'] } }),
    )
    git(dir, ['init'])
    expect(probeLocalSettingsGitTrackedAt(dir)).toBe('untracked')
    git(dir, ['add', '.claude/settings.local.json'])
    expect(probeLocalSettingsGitTrackedAt(dir)).toBe('tracked')
  })

  // The probe reports 'indeterminate' whenever the answer is unknowable rather
  // than negative: not a git repository, git missing from PATH, git vanishing
  // between lookup and spawn, or an unexpected throw. All of those must defer
  // to the caller instead of resolving to the permissive 'untracked'.
  test('XB: indeterminate probe defers to the caller policy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hte-indet-'))
    temps.push(dir)
    mkdirSync(join(dir, '.claude'), { recursive: true })
    expect(probeLocalSettingsGitTrackedAt(dir)).toBe('indeterminate')

    setCwdState(dir)
    setOriginalCwd(dir)
    setSessionTrustAccepted(true)
    getProjectPathForConfig.cache?.clear?.()
    resetTrustDialogAcceptedCacheForTesting()

    resetLocalSettingsGitTrackedCache()
    expect(isLocalSettingsGitTracked({ onIndeterminate: 'tracked' })).toBe(true)
    resetLocalSettingsGitTrackedCache()
    expect(isLocalSettingsGitTracked({ onIndeterminate: 'untracked' })).toBe(
      false,
    )
  })

  test('Hte untrusted non-home repo treats local as tracked', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hte-untrust-'))
    temps.push(dir)
    git(dir, ['init'])
    setCwdState(dir)
    setOriginalCwd(dir)
    process.chdir(dir)
    setSessionTrustAccepted(false)
    getProjectPathForConfig.cache?.clear?.()
    resetTrustDialogAcceptedCacheForTesting()
    resetLocalSettingsGitTrackedCache()
    expect(isLocalSettingsGitTracked({ onIndeterminate: 'untracked' })).toBe(
      true,
    )
  })
})
