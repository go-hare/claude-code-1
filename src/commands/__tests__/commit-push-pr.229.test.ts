/**
 * densable 2.1.229 #28 — commit-push-pr narrow allow + dangerous-flag deny.
 */
import { describe, expect, mock, test } from 'bun:test'
import { matchWildcardPattern } from '../../utils/permissions/shellRuleMatching.js'

mock.module('bun:bundle', () => ({
  feature: (_name: string) => false,
}))

mock.module('src/utils/attribution.ts', () => ({
  getAttributionTexts: () => ({ commit: '', pr: '' }),
  getEnhancedPRAttribution: async () => undefined,
  countUserPromptsInMessages: () => 0,
}))

mock.module('src/utils/undercover.ts', () => ({
  isUndercover: () => false,
  getUndercoverInstructions: () => '',
  shouldShowUndercoverAutoNotice: () => false,
}))

mock.module('src/utils/promptShellExecution.ts', () => ({
  executeShellCommandsInPrompt: async (content: string) => content,
}))

// Do NOT mock src/utils/git.ts here — process-global mock.module would drop
// exports like RAW_GIT_DIFF_FLAGS and pollute other files in the same process.
// commit-push-pr only needs getDefaultBranch at runtime; unit tests for
// ALLOWED_TOOLS/DISALLOWED_TOOLS only read static exports.

const { __test, default: commitPushPr } = await import('../commit-push-pr.js')

describe('densable 2.1.229 #28 commit-push-pr tool lists', () => {
  test('allow is densable Y8e+BOn specific wildcards, not broad git push/commit:*', () => {
    const allow = __test.ALLOWED_TOOLS
    expect(allow).toContain('Bash(git commit -m *)')
    expect(allow).toContain('Bash(git push origin *)')
    expect(allow).toContain('Bash(git push -u origin *)')
    expect(allow).toContain('Bash(git checkout -b *)')
    expect(allow).toContain('Bash(git add *)')
    expect(allow).toContain('Bash(gh pr create --title * --body *)')
    expect(allow).toContain('ToolSearch')

    // densable BOn — no PowerShell checkout -b
    expect(allow).not.toContain('PowerShell(git checkout -b *)')
    // dual-wrap still covers other PowerShell patterns
    expect(allow).toContain('PowerShell(git commit -m *)')

    // not the pre-229 broad prefixes
    expect(allow.some(t => t === 'Bash(git push:*)')).toBe(false)
    expect(allow.some(t => t === 'Bash(git commit:*)')).toBe(false)
    expect(allow.some(t => t.includes('git push:*'))).toBe(false)
    expect(allow.some(t => t.includes('git commit:*'))).toBe(false)
  })

  test('disallowedTools includes densable dangerous flag patterns', () => {
    const deny = __test.DISALLOWED_TOOLS
    expect(deny).toContain('Bash(git commit *--no-veri*)')
    expect(deny).toContain('Bash(git push *--force*)')
    expect(deny).toContain('Bash(git push * -f*)')
    expect(deny).toContain('Bash(gh pr create *--body-file*)')
    // densable QIp exists in SEA but is NOT part of Vjb (commit-push-pr deny)
    expect(deny).not.toContain('Bash(git *--output*)')
    expect(deny).not.toContain('PowerShell(git *--output*)')
    expect(deny).toContain('PowerShell(git commit *--no-veri*)')
    expect(deny).toContain('PowerShell(git push *--force*)')
    // densable Vjb = 55 bare patterns × Y8e dual-wrap = 110
    expect(deny).toHaveLength(110)
  })

  test('command object surfaces allowedTools + disallowedTools', () => {
    const cmd = commitPushPr as {
      allowedTools?: string[]
      disallowedTools?: string[]
    }
    expect(cmd.allowedTools).toEqual(__test.ALLOWED_TOOLS)
    expect(cmd.disallowedTools).toEqual(__test.DISALLOWED_TOOLS)
  })

  test('deny globs do not false-positive common safe git commands', () => {
    // Patterns are bare (pre Y8e Bash/PowerShell wrap). Match against command text.
    const bare = __test.COMMIT_PUSH_PR_DENY_PATTERNS as readonly string[]
    const anyDeny = (cmd: string) =>
      bare.some(p => matchWildcardPattern(p, cmd))

    // Safe everyday forms must stay allow-side (prompt for permission, not hard deny).
    expect(anyDeny('git push -u origin HEAD')).toBe(false)
    expect(anyDeny('git push origin main')).toBe(false)
    expect(anyDeny('git commit -m test')).toBe(false)
    expect(anyDeny('git commit -m "fix: thing"')).toBe(false)
    expect(anyDeny('git add -A')).toBe(false)
    expect(anyDeny('gh pr create --title t --body b')).toBe(false)

    // Dangerous forms still match densable Vjb clusters.
    expect(anyDeny('git commit -m x --no-verify')).toBe(true)
    expect(anyDeny('git push --force origin main')).toBe(true)
    expect(anyDeny('git push origin main -o ci.skip')).toBe(true)
    expect(anyDeny('git commit -m x -t template')).toBe(true)
    expect(anyDeny('gh pr create --title t --body b --repo owner/repo')).toBe(
      true,
    )
  })
})
