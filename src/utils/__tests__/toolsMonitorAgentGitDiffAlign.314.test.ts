import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  emitSkillInvoked,
  resetSessionArmedMonitorKeysForTests,
  subscribeSkillInvoked,
} from '../plugins/pluginMonitors.js'
import {
  enforceThroughFamilyOnlyHookResult,
  type HookResult,
} from '../hooks.js'
import { withPrivateGitIndex } from '../gitDiff.js'

describe('Group 1 alignment 314 (#1197, #1235, #1278, #1376, #1386, #1420)', () => {
  afterEach(() => {
    resetSessionArmedMonitorKeysForTests()
  })

  test('#1197: emitSkillInvoked notifies subscribeSkillInvoked listeners and unsubscribes cleanly', () => {
    const seen: string[] = []
    const unsub = subscribeSkillInvoked(name => seen.push(name))
    emitSkillInvoked('deploy-check')
    unsub()
    emitSkillInvoked('after-unsub')
    expect(seen).toEqual(['deploy-check'])
  })

  test('#1197: recordSkillUsage emits skillInvoked event', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/utils/suggestions/skillUsageTracking.ts'),
      'utf8',
    )
    expect(src).toContain('emitSkillInvoked(skillName)')
  })

  test('#1235: runAgent gates clearHandbackDelivery on !hasLiveAgentKeepaliveChildren && !hasHandbackWaitKids', () => {
    const src = readFileSync(
      join(
        process.cwd(),
        'packages/builtin-tools/src/tools/AgentTool/runAgent.ts',
      ),
      'utf8',
    )
    expect(src).toContain('!hasLiveAgentKeepaliveChildren(agentId, registry)')
    expect(src).toContain('!hasHandbackWaitKids(agentId, registry)')
  })

  test('#1278: BashTool returns fullOutput on timeout backgrounding instead of empty stdout', () => {
    const src = readFileSync(
      join(
        process.cwd(),
        'packages/builtin-tools/src/tools/BashTool/BashTool.tsx',
      ),
      'utf8',
    )
    expect(src).toContain('timedOutAfterMs !== undefined ? fullOutput')
    expect(src).toContain(
      "interruptBackgroundingStarted || timedOutAfterMs !== undefined ? fullOutput : ''",
    )
  })

  test('#1376: withPrivateGitIndex isolates GIT_INDEX_FILE and sets GIT_OPTIONAL_LOCKS=0', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'cc-gitdiff-314-'))
    try {
      execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' })
      execFileSync('git', ['config', 'user.email', 'test@example.com'], {
        cwd: repo,
        stdio: 'ignore',
      })
      execFileSync('git', ['config', 'user.name', 'Test'], {
        cwd: repo,
        stdio: 'ignore',
      })
      writeFileSync(join(repo, 'a.txt'), 'hello\n')
      execFileSync('git', ['add', 'a.txt'], { cwd: repo, stdio: 'ignore' })
      execFileSync('git', ['commit', '-m', 'init'], {
        cwd: repo,
        stdio: 'ignore',
      })

      let capturedIndex: string | undefined
      await withPrivateGitIndex(join(repo, '.git'), async env => {
        capturedIndex = env.GIT_INDEX_FILE
        expect(env.GIT_OPTIONAL_LOCKS).toBe('0')
        expect(env.GIT_TERMINAL_PROMPT).toBe('0')
        expect(capturedIndex).toBeDefined()
        expect(capturedIndex).not.toBe(join(repo, '.git', 'index'))
      })
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('#1376: buildWorkspaceDiffResponse gitArgs always includes --no-optional-locks', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/bridge/buildWorkspaceDiffResponse.ts'),
      'utf8',
    )
    expect(src).toContain("'--no-optional-locks'")
    expect(src).toContain("'core.hooksPath=/dev/null'")
    expect(src).toContain("'core.fsmonitor='")
  })

  test('#1386: enforceThroughFamilyOnlyHookResult strips allow, updatedInput, classifierContext while keeping deny/ask', () => {
    const allowResult: HookResult = {
      hook: { type: 'command', command: 'echo ok' },
      outcome: 'success',
      permissionBehavior: 'allow',
      updatedInput: { command: 'rewritten' },
      classifierContext: 'secret',
      permissionRequestResult: { behavior: 'allow' },
    }
    enforceThroughFamilyOnlyHookResult(
      allowResult,
      { throughFamilyOnly: true },
      'PreToolUse',
      'Bash',
    )
    expect(allowResult.permissionBehavior).toBeUndefined()
    expect(allowResult.updatedInput).toBeUndefined()
    expect(allowResult.classifierContext).toBeUndefined()
    expect(allowResult.permissionRequestResult).toBeUndefined()

    const denyResult: HookResult = {
      hook: { type: 'command', command: 'echo deny' },
      outcome: 'success',
      permissionBehavior: 'deny',
      hookPermissionDecisionReason: 'blocked by bash hook',
      updatedInput: { command: 'rewritten' },
    }
    enforceThroughFamilyOnlyHookResult(
      denyResult,
      { throughFamilyOnly: true },
      'PreToolUse',
      'Bash',
    )
    expect(denyResult.permissionBehavior).toBe('deny')
    expect(denyResult.hookPermissionDecisionReason).toBe('blocked by bash hook')
    expect(denyResult.updatedInput).toBeUndefined()

    const askResult: HookResult = {
      hook: { type: 'command', command: 'echo ask' },
      outcome: 'success',
      permissionBehavior: 'ask',
    }
    enforceThroughFamilyOnlyHookResult(
      askResult,
      { throughFamilyOnly: true },
      'PreToolUse',
      'Bash',
    )
    expect(askResult.permissionBehavior).toBe('ask')
  })

  test('#1420: bashEditDiff private git config disables core.autocrlf', () => {
    const src = readFileSync(
      join(
        process.cwd(),
        'packages/builtin-tools/src/tools/BashTool/bashEditDiff.ts',
      ),
      'utf8',
    )
    expect(src).toContain('autocrlf = false')
  })
})
