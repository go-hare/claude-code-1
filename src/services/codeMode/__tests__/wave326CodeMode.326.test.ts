import { describe, expect, test } from 'bun:test'
import {
  buildCodeModeShellEnvPrefix,
  checkPrefixedCodeModeShellCommand,
  quoteCodeModeShellArg,
  renderCodeModeShellTemplate,
} from '../executor.js'
import {
  codeModeRefusalReasonText,
  findCodeModePrimitiveTool,
  registerCodeModePrimitiveToolsResolver,
  resolveCodeModePrimitiveTools,
} from '../optIn.js'

describe('Wave 326 Group 3 — Code Mode (#1, #74, #75, #76, #232, #233, #293)', () => {
  test('#233: updated refusal reason guidance texts explain what user can do', () => {
    expect(codeModeRefusalReasonText('own_settings')).toContain('settings.json')
    expect(codeModeRefusalReasonText('otel')).toContain('OpenTelemetry')
    expect(codeModeRefusalReasonText('provider')).toContain('Anthropic API')
    expect(codeModeRefusalReasonText('gate')).toContain(
      'updating or restarting Claude Code',
    )
  })

  test('#76: primitive tools resolver exposes hidden base tools to $.tool.call / $.tool.check', () => {
    const fakeBash = { name: 'Bash', aliases: ['Shell'] }
    const fakeRead = { name: 'Read' }
    const restore = registerCodeModePrimitiveToolsResolver(() => [
      fakeBash as never,
      fakeRead as never,
    ])
    try {
      const permCtx = {
        mode: 'default',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      }
      const resolved = resolveCodeModePrimitiveTools<{
        name: string
        aliases?: readonly string[]
      }>([], permCtx)
      expect(resolved.map(t => t.name)).toEqual(['Bash', 'Read'])
      // Without Eval in currentTools, findCodeModePrimitiveTool returns undefined
      expect(
        findCodeModePrimitiveTool<{
          name: string
          aliases?: readonly string[]
        }>('Bash', [], permCtx),
      ).toBeUndefined()
    } finally {
      restore()
    }
  })

  test('#293: $ shell helper rejects undefined/null, unverified raw, bad array positions, PowerShell smart quotes, and invalid env', () => {
    expect(() =>
      renderCodeModeShellTemplate(['echo ', ''], [undefined]),
    ).toThrow(/undefined/i)
    expect(() => renderCodeModeShellTemplate(['echo ', ''], [null])).toThrow(
      /null/i,
    )
    expect(() =>
      renderCodeModeShellTemplate(['echo ', ''], [{ raw: 'rm -rf /' }]),
    ).toThrow(/raw/i)
    expect(() => quoteCodeModeShellArg('hi\u2018there', 'powershell')).toThrow(
      /typographic quote/i,
    )
    expect(quoteCodeModeShellArg("hello'world")).toBe("'hello'\\''world'")

    // Array interpolation refused when glued inside a word or after redirection
    expect(() =>
      renderCodeModeShellTemplate(['echo foo', ''], [['a', 'b']]),
    ).toThrow(/word boundary|array/i)
    expect(() =>
      renderCodeModeShellTemplate(['echo hi > ', ''], [['a.txt', 'b.txt']]),
    ).toThrow(/redirect/i)
    expect(() => renderCodeModeShellTemplate(['echo hi > ', ''], [[]])).toThrow(
      /redirect/i,
    )
    // Valid array at word boundary succeeds
    expect(
      renderCodeModeShellTemplate(['git status ', ''], [['-s', '--branch']]),
    ).toBe("git status '-s' '--branch'")

    // Invalid .env() inputs rejected
    expect(() => buildCodeModeShellEnvPrefix('not-an-object')).toThrow()
    expect(() => buildCodeModeShellEnvPrefix({ 'BAD-KEY': '1' })).toThrow(
      /shell variable name/i,
    )
    expect(buildCodeModeShellEnvPrefix({ FOO_BAR: 'baz' })).toBe(
      "export FOO_BAR='baz'; ",
    )
  })

  test('#232 review fix: checkPrefixedCodeModeShellCommand strips PowerShell Set-Location/$env prefixes and checks PowerShell removal verbs', async () => {
    const seenCommands: string[] = []
    const fakePowerShellTool = {
      name: 'PowerShell',
      checkPermissions: async (input: { command: string }) => {
        seenCommands.push(input.command)
        return {
          behavior: 'deny',
          decisionReason: {
            circuitBreaker: 'dangerousRemoval',
            reason: 'Removal target uses a shell variable',
          },
        }
      },
    } as never

    // Set-Location + multiple $env: prefixes + Remove-Item
    const psRefusal = await checkPrefixedCodeModeShellCommand(
      fakePowerShellTool,
      {
        command:
          "Set-Location -LiteralPath 'C:\\Users\\o''brien' -ErrorAction Stop; $env:FOO = 'bar''baz'; $env:TWO = '2'; Remove-Item -Recurse -Force $target",
      },
      {} as never,
    )
    expect(psRefusal).toContain('This command was not run')
    expect(psRefusal).toContain('Removal target uses a shell variable')
    expect(seenCommands.at(-1)).toBe('Remove-Item -Recurse -Force $target')

    // Other PowerShell removal aliases (del, ri, rd, rmdir, erase)
    for (const verb of ['del', 'ri', 'rd', 'rmdir', 'erase']) {
      const res = await checkPrefixedCodeModeShellCommand(
        fakePowerShellTool,
        {
          command: `$env:X = '1'; ${verb} $target`,
        },
        {} as never,
      )
      expect(res).toContain('This command was not run')
      expect(seenCommands.at(-1)).toBe(`${verb} $target`)
    }

    // Non-removal PowerShell command is ignored
    const safeRes = await checkPrefixedCodeModeShellCommand(
      fakePowerShellTool,
      {
        command:
          "Set-Location -LiteralPath 'C:\\tmp' -ErrorAction Stop; Get-ChildItem",
      },
      {} as never,
    )
    expect(safeRes).toBeUndefined()

    // Unprefixed command is ignored (handled by normal permission check)
    const unprefixed = await checkPrefixedCodeModeShellCommand(
      fakePowerShellTool,
      { command: 'Remove-Item -Recurse $target' },
      {} as never,
    )
    expect(unprefixed).toBeUndefined()
  })
})
