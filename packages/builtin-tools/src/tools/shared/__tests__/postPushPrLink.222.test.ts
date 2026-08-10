/**
 * densable 2.1.222 #7 — post-push PR session link (RPo / ndn / jwd / Pc_ / Ic_ / Rc_ / K$s).
 *
 * Pure helpers + source wire-up only (no bootstrap/state import — that graph
 * hangs under bun:test on this host when pulled via gitOperationTracking).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  PENDING_BRANCH_LINK_MAX_ATTEMPTS,
  extractPushTargetBranch,
  isValidPendingBranchName,
  parsePrNumberFromText,
  parsePrUrl,
  pendingBranchLinkKey,
} from '../gitOperationTracking.js'

/**
 * densable Ic_/Rc_/Pc_ Map logic in pure form (mirrors production, no bootstrap).
 */
function pendingBranchLinkMapOps() {
  const map = new Map<
    string,
    { cwd: string; branch: string; attempts: number }
  >()
  const MAX = 8
  const register = (cwd: string, branch: string): void => {
    if (!isValidPendingBranchName(branch)) return
    const key = pendingBranchLinkKey(cwd, branch)
    map.delete(key)
    if (map.size >= MAX) {
      const oldest = map.keys().next().value
      if (oldest !== undefined) map.delete(oldest)
    }
    map.set(key, { cwd, branch, attempts: 0 })
  }
  const clearCwd = (cwd: string): void => {
    for (const [key, entry] of map) {
      if (entry.cwd === cwd) map.delete(key)
    }
  }
  const retryEligible = (command: string): boolean => {
    if (map.size === 0) return false
    return /\b(?:git|gh|glab|curl)\b/.test(command)
  }
  const bumpAttemptsOrDrop = (cwd: string, maxAttempts: number): string[] => {
    const dropped: string[] = []
    for (const [key, entry] of map) {
      if (entry.cwd !== cwd) continue
      if (entry.attempts >= maxAttempts) {
        map.delete(key)
        dropped.push(entry.branch)
        continue
      }
      entry.attempts++
    }
    return dropped
  }
  return { map, register, clearCwd, retryEligible, bumpAttemptsOrDrop }
}

describe('densable 2.1.222 #7 post-push PR link helpers', () => {
  test('parsePrUrl: github / ghe / gitlab / bitbucket hosts', () => {
    expect(parsePrUrl('https://github.com/acme/app/pull/42')).toEqual({
      prNumber: 42,
      prUrl: 'https://github.com/acme/app/pull/42',
      prRepository: 'acme/app',
      provider: 'github',
    })
    expect(
      parsePrUrl('https://ghe.example.com/org/repo/pull/7')?.provider,
    ).toBe('github-enterprise')
    expect(
      parsePrUrl('https://gitlab.com/group/proj/-/merge_requests/9'),
    ).toMatchObject({
      prNumber: 9,
      prRepository: 'group/proj',
      provider: 'gitlab',
    })
    expect(
      parsePrUrl('https://bitbucket.org/ws/repo/pull-requests/3'),
    ).toMatchObject({
      prNumber: 3,
      provider: 'bitbucket',
    })
    expect(parsePrUrl('not a url')).toBeNull()
  })

  test('extractPushTargetBranch: densable f is colon-refspec only', () => {
    expect(
      extractPushTargetBranch('git push origin HEAD:refs/heads/feature-x'),
    ).toBe('feature-x')
    expect(extractPushTargetBranch('git push origin main:feature-y')).toBe(
      'feature-y',
    )
    // plain branch is NOT f — current-branch path covers it
    expect(extractPushTargetBranch('git push origin feature-z')).toBeUndefined()
    expect(extractPushTargetBranch('git push')).toBeUndefined()
    expect(
      extractPushTargetBranch('git push -u origin HEAD:refs/heads/foo'),
    ).toBe('foo')
  })

  test('isValidPendingBranchName rejects HEAD / flags / numeric', () => {
    expect(isValidPendingBranchName('feature/ok')).toBe(true)
    expect(isValidPendingBranchName('HEAD')).toBe(false)
    expect(isValidPendingBranchName('-u')).toBe(false)
    expect(isValidPendingBranchName('42')).toBe(false)
    expect(isValidPendingBranchName('#42')).toBe(false)
  })

  test('pendingBranchLinkKey joins cwd\\0branch', () => {
    expect(pendingBranchLinkKey('/a', 'b')).toBe('/a\0b')
  })

  test('parsePrNumberFromText densable Kwd', () => {
    expect(parsePrNumberFromText('✓ Merged pull request acme/app#42')).toEqual({
      prNumber: 42,
      prRepository: 'acme/app',
    })
    expect(parsePrNumberFromText('✓ Closed pull request #9')).toEqual({
      prNumber: 9,
      prRepository: undefined,
    })
  })

  test('PENDING_BRANCH_LINK_MAX_ATTEMPTS is densable kc_=5', () => {
    expect(PENDING_BRANCH_LINK_MAX_ATTEMPTS).toBe(5)
  })
})

