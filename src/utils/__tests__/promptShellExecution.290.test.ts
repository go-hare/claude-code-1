import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { BashTool } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import type { Tool } from 'src/Tool.js'
import { MalformedCommandError } from '../errors.js'
import {
  extractPromptShellCommands,
  normalizePromptShellCommand,
  validatePromptShellCommands,
} from '../promptShellExecution.js'

describe('v2.1.290 #37/#146: promptShellExecution CRLF & control-char refusal', () => {
  test('#37: normalizes CRLF to LF in extracted block commands', () => {
    const prompt = '```!\r\necho hello\r\necho world\r\n```'
    const extracted = extractPromptShellCommands(prompt)
    expect(extracted).toHaveLength(1)
    expect(extracted[0]!.command).toBe('echo hello\necho world')
    expect(normalizePromptShellCommand('  a\r\nb  ')).toBe('a\nb')
  })

  test('#37: CRLF-normalized block command passes BashTool inputSchema validation', () => {
    const prompt = '```!\r\necho one\r\necho two\r\n```'
    const validated = validatePromptShellCommands(prompt, BashTool, 'test-cmd')
    expect(validated).toHaveLength(1)
    expect(validated[0]!.command).toBe('echo one\necho two')
  })

  test('#146: refuses raw C0 control char with MalformedCommandError and U+FFFD marker', () => {
    const prompt = '```!\necho \x07bell\n```'
    expect(() =>
      validatePromptShellCommands(prompt, BashTool, 'test-skill'),
    ).toThrow(MalformedCommandError)
    try {
      validatePromptShellCommands(prompt, BashTool, 'test-skill')
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedCommandError)
      const msg = (err as Error).message
      expect(msg).toContain('No shell command in test-skill was run')
      expect(msg).toContain('\uFFFD')
    }
  })

  test('#146: refuses U+FEFF / U+180E for non-Bash tools (e.g. PowerShell)', () => {
    const fakePowerShellTool = {
      name: 'PowerShell',
      inputSchema: z.object({ command: z.string() }),
    } as unknown as Tool
    const prompt = '```!\nWrite-Output "\ufeffhello"\n```'
    try {
      validatePromptShellCommands(prompt, fakePowerShellTool, 'ps-skill')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedCommandError)
      const msg = (err as Error).message
      expect(msg).toContain('U+FEFF')
      expect(msg).toContain('\uFFFD')
    }
  })
})
