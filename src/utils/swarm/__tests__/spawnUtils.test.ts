import { afterEach, describe, expect, test } from 'bun:test'
import { buildInheritedCliFlags, buildInheritedEnvVars } from '../spawnUtils'

const ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
] as const

const ORIGINAL_ENV = Object.fromEntries(
  ENV_KEYS.map(key => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('buildInheritedCliFlags', () => {
  test('propagates auto permission mode to process-based teammates', () => {
    const flags = buildInheritedCliFlags({ permissionMode: 'auto' })

    expect(flags).toContain('--permission-mode auto')
  })
})

describe('buildInheritedEnvVars', () => {
  test('forwards OpenAI provider and effort context to teammate processes', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'xhigh'
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:8317/v1'
    process.env.OPENAI_MODEL = 'gpt-5.4'

    const env = buildInheritedEnvVars()

    expect(env).toContain('CLAUDE_CODE_USE_OPENAI=1')
    expect(env).toContain('CLAUDE_CODE_EFFORT_LEVEL=xhigh')
    expect(env).toContain('OPENAI_API_KEY=sk-test')
    expect(env).toContain('OPENAI_BASE_URL=http\\://127.0.0.1\\:8317/v1')
    expect(env).toContain('OPENAI_MODEL=gpt-5.4')
  })
})
