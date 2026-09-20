/**
 * densable 2.1.232 #35 — `/feedback` `/bug` open mid-turn.
 *
 * Official leftover: two commands, no `/feedback` alias. Official `/bug`
 * aliases `share` is not applied — local `/share` stays the share command.
 */
import { describe, expect, test } from 'bun:test'
import type { Command } from '../../../commands.js'
import { isCommandImmediate } from '../../../utils/immediateCommand.js'

describe('/feedback densable 2.1.232 immediate', () => {
  test('index exports immediate local-jsx Command without aliases', async () => {
    const mod = await import('../index.js')
    const cmd: Command = mod.default
    expect(cmd.name).toBe('feedback')
    expect(cmd.type).toBe('local-jsx')
    expect(cmd.aliases).toBeUndefined()
    expect(cmd.description).toBe('Send feedback to Anthropic or report a bug')
    expect(cmd.immediate).toBe(true)
    expect(isCommandImmediate(cmd, '')).toBe(true)
    expect(typeof cmd.load).toBe('function')
  })

  test('jr leftover opens sr only when aLt and args are empty', async () => {
    const src = await Bun.file(
      new URL('../feedback.tsx', import.meta.url),
    ).text()
    expect(src).toContain(
      'isSendFeedbackEnabled() && !args?.trim() && !isFeedbackCallHt()',
    )
    expect(src).toContain('callLegacyFeedbackDialog')
    expect(src).toContain("args?.trim() === 'public'")
  })

  test('leftover /bug is a separate immediate command', async () => {
    const mod = await import('../../bug/index.js')
    const cmd: Command = mod.default
    expect(cmd.name).toBe('bug')
    expect(cmd.type).toBe('local-jsx')
    expect(cmd.aliases).toBeUndefined()
    expect(cmd.description).toBe('Report a bug or share your conversation')
    expect(cmd.immediate).toBe(true)
    expect(isCommandImmediate(cmd, '')).toBe(true)
    expect(typeof cmd.load).toBe('function')
  })
})
