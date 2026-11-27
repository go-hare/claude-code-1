import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  isGoalOwnedStopHook,
  markGoalStopHook,
} from '../../../commands/goal.js'
import { HookCommandSchema } from '../../../schemas/hooks.js'
import { isOnFailureBlock } from '../../hooks.js'
import { isModModelUsageLimitError } from '../../plugins/functionHooksModules.js'
import {
  classifyStopHookErrorHeadline,
  formatCloudUserPromptSubmitBlockError,
  formatOutsideReplHookFailures,
  STOP_HOOK_FAILED_HEADLINE,
  STOP_HOOK_PROBLEM_HEADLINE,
} from '../hookErrorDisplay.js'
import { getHookEventMetadata } from '../hooksConfigManager.js'
import {
  hookSourceDescriptionDisplayString,
  hookSourceHeaderDisplayString,
  hookSourceInlineDisplayString,
  sortMatchersByPriority,
} from '../hooksSettings.js'
import {
  addSessionHook,
  getSessionHooks,
  removeSessionHook,
} from '../sessionHooks.js'
import { pinHookAttachment } from '../toolCallContextPack.js'

describe('Wave 327-328 Group 3 — Hooks / Goal / Mods (10 items)', () => {
  test('#406: isModModelUsageLimitError detects API usage/rate limits immediately', () => {
    expect(isModModelUsageLimitError({ status: 429 })).toBe(true)
    expect(isModModelUsageLimitError({ apiError: 'rate_limit' })).toBe(true)
    expect(
      isModModelUsageLimitError(new Error('Rate limit reached for account')),
    ).toBe(true)
    expect(
      isModModelUsageLimitError(new Error('Usage limit exceeded, try again')),
    ).toBe(true)
    expect(isModModelUsageLimitError(new Error('invalid json'))).toBe(false)
  })

  test('#431: formatCloudUserPromptSubmitBlockError formats blocking detail cleanly', () => {
    expect(formatCloudUserPromptSubmitBlockError('policy violated')).toBe(
      'UserPromptSubmit hook blocked this message: policy violated',
    )
    expect(formatCloudUserPromptSubmitBlockError('')).toBe(
      'UserPromptSubmit hook blocked this message.',
    )
  })

  test('#432: formatOutsideReplHookFailures reports failing SessionEnd, CwdChanged, and FileChanged hooks even with empty output', () => {
    const errors = formatOutsideReplHookFailures('SessionEnd', [
      { command: 'ok.sh', succeeded: true, output: '' },
      {
        command: 'cancelled.sh',
        succeeded: false,
        output: '',
        cancelled: true,
      },
      { command: 'silent-fail.sh', succeeded: false, output: '' },
      { command: 'noisy-fail.sh', succeeded: false, output: 'boom\n' },
    ])
    expect(errors).toEqual([
      'SessionEnd hook failed (silent-fail.sh)',
      'SessionEnd hook failed (noisy-fail.sh): boom',
    ])

    const envErrors = formatOutsideReplHookFailures('FileChanged', [
      { command: 'watch.sh', succeeded: false, output: '' },
    ])
    expect(envErrors).toEqual(['FileChanged hook failed (watch.sh)'])
  })

  test('#433: classifyStopHookErrorHeadline distinguishes failed-to-run from reported-a-problem', () => {
    const failed = classifyStopHookErrorHeadline({
      failedToRun: true,
      reason: 'exit code 1',
    })
    expect(failed.headline).toBe(STOP_HOOK_FAILED_HEADLINE)
    expect(failed.color).toBe('error')

    const problem = classifyStopHookErrorHeadline({
      failedToRun: false,
      reason: 'tests still failing',
    })
    expect(problem.headline).toBe(STOP_HOOK_PROBLEM_HEADLINE)
    expect(problem.color).toBe('warning')
  })

  test('#435: pinHookAttachment deduplicates long persisted PostToolUse outputs regardless of ephemeral save path', () => {
    const first = {
      type: 'hook_additional_context',
      content:
        '<persisted-output>\nFull output saved to: /tmp/claude-out-aaa111.txt\npreview line\n</persisted-output>',
    }
    const second = {
      type: 'hook_additional_context',
      content:
        '<persisted-output>\nFull output saved to: /tmp/claude-out-bbb222.txt\npreview line\n</persisted-output>',
    }
    expect(pinHookAttachment(first)).toBe(pinHookAttachment(second))

    // Different actual preview content produces different pin
    const different = {
      type: 'hook_additional_context',
      content:
        '<persisted-output>\nFull output saved to: /tmp/claude-out-bbb222.txt\nother preview\n</persisted-output>',
    }
    expect(pinHookAttachment(first)).not.toBe(pinHookAttachment(different))
  })

  test('#454: /hooks includes flagSettings (--settings) labels and sorts ahead of file sources', () => {
    expect(hookSourceDescriptionDisplayString('flagSettings')).toBe(
      'Startup settings (--settings option)',
    )
    expect(hookSourceHeaderDisplayString('flagSettings')).toBe(
      'Startup settings',
    )
    expect(hookSourceInlineDisplayString('flagSettings')).toBe('Startup')

    const sorted = sortMatchersByPriority(
      ['Bash', 'Edit'],
      {
        PreToolUse: {
          Bash: [
            {
              event: 'PreToolUse',
              config: { type: 'command', command: 'echo user' },
              source: 'userSettings',
            },
          ],
          Edit: [
            {
              event: 'PreToolUse',
              config: { type: 'command', command: 'echo flag' },
              source: 'flagSettings',
            },
          ],
        },
      },
      'PreToolUse',
    )
    expect(sorted).toEqual(['Edit', 'Bash'])
  })

  test('#470: /hooks help metadata does not name non-existent input fields', () => {
    const meta = getHookEventMetadata(['Bash', 'Read'])
    const permReq = meta.PermissionRequest.description
    expect(permReq).not.toContain('tool_use_id')

    const postFailure = meta.PostToolUseFailure.description
    expect(postFailure).not.toContain('error_type')
    expect(postFailure).not.toContain('is_timeout')

    const sessionEnd = meta.SessionEnd.description
    expect(sessionEnd).not.toContain('inputs')
    expect(sessionEnd).not.toContain('response')

    const subagentStart = meta.SubagentStart.description
    expect(subagentStart).toContain('agent_id')
  })

  test('#542: mcp_tool hook schema accepts onFailure: "block" and isOnFailureBlock recognizes it', () => {
    const parsed = HookCommandSchema().safeParse({
      type: 'mcp_tool',
      server: 'guard',
      tool: 'check',
      onFailure: 'block',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(isOnFailureBlock(parsed.data)).toBe(true)
    }

    const parsedIgnore = HookCommandSchema().safeParse({
      type: 'mcp_tool',
      server: 'guard',
      tool: 'check',
    })
    expect(parsedIgnore.success).toBe(true)
    if (parsedIgnore.success) {
      expect(isOnFailureBlock(parsedIgnore.data)).toBe(false)
    }
  })

  test('#607: /goal Stop hook ownership uses identity so identically worded skill/other hooks are never removed', () => {
    const wording = 'Keep going until all tests pass'
    const goalHook = markGoalStopHook({ type: 'prompt', prompt: wording })
    const skillHook = { type: 'prompt' as const, prompt: wording }
    const otherHook = { type: 'prompt' as const, prompt: wording }

    expect(isGoalOwnedStopHook(goalHook)).toBe(true)
    expect(isGoalOwnedStopHook(skillHook)).toBe(false)
    expect(isGoalOwnedStopHook(otherHook)).toBe(false)

    // Removing goalHook with matchByIdentity preserves skillHook and otherHook
    let appState: {
      sessionHooks: Map<string, { hooks: Map<string, unknown[]> }>
    } = {
      sessionHooks: new Map(),
    }
    const setAppState = (
      updater: (prev: typeof appState) => typeof appState,
    ) => {
      appState = updater(appState)
    }
    addSessionHook(setAppState as never, 'sess-1', 'Stop', '', goalHook)
    addSessionHook(
      setAppState as never,
      'sess-1',
      'Stop',
      '',
      skillHook,
      undefined,
      '/skills/my-skill',
    )
    addSessionHook(setAppState as never, 'sess-1', 'Stop', '', otherHook)

    removeSessionHook(setAppState as never, 'sess-1', 'Stop', goalHook, {
      skillRoot: undefined,
      matchByIdentity: true,
    })

    const remainingStopMatchers =
      getSessionHooks(appState as never, 'sess-1', 'Stop').get('Stop') ?? []
    const remainingHooks = remainingStopMatchers.flatMap(m => m.hooks)
    expect(remainingHooks).not.toContain(goalHook)
    expect(remainingHooks).toContain(skillHook)
    expect(remainingHooks).toContain(otherHook)
  })

  test('#667: managed PostToolUse pass short-circuits when capture.deny is set (refused before running)', () => {
    const execDir = resolve(
      import.meta.dir,
      '../../../services/tools/execution',
    )
    const src = [
      readFileSync(
        resolve(import.meta.dir, '../../../services/tools/toolExecution.ts'),
        'utf8',
      ),
      ...readdirSync(execDir)
        .filter(f => f.endsWith('.ts'))
        .sort()
        .map(f => readFileSync(join(execDir, f), 'utf8')),
    ].join('\n')
    const idx = src.indexOf('Official 2.1.328 (#667)')
    expect(idx).toBeGreaterThan(-1)
    const snippet = src.slice(idx, idx + 350)
    expect(snippet).toContain('if (capture.deny !== undefined)')
    expect(snippet).toContain('return messages')
  })
})