describe('densable 2.1.222 #7 Ic_/Rc_/Pc_ map semantics', () => {
  test('register + clear cwd (Ic_/Rc_)', () => {
    const ops = pendingBranchLinkMapOps()
    ops.register('/tmp/repo-222', 'feature/a')
    ops.register('/tmp/other', 'feature/b')
    expect(ops.map.size).toBe(2)
    ops.clearCwd('/tmp/repo-222')
    expect(ops.map.size).toBe(1)
    expect([...ops.map.values()].map(e => e.branch)).toEqual(['feature/b'])
  })

  test('caps at 8 and re-register resets attempts', () => {
    const ops = pendingBranchLinkMapOps()
    for (let i = 0; i < 9; i++) {
      ops.register('/tmp/repo-222', `branch-${i}`)
    }
    expect(ops.map.size).toBe(8)
    expect(ops.map.has(pendingBranchLinkKey('/tmp/repo-222', 'branch-0'))).toBe(
      false,
    )
    const key = pendingBranchLinkKey('/tmp/repo-222', 'branch-8')
    ops.map.get(key)!.attempts = 3
    ops.register('/tmp/repo-222', 'branch-8')
    expect(ops.map.get(key)!.attempts).toBe(0)
  })

  test('rejects invalid branch names', () => {
    const ops = pendingBranchLinkMapOps()
    ops.register('/tmp/repo-222', 'HEAD')
    ops.register('/tmp/repo-222', '-u')
    ops.register('/tmp/repo-222', '42')
    expect(ops.map.size).toBe(0)
  })

  test('Pc_ only on git/gh/glab/curl when map non-empty; drops at max attempts', () => {
    const ops = pendingBranchLinkMapOps()
    expect(ops.retryEligible('git status')).toBe(false)
    ops.register('/tmp/repo-222', 'feature/local')
    expect(ops.retryEligible('git status')).toBe(true)
    expect(ops.retryEligible('gh pr list')).toBe(true)
    expect(ops.retryEligible('ls -la')).toBe(false)

    const key = pendingBranchLinkKey('/tmp/repo-222', 'feature/local')
    ops.map.get(key)!.attempts = PENDING_BRANCH_LINK_MAX_ATTEMPTS
    const dropped = ops.bumpAttemptsOrDrop(
      '/tmp/repo-222',
      PENDING_BRANCH_LINK_MAX_ATTEMPTS,
    )
    expect(dropped).toEqual(['feature/local'])
    expect(ops.map.has(key)).toBe(false)
  })
})

