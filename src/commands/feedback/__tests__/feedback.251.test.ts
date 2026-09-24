/**
 * densable 2.1.251 #44 — /feedback keeps default TG("/feedback").
 * No /feedback rename. n is /bug's call, not this command.
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
  await import('../feedback.js')
}, 30_000)

describe('/feedback densable 2.1.251 leftover jr', () => {
  test('index has no isEnabled — disable is reported by call', async () => {
    const mod = await import('../index.js')
    const cmd: Command = mod.default
    expect(cmd.name).toBe('feedback')
    expect(cmd.type).toBe('local-jsx')
    expect(cmd.isEnabled).toBeUndefined()
    expect(cmd.aliases).toBeUndefined()
  })

  test('gRt/wur default command remains /feedback', () => {
    const src = readFileSync(join(dir, '../feedback.tsx'), 'utf8')
    expect(src).toContain("command: FeedbackCommandName = '/feedback'")
    expect(src).toContain('callLegacyFeedbackDialog(onDone, context, args)')
    expect(src).not.toContain("m === 'share' ? '/share' : '/bug'")
  })

  test('wur passes mode:K.kind and s.readFileState; no fOn invent', () => {
    const src = readFileSync(join(dir, '../feedback.tsx'), 'utf8')
    expect(src).toContain('mode: K.kind')
    expect(src).toContain('context.readFileState')
    expect(src).toContain('readFileState?: FileStateCache')
    expect(src).toContain('{ ...(registry?.all?.() ?? {}) }')
    expect(src).toContain("command: FeedbackCommandName = '/feedback'")
    expect(src).not.toContain('surveyFeedbackSource:')
    expect(src).not.toContain('function fOn')
  })

  test('disabled /feedback still names /feedback', async () => {
    setEnv('DISABLE_FEEDBACK_COMMAND', '1')
    setEnv('DISABLE_BUG_COMMAND', undefined)
    setEnv('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', undefined)
    const { call } = await import('../feedback.js')
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
      '/feedback has been disabled via the DISABLE_FEEDBACK_COMMAND environment variable',
    )
  })
})
