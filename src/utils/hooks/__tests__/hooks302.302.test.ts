import { describe, expect, test } from 'bun:test'
import {
  MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT,
  mergeHookGeneratorsWithModelCap,
  shouldBlockNoBashGuard,
  wrapPowerShellHookCommand,
} from '../../hooks.js'

describe('hooks v2.1.302 & v2.1.309 (#928, #1149)', () => {
  test('#928: MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT is 12 and caps model hooks while non-model hooks run uncapped', async () => {
    expect(MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT).toBe(12)

    let activeModel = 0
    let maxActiveModel = 0
    const modelEntries = Array.from({ length: 16 }, (_, idx) => ({
      isModelHook: true,
      generator: (async function* () {
        activeModel++
        maxActiveModel = Math.max(maxActiveModel, activeModel)
        await new Promise(resolve => setTimeout(resolve, 15))
        activeModel--
        yield `model-${idx}`
      })(),
    }))

    const nonModelEntry = {
      isModelHook: false,
      generator: (async function* () {
        yield 'cmd-0'
      })(),
    }

    const results: string[] = []
    for await (const r of mergeHookGeneratorsWithModelCap([
      nonModelEntry,
      ...modelEntries,
    ])) {
      results.push(r)
    }

    expect(results).toHaveLength(17)
    expect(results).toContain('cmd-0')
    expect(maxActiveModel).toBeLessThanOrEqual(12)
    expect(maxActiveModel).toBeGreaterThan(1)
  })

  test('#1149: shouldBlockNoBashGuard applies to shell: powershell on Windows without Git Bash', () => {
    expect(
      shouldBlockNoBashGuard(
        { type: 'command', shell: 'powershell' },
        'PreToolUse',
        true,
        false,
      ),
    ).toBe(true)

    expect(
      shouldBlockNoBashGuard(
        { type: 'command', shell: 'powershell' },
        'PermissionRequest',
        true,
        false,
      ),
    ).toBe(true)

    // With Git Bash present, not blocked by no-bash guard
    expect(
      shouldBlockNoBashGuard(
        { type: 'command', shell: 'powershell' },
        'PreToolUse',
        true,
        true,
      ),
    ).toBe(false)

    // onFailure: 'continue' opts out
    expect(
      shouldBlockNoBashGuard(
        { type: 'command', shell: 'powershell', onFailure: 'continue' },
        'PreToolUse',
        true,
        false,
      ),
    ).toBe(false)
  })

  test('#1149: wrapPowerShellHookCommand propagates exit code 2 except PermissionRequest and script headers', () => {
    const wrapped = wrapPowerShellHookCommand('my-hook.exe', 'PreToolUse')
    expect(wrapped).toContain('if ($LASTEXITCODE -eq 2) { exit 2 }')

    const permReq = wrapPowerShellHookCommand(
      'my-hook.exe',
      'PermissionRequest',
    )
    expect(permReq).toBe('my-hook.exe')

    const withParamBlock = wrapPowerShellHookCommand(
      'param($x)\nprocess { exit 0 }',
      'PreToolUse',
    )
    expect(withParamBlock).toBe('param($x)\nprocess { exit 0 }')
  })
})
