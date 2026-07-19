/**
 * densable sPg/jwu Bash prompt residual — lean vs full + cobalt_thistle cwd lines.
 */
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import {
  getFullBashPrompt,
  getLeanBashPrompt,
  getSimplePrompt,
} from '../prompt.js'

describe('BashTool densable sPg/jwu prompt', () => {
  beforeAll(() => {
    // Avoid attribution/auth graph when building commit/PR instructions.
    process.env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS = '1'
  })

  afterEach(() => {
    delete process.env.CLAUDE_CODE_COBALT_THISTLE
    delete process.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT
  })

  test('full path keeps densable working-dir + never-prepend-cd-to-git guidance', () => {
    const p = getFullBashPrompt()
    expect(p).toContain(
      'The working directory persists between commands, but shell state does not',
    )
    expect(p).toContain(
      'never prepend `cd <current-directory>` to a `git` command',
    )
    expect(p).toContain('IMPORTANT: Avoid using this tool to run')
    expect(p).toContain('# Instructions')
  })

  test('lean non-thistle prefer-absolute-paths working-dir line', () => {
    process.env.CLAUDE_CODE_COBALT_THISTLE = '0'
    const p = getLeanBashPrompt()
    expect(p).toContain(
      'Working directory persists between calls, but prefer absolute paths',
    )
    expect(p).toContain(
      '`cd` in a compound command can trigger a permission prompt',
    )
    expect(p).toContain('IMPORTANT: Avoid using this tool to run')
    // Lean path does not include the full Instructions block.
    expect(p).not.toContain('# Instructions')
    expect(p).toContain('`timeout` is in milliseconds')
  })

  test('lean cobalt_thistle skips avoid block and uses short cwd line', () => {
    process.env.CLAUDE_CODE_COBALT_THISTLE = '1'
    const p = getLeanBashPrompt()
    expect(p).toContain(
      'Working directory persists between calls. Shell state (env vars, functions) does not persist',
    )
    expect(p).not.toContain('prefer absolute paths')
    expect(p).not.toContain('IMPORTANT: Avoid using this tool to run')
  })

  test('getSimplePrompt routes lean when SIMPLE_SYSTEM_PROMPT forced', () => {
    process.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT = '1'
    const p = getSimplePrompt({ model: 'claude-opus-4-7' })
    expect(p).toContain('Working directory persists between calls')
    expect(p).not.toContain('# Instructions')
  })

  test('getSimplePrompt routes full when SIMPLE_SYSTEM_PROMPT forced off', () => {
    process.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT = '0'
    const p = getSimplePrompt({ model: 'claude-mythos-5' })
    expect(p).toContain('# Instructions')
    expect(p).toContain(
      'The working directory persists between commands, but shell state does not',
    )
  })

  test('full path sleep section mentions long leading sleep or short sleep', () => {
    const p = getFullBashPrompt()
    // densable jwu: either amber_sentinel long-leading block or short-sleep fallback.
    const hasLongLeading = p.includes('Long leading `sleep` commands are blocked')
    const hasShortSleep = p.includes(
      'If you must sleep, keep the duration short to avoid blocking the user',
    )
    expect(hasLongLeading || hasShortSleep).toBe(true)
    expect(p).toContain('Do not sleep between commands that can run immediately')
  })
})
