/**
 * densable 2.1.251 #44 — disabled /share names itself, not /feedback.
 * n→Tie→TG locked: /share or /bug. Local gist /share still passes /share into TG.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type { Command } from '../../../commands.js'
import type { LocalCommandResult } from '../../../types/command.js'

const KEYS = [
  'DISABLE_FEEDBACK_COMMAND',
  'DISABLE_BUG_COMMAND',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
] as const

const saved = new Map<string, string | undefined>()

function setEnv(key: (typeof KEYS)[number], value: string | undefined): void {
  if (!saved.has(key)) saved.set(key, process.env[key])
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(() => {
  for (const key of KEYS) {
    if (!saved.has(key)) continue
    const previous = saved.get(key)
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
  saved.clear()
})

describe('/share densable 2.1.251 leftover n', () => {
  test('isEnabled stays true so wur/Tie can report disable', async () => {
    const mod = await import('../index.js')
    const cmd: Command = mod.default
    expect(cmd.name).toBe('share')
    expect(cmd.type).toBe('local')
    expect(cmd.isEnabled?.()).toBe(true)
  })

  test('disabled /share names itself, not /feedback', async () => {
    setEnv('DISABLE_FEEDBACK_COMMAND', undefined)
    setEnv('DISABLE_BUG_COMMAND', '1')
    setEnv('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', undefined)
    const mod = await import('../index.js')
    const loaded = await (
      mod.default as unknown as {
        load: () => Promise<{
          call: (args: string) => Promise<LocalCommandResult>
        }>
      }
    ).load()
    const result = await loaded.call('')
    expect(result).toEqual({
      type: 'text',
      value:
        '/share has been disabled via the DISABLE_BUG_COMMAND environment variable',
    })
  })
})
