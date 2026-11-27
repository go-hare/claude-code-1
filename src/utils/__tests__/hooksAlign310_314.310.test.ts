import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  applyOnFailureBlockToHookResult,
  MAX_CONCURRENT_MODEL_HOOKS_PER_SESSION,
  MAX_OVERDUE_MODEL_HOOKS_PER_SESSION,
  mergeHookGeneratorsWithModelCap,
  ModelHookSlotPool,
  resolveModelHookTimeoutMs,
  wrapPowerShellHookWithNoBashAstGuard,
} from '../hooks.js'

const hooksSrc = [
  'hooks.ts',
  'hooks/hookCore.ts',
  'hooks/hookShellRunner.ts',
  'hooks/hookOutputProcessor.ts',
  'hooks/hookConfigRegistry.ts',
  'hooks/hookModelSlotPool.ts',
  'hooks/hookEngine.ts',
  'hooks/hookEntryExecutor.ts',
  'hooks/hookOutsideReplEngine.ts',
  'hooks/hookToolEvents.ts',
  'hooks/hookSessionAndPromptEvents.ts',
  'hooks/hookLifecycleEvents.ts',
]
  .map(rel => readFileSync(join(__dirname, '..', rel), 'utf8'))
  .join('\n')

describe('#1203 Windows PreToolUse/PermissionRequest quoted-strings PowerShell guard', () => {
  type GuardHookArg = Parameters<typeof wrapPowerShellHookWithNoBashAstGuard>[1]

  test('wraps PreToolUse command without explicit shell with AST exit-127 check when Git Bash is missing', () => {
    const wrapped = wrapPowerShellHookWithNoBashAstGuard(
      '"C:\\path\\to\\script.ps1"',
      {
        type: 'command',
        command: '"C:\\path\\to\\script.ps1"',
      } as unknown as GuardHookArg,
      'PreToolUse',
      true,
      false,
    )
    expect(wrapped).toContain('$claudeOnlyStrings')
    expect(wrapped).toContain('exit 127')
  })

  test('does not wrap when shell is explicitly powershell or on non-Windows', () => {
    const explicitShell = wrapPowerShellHookWithNoBashAstGuard(
      '"echo"',
      {
        type: 'command',
        command: '"echo"',
        shell: 'powershell',
      } as unknown as GuardHookArg,
      'PreToolUse',
      true,
      false,
    )
    expect(explicitShell).not.toContain('exit 127')

    const nonWin = wrapPowerShellHookWithNoBashAstGuard(
      '"echo"',
      { type: 'command', command: '"echo"' } as unknown as GuardHookArg,
      'PreToolUse',
      false,
      false,
    )
    expect(nonWin).not.toContain('exit 127')
  })

  test('applyOnFailureBlockToHookResult emits exit code 127 quoted-strings guidance', () => {
    const res = applyOnFailureBlockToHookResult(
      {
        outcome: 'non_blocking_error',
        hook: { type: 'command', command: '"C:\\hook.sh"' },
        message: {
          type: 'attachment',
          attachment: {
            type: 'hook_non_blocking_error',
            stderr: '',
            exitCode: 127,
          },
        } as never,
      },
      'PreToolUse',
      undefined,
      true,
      false,
    )
    expect(res.outcome).toBe('blocking')
    expect(res.blockingError?.blockingError).toContain(
      'The hook ended with exit code 127. If its command is only quoted strings, PowerShell started no program.',
    )
  })
})

describe('#1336 prompt/agent hooks session slot pool & timeout clamp', () => {
  test('clamps timeout < 1s to 1s (1000ms)', () => {
    expect(resolveModelHookTimeoutMs({ timeout: 0.2 }, 30_000)).toBe(1000)
    expect(resolveModelHookTimeoutMs({ timeout: 5 }, 30_000)).toBe(5000)
    expect(resolveModelHookTimeoutMs({}, 30_000)).toBe(30_000)
  })

  test('session-wide limits are 24 concurrent + 12 overdue', () => {
    expect(MAX_CONCURRENT_MODEL_HOOKS_PER_SESSION).toBe(24)
    expect(MAX_OVERDUE_MODEL_HOOKS_PER_SESSION).toBe(12)
  })

  test('ModelHookSlotPool enforces limit and releases FIFO waiters', async () => {
    const pool = new ModelHookSlotPool()
    const ac = new AbortController()
    const r1 = await pool.acquire('model hooks', 1, ac.signal)
    expect(r1).toBeDefined()
    expect(pool.wouldWait('model hooks', 1)).toBe(true)

    let acquiredSecond = false
    const p2 = pool.acquire('model hooks', 1, ac.signal).then(r => {
      acquiredSecond = true
      return r
    })
    await Promise.resolve()
    expect(acquiredSecond).toBe(false)

    r1!()
    const r2 = await p2
    expect(acquiredSecond).toBe(true)
    r2!()
    expect(pool.wouldWait('model hooks', 1)).toBe(false)
  })

  test('mergeHookGeneratorsWithModelCap runs model hooks with sessionSlotCtx', async () => {
    async function* makeGen(val: number): AsyncGenerator<number, void> {
      yield val
    }
    const slots = {
      slots: new ModelHookSlotPool(),
      holder: new (await import('async_hooks')).AsyncLocalStorage<{
        isHeld: boolean
      }>(),
    }
    const ac = new AbortController()
    const out: number[] = []
    for await (const v of mergeHookGeneratorsWithModelCap(
      [
        { isModelHook: true, generator: makeGen(1), timeoutMs: 1000 },
        { isModelHook: false, generator: makeGen(2) },
      ],
      12,
      { slots, signal: ac.signal, limitMs: 5000 },
    )) {
      out.push(v)
    }
    expect(out.sort()).toEqual([1, 2])
  })
})

describe('#1375 PreCompact hook output cut at 10,000 chars', () => {
  test('executePreCompactHooks truncates each hook output at PRECOMPACT_OUTPUT_LIMIT (10_000)', () => {
    expect(hooksSrc).toContain('const PRECOMPACT_OUTPUT_LIMIT = 10_000')
    expect(hooksSrc).toContain(
      'output cut: ${trimmed.length} characters is over the ${PRECOMPACT_OUTPUT_LIMIT}-character limit',
    )
    expect(hooksSrc).toContain(
      'sliceUtf16Safe(trimmed, PRECOMPACT_OUTPUT_LIMIT)',
    )
  })
})
