/**
 * densable 2.1.251 #44 — leftover `n` names /bug or /share, never /feedback.
 * Disable is wur→Tie→TG on the call, not isEnabled hiding the command.
 */
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Command } from '../../../commands.js'
import type { LocalJSXCommandContext } from '../../../types/command.js'

const dir = dirname(fileURLToPath(import.meta.url))

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

function stubContext(): LocalJSXCommandContext {
  return {
    abortController: new AbortController(),
    messages: [],
  } as unknown as LocalJSXCommandContext
}

beforeAll(async () => {
  await import('../bug.js')
}, 30_000)

describe('/bug densable 2.1.251 leftover n', () => {
  test('index has no isEnabled — disable is reported by call', async () => {
    const mod = await import('../index.js')
    const cmd: Command = mod.default
    expect(cmd.name).toBe('bug')
    expect(cmd.type).toBe('local-jsx')
    expect(cmd.isEnabled).toBeUndefined()
    expect(cmd.aliases).toBeUndefined()
  })

  test('n body is m==="share"?"/share":"/bug"', () => {
    const src = readFileSync(join(dir, '../bug.tsx'), 'utf8')
    expect(src).toContain("m === 'share' ? '/share' : '/bug'")
    expect(src).not.toContain(
      "callLegacyFeedbackDialog(onDone, context, args, '/bug')",
    )
  })

  test('disabled /bug names itself, not /feedback', async () => {
    setEnv('DISABLE_FEEDBACK_COMMAND', undefined)
    setEnv('DISABLE_BUG_COMMAND', '1')
    setEnv('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', undefined)
    const { call } = await import('../bug.js')
    let reason: string | undefined
    const jsx = await call(
      r => {
        reason = r
      },
      stubContext(),
      '',
    )
    expect(jsx).toBeNull()
    expect(reason).toBe(
      '/bug has been disabled via the DISABLE_BUG_COMMAND environment variable',
    )
    expect(reason).not.toContain('/feedback')
  })

  test('n with m=share names /share', async () => {
    setEnv('DISABLE_FEEDBACK_COMMAND', undefined)
    setEnv('DISABLE_BUG_COMMAND', '1')
    setEnv('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', undefined)
    const { call } = await import('../bug.js')
    let reason: string | undefined
    const jsx = await call(
      r => {
        reason = r
      },
      stubContext(),
      '',
      'share',
    )
    expect(jsx).toBeNull()
    expect(reason).toBe(
      '/share has been disabled via the DISABLE_BUG_COMMAND environment variable',
    )
  })
})
