import { afterEach, describe, expect, test } from 'bun:test'
import { REPLTool } from '@claude-code/builtin-tools/tools/REPLTool/REPLTool.js'
import type { ToolUseContext } from '../../../Tool.js'
import { REPL_PART_CAP } from '../constants.js'
import {
  clearCodeModeVmSession,
  elideReplOutputPart,
  executeCodeModeScript,
  planCodeModeFromSession,
  resetCodeModeRuntimeStateForTests,
  wrapReplToolForCodeMode,
} from '../executor.js'
import { pinCodeMode, unpinCodeMode } from '../optIn.js'

afterEach(() => {
  resetCodeModeRuntimeStateForTests()
  clearCodeModeVmSession()
  unpinCodeMode()
})

describe('Code Mode VM hardening & 2.1.328 1:1 alignment', () => {
  test('blocks all 5 host VM sandbox escape vectors', async () => {
    const invokeTool = async (name: string, input: Record<string, unknown>) => {
      if (name === 'Read' && input.file_path === 'fail') {
        throw new Error('host read failure')
      }
      if (name === 'Bash') {
        return { stdout: 'ok\n', stderr: '', exitCode: 0 }
      }
      return { content: 'hello', nested: [1, 2, 3] }
    }

    const escapeProbes = [
      `return console.constructor.constructor('return process.pid')()`,
      `return tools.constructor.constructor('return process.pid')()`,
      `return $('echo hi').nothrow.constructor('return process.pid')()`,
      `const r = await Read({ file_path: 'ok' }); return r.constructor.constructor('return process.pid')()`,
      `try { await Read({ file_path: 'fail' }) } catch (e) { return e.constructor.constructor('return process.pid')() }`,
    ]

    for (const probe of escapeProbes) {
      const res = await executeCodeModeScript({
        code: probe,
        invokeTool,
        timeoutMs: 2000,
      })
      expect(res.result).not.toContain(String(process.pid))
      expect(res.result).toMatch(/Error:/i)
    }
  })

  test('exposes realm-sealed $.escape and marks script-authored { raw } literals while rejecting external/mutated raw objects', async () => {
    const commands: string[] = []
    const invokeTool = async (name: string, input: Record<string, unknown>) => {
      if (name === 'Bash') {
        commands.push(String(input.command ?? ''))
        return { stdout: 'ok\n', stderr: '', exitCode: 0 }
      }
      return {}
    }

    // $.escape works
    const escRes = await executeCodeModeScript({
      code: `return [typeof $.escape, $.escape("a'b")]`,
      invokeTool,
    })
    const escParsed = JSON.parse(escRes.result) as [string, string]
    expect(escParsed[0]).toBe('function')
    expect(escParsed[1]).toBe(`'a'\\''b'`)

    // Script-authored { raw: "hello" } succeeds
    const rawOk = await executeCodeModeScript({
      code: `await $\`echo \${{ raw: "hello" }}\`; return 'ok'`,
      invokeTool,
    })
    expect(rawOk.result).toBe('ok')
    expect(commands.at(-1)).toBe('echo hello')

    // Parsed JSON { raw: "hello" } throws UNWRITTEN_RAW
    const rawParsed = await executeCodeModeScript({
      code: `const x = JSON.parse('{"raw":"hello"}'); await $\`echo \${x}\``,
      invokeTool,
    })
    expect(rawParsed.result).toContain('not a one-key {raw: ...} literal')

    // Mutated { raw: "ok" } literal throws UNWRITTEN_RAW
    const rawMutated = await executeCodeModeScript({
      code: `const r = { raw: "ok" }; r.raw = "evil"; await $\`echo \${r}\``,
      invokeTool,
    })
    expect(rawMutated.result).toContain('not a one-key {raw: ...} literal')
  })

  test('terminates infinite microtask recursion cleanly via function-entry budget instrumentation', async () => {
    const res = await executeCodeModeScript({
      code: `function spin() { return Promise.resolve().then(spin) }
await spin()`,
      invokeTool: async () => ({}),
      timeoutMs: 150,
    })
    expect(res.result).toMatch(/timed out|budget/i)
  })

  test('exposes PascalCase tool globals, self.log, preview, searchTools, describeTool, console ring buffer, and atob/btoa', async () => {
    const called: string[] = []
    const invokeTool = async (name: string) => {
      called.push(name)
      return { ok: true, tool: name }
    }

    const res = await executeCodeModeScript({
      code: `
        const r = await Read({ file_path: 'a.ts' })
        const b = await Bash({ command: 'echo 1' })
        self.log('from-self-log')
        const found = searchTools('Read')
        const desc = describeTool('Read')
        const prev = preview('x'.repeat(200), 40)
        const enc = btoa('hi')
        const dec = atob(enc)
        return {
          r,
          b,
          tail: console.tail(5),
          foundCount: found.length,
          descName: desc?.name,
          prevLen: prev.length,
          dec,
        }
      `,
      invokeTool,
      availableToolNames: ['Read', 'Bash', 'mcp__demo__ping'],
      toolDescriptors: [
        { name: 'Read', description: 'Read a file' },
        { name: 'Bash', description: 'Run a shell command' },
      ],
    })
    expect(called).toEqual(['Read', 'Bash'])
    expect(res.result).toContain('from-self-log')
    expect(res.result).toContain('"descName": "Read"')
    expect(res.result).toContain('"dec": "hi"')
  })

  test('elideReplOutputPart caps outputs at REPL_PART_CAP with 60%/40% head/tail elision', () => {
    expect(REPL_PART_CAP).toBe(30_000)
    const big = `${'A'.repeat(20_000)}${'B'.repeat(20_000)}`
    const elided = elideReplOutputPart(big, 1000)
    expect(elided).toContain('characters elided')
    expect(elided.startsWith('A'.repeat(600))).toBe(true)
    expect(elided.endsWith('B'.repeat(400))).toBe(true)
  })

  test('REPLTool & wrapReplToolForCodeMode align schema, aliases, toAutoClassifierInput, checkPermissions, and permissionNote', async () => {
    expect(REPLTool.aliases).toEqual(['Eval'])
    expect(
      REPLTool.inputSchema.safeParse({
        code: '1 + 1',
        description: 'Add two numbers',
        timeout: 5000,
      }).success,
    ).toBe(true)
    expect(
      REPLTool.toAutoClassifierInput?.({
        code: 'await Bash({ command: "ls" })',
      }),
    ).toBe('await Bash({ command: "ls" })')

    pinCodeMode(true)
    const wrapped = wrapReplToolForCodeMode(REPLTool, () => [])
    expect(wrapped.userFacingName?.({} as never)).toBe('Code')
    expect(wrapped.suppressesAlwaysAllowRule?.({} as never)).toBe(true)

    const note = (
      wrapped as {
        permissionNote?: (input: unknown, mode?: string) => string | undefined
      }
    ).permissionNote?.({ code: '1+1', description: 'sum' }, 'default')
    expect(note).toContain("Yes runs Claude's code.")
    expect(note).toContain("Claude's own summary of it")
    expect(note).toContain('Each tool call that needs approval')

    const autoCtx = {
      getAppState: () => ({
        toolPermissionContext: { mode: 'auto' },
      }),
    } as unknown as ToolUseContext
    const autoPerm = await wrapped.checkPermissions?.(
      { code: '1+1' } as never,
      autoCtx,
    )
    expect(autoPerm?.behavior).toBe('passthrough')

    const defaultCtx = {
      getAppState: () => ({
        toolPermissionContext: { mode: 'default' },
      }),
    } as unknown as ToolUseContext
    const defaultPerm = await wrapped.checkPermissions?.(
      { code: '1+1' } as never,
      defaultCtx,
    )
    expect(defaultPerm?.behavior).toBe('allow')
  })

  test('planCodeModeFromSession supports sdkUrlWorker takenOut degradation', () => {
    pinCodeMode(false)
    const notices: string[] = []
    const plan = planCodeModeFromSession(
      {
        replMode: true,
        sdkUrlWorker: true,
      },
      msg => notices.push(msg),
    )
    expect(plan.declined).toBe(true)
    expect(plan.takenOut?.notice).toContain('continues with the ordinary tools')
    expect(plan.takenOut?.reminder).toContain(
      'The variables and functions that your earlier scripts defined are gone.',
    )
    expect(notices.length).toBe(1)
  })
})