describe('densable 2.1.222 #7 RPo control-flow fragments', () => {
  function densableShouldSchedulePushDiscovery(
    command: string,
    exitCode: number,
    hasPrAction: boolean,
  ): boolean {
    if (exitCode !== 0) return false
    if (hasPrAction) return false
    return /\bgit(?:\s+-[cC]\s+\S+|\s+--\S+=\S+)*\s+push\b/.test(command)
  }

  function densableCheckoutPrNumber(command: string): string | undefined {
    return command.match(
      /\bgh\s+pr\s+checkout\b[^&|;]*\s(\d+)(?=\s|$|[&|;])/,
    )?.[1]
  }

  function densableIsDryRunPush(command: string): boolean {
    const after =
      (
        command.split(/\bgit(?:\s+-[cC]\s+\S+|\s+--\S+=\S+)*\s+push\b/)[1] ?? ''
      ).split(/[&|;\n]/)[0] ?? ''
    return /(?:^|\s)(?:-n|--dry-run)(?=\s|$)/.test(after)
  }

  test('push success without PR action schedules discovery', () => {
    expect(
      densableShouldSchedulePushDiscovery('git push origin HEAD', 0, false),
    ).toBe(true)
    expect(
      densableShouldSchedulePushDiscovery('git push origin HEAD', 1, false),
    ).toBe(false)
    expect(
      densableShouldSchedulePushDiscovery('gh pr create --title t', 0, true),
    ).toBe(false)
  })

  test('explicit branch only from colon refspec', () => {
    expect(
      extractPushTargetBranch('git push origin HEAD:refs/heads/feature'),
    ).toBe('feature')
    expect(extractPushTargetBranch('git push origin feature')).toBeUndefined()
  })

  test('gh pr checkout extracts PR number', () => {
    expect(densableCheckoutPrNumber('gh pr checkout 42')).toBe('42')
    expect(densableCheckoutPrNumber('gh pr checkout 42 && echo ok')).toBe('42')
    expect(densableCheckoutPrNumber('gh pr create')).toBeUndefined()
  })

  test('dry-run push is detected (zwd)', () => {
    expect(densableIsDryRunPush('git push --dry-run origin HEAD')).toBe(true)
    expect(densableIsDryRunPush('git push -n origin HEAD')).toBe(true)
    expect(densableIsDryRunPush('git push origin HEAD')).toBe(false)
  })
})

describe('densable 2.1.222 #7 wire-up source', () => {
  test('gitOperationTracking has RPo push path + Pc_ retry + K$s create', () => {
    const src = readFileSync(
      join(import.meta.dir, '../gitOperationTracking.ts'),
      'utf8',
    )
    expect(src).toContain('registerPendingBranchLink')
    expect(src).toContain('retryPendingBranchLinks')
    expect(src).toContain('schedulePostPushPrDiscovery')
    expect(src).toContain('resolvePrViaGhView')
    expect(src).toContain('linkPrFromCreateStdout')
    expect(src).toContain('PENDING_BRANCH_LINK_MAX_ATTEMPTS = 5')
    expect(src).toContain('GH_PR_CHECKOUT_RE')
    expect(src).toContain('getPendingBranchLinks')
    expect(src).toContain('clearPendingBranchLinksForCwd')
    // densable: push without concurrent PR action
    expect(src).toMatch(/GIT_PUSH_RE\.test\(command\)\s*&&\s*!prHit/)
    // densable K$s on create + curl REST
    expect(src).toContain('linkPrFromCreateStdout(stdout)')
    // densable Pc_ always at end of success path
    expect(src).toContain('retryPendingBranchLinks(command)')
    // densable f: colon-only explicit branch
    expect(src).toContain("replace(/^refs\\/heads\\//, '')")
  })

  test('bootstrap state exports Lzr pendingBranchLinks', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../../../../src/bootstrap/state.ts'),
      'utf8',
    )
    expect(src).toContain('pendingBranchLinks')
    expect(src).toContain('getPendingBranchLinks')
    expect(src).toContain('2.1.222 #7')
  })

  test('BashTool and PowerShellTool call trackGitOperations', () => {
    const bash = readFileSync(
      join(import.meta.dir, '../../BashTool/BashTool.tsx'),
      'utf8',
    )
    const ps = readFileSync(
      join(import.meta.dir, '../../PowerShellTool/PowerShellTool.tsx'),
      'utf8',
    )
    expect(bash).toContain('trackGitOperations(input.command, result.code')
    expect(ps).toContain('trackGitOperations(input.command, result.code')
  })
})
