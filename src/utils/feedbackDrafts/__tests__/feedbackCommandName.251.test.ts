import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getFeedbackCommandDisabledReason } from '../gates.js'

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

describe('feedback disable copy names the command (2.1.251 #44)', () => {
  test('/bug names itself', () => {
    setEnv('DISABLE_FEEDBACK_COMMAND', undefined)
    setEnv('DISABLE_BUG_COMMAND', '1')
    setEnv('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', undefined)
    expect(getFeedbackCommandDisabledReason('/bug')).toBe(
      '/bug has been disabled via the DISABLE_BUG_COMMAND environment variable',
    )
  })

  test('/share names itself', () => {
    setEnv('DISABLE_FEEDBACK_COMMAND', undefined)
    setEnv('DISABLE_BUG_COMMAND', undefined)
    setEnv('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', '1')
    expect(getFeedbackCommandDisabledReason('/share')).toBe(
      '/share has been disabled via the CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC environment variable',
    )
  })

  test('default still names /feedback', () => {
    setEnv('DISABLE_FEEDBACK_COMMAND', '1')
    setEnv('DISABLE_BUG_COMMAND', undefined)
    expect(getFeedbackCommandDisabledReason()).toBe(
      '/feedback has been disabled via the DISABLE_FEEDBACK_COMMAND environment variable',
    )
  })

  test('uln gates on TG() default /feedback', () => {
    const src = readFileSync(join(dir, '../gates.ts'), 'utf8')
    expect(src).toContain(
      'if (getFeedbackCommandDisabledReason() !== null) return false',
    )
  })
})
