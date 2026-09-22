/**
 * densable 2.1.248 #2 mUt / jTt — experimental.cacheTtl on agent frontmatter.
 * Schema is only cacheTtl: "5m" | "1h". "1h" is ignored in subscription overage.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import * as realSettings from '../settings/settings.js'
import {
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'

const settingsSnap = snapshotModuleExports(realSettings)

let settingsOverride: {
  promptCacheTtl?: '5m' | '1h'
  subagentPromptCacheTtl?: '5m' | '1h'
} = {}

mock.module('../settings/settings.js', () => ({
  ...settingsSnap,
  getInitialSettings: () => settingsOverride,
}))

import { parseAgentFromMarkdown } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import {
  parseAgentFrontmatterCacheTtl,
  resolvePromptCacheTtlOverride,
} from '../promptCacheTtl.js'

const ENV_KEYS = [
  'FORCE_PROMPT_CACHING_5M',
  'CLAUDE_CODE_PROMPT_CACHE_TTL',
  'CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL',
  'ENABLE_PROMPT_CACHING_1H',
  'ENABLE_PROMPT_CACHING_1H_BEDROCK',
] as const

afterEach(() => {
  settingsOverride = {}
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
})

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
})

const ttlSrc = readFileSync(
  join(import.meta.dir, '../promptCacheTtl.ts'),
  'utf8',
)
const pluginSrc = readFileSync(
  join(import.meta.dir, '../plugins/loadPluginAgents.ts'),
  'utf8',
)
const querySrc = readFileSync(join(import.meta.dir, '../../query.ts'), 'utf8')
const runAgentSrc = readFileSync(
  join(
    import.meta.dir,
    '../../../packages/builtin-tools/src/tools/AgentTool/runAgent.ts',
  ),
  'utf8',
)

describe('densable 2.1.248 #2 mUt experimental.cacheTtl', () => {
  test('missing or non-object experimental is undefined', () => {
    expect(parseAgentFrontmatterCacheTtl({})).toBeUndefined()
    expect(
      parseAgentFrontmatterCacheTtl({ experimental: null }),
    ).toBeUndefined()
    expect(
      parseAgentFrontmatterCacheTtl({ experimental: '1h' }),
    ).toBeUndefined()
  })

  test('accepts only 5m and 1h', () => {
    expect(
      parseAgentFrontmatterCacheTtl({ experimental: { cacheTtl: '5m' } }),
    ).toBe('5m')
    expect(
      parseAgentFrontmatterCacheTtl({ experimental: { cacheTtl: '1h' } }),
    ).toBe('1h')
    expect(
      parseAgentFrontmatterCacheTtl({ experimental: { cacheTtl: '2h' } }),
    ).toBeUndefined()
    expect(
      parseAgentFrontmatterCacheTtl({ experimental: { cacheTtl: 1 } }),
    ).toBeUndefined()
  })

  test('key match is case-insensitive cachettl', () => {
    expect(
      parseAgentFrontmatterCacheTtl({ experimental: { CacheTTL: '5m' } }),
    ).toBe('5m')
    expect(
      parseAgentFrontmatterCacheTtl({ experimental: { cachettl: '1h' } }),
    ).toBe('1h')
  })

  test('unknown experimental keys are ignored', () => {
    expect(
      parseAgentFrontmatterCacheTtl({
        experimental: { cacheTtl: '1h', other: true },
      }),
    ).toBe('1h')
    expect(
      parseAgentFrontmatterCacheTtl({ experimental: { other: '1h' } }),
    ).toBeUndefined()
  })
})

describe('densable 2.1.248 #2 jTt resolve order', () => {
  test('force_5m_env wins over agent 1h', () => {
    process.env.FORCE_PROMPT_CACHING_5M = '1'
    expect(resolvePromptCacheTtlOverride('agent:explore', '1h')).toEqual({
      ttl: '5m',
      reason: 'force_5m_env',
    })
  })

  test('subagent env wins over agent frontmatter', () => {
    process.env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL = '5m'
    expect(resolvePromptCacheTtlOverride('agent:explore', '1h')).toEqual({
      ttl: '5m',
      reason: 'env',
    })
  })

  test('setting wins over agent frontmatter', () => {
    settingsOverride = { subagentPromptCacheTtl: '5m' }
    expect(resolvePromptCacheTtlOverride('agent:explore', '1h')).toEqual({
      ttl: '5m',
      reason: 'setting',
    })
  })

  test('agent frontmatter applies when no env or setting', () => {
    expect(resolvePromptCacheTtlOverride('agent:explore', '1h')).toEqual({
      ttl: '1h',
      reason: 'agent_frontmatter',
    })
    expect(resolvePromptCacheTtlOverride('agent:explore', '5m')).toEqual({
      ttl: '5m',
      reason: 'agent_frontmatter',
    })
  })

  test('1h agent frontmatter is ignored in overage', () => {
    expect(
      resolvePromptCacheTtlOverride('agent:explore', '1h', true),
    ).toBeUndefined()
    expect(resolvePromptCacheTtlOverride('agent:explore', '5m', true)).toEqual({
      ttl: '5m',
      reason: 'agent_frontmatter',
    })
  })

  test('overage 1h falls through to enable_1h_env', () => {
    process.env.ENABLE_PROMPT_CACHING_1H = '1'
    expect(resolvePromptCacheTtlOverride('agent:explore', '1h', true)).toEqual({
      ttl: '1h',
      reason: 'enable_1h_env',
    })
  })

  test('enable_1h_env is last when there is no agent override', () => {
    process.env.ENABLE_PROMPT_CACHING_1H = '1'
    expect(resolvePromptCacheTtlOverride('agent:explore')).toEqual({
      ttl: '1h',
      reason: 'enable_1h_env',
    })
  })
})

describe('densable 2.1.248 #2 project + plugin parsers', () => {
  test('parseAgentFromMarkdown sets cacheTtl from experimental.cacheTtl', () => {
    const agent = parseAgentFromMarkdown(
      '/tmp/agents/ttl.md',
      '/tmp',
      {
        name: 'ttl-agent',
        description: 'uses a per-agent prompt cache ttl',
        experimental: { cacheTtl: '1h' },
      },
      'You are a cache ttl agent.',
      'projectSettings',
    )
    expect(agent?.cacheTtl).toBe('1h')
    expect(agent?.agentType).toBe('ttl-agent')
  })

  test('parseAgentFromMarkdown accepts case-insensitive cachettl key', () => {
    const agent = parseAgentFromMarkdown(
      '/tmp/agents/ttl.md',
      '/tmp',
      {
        name: 'ttl-agent',
        description: 'uses a per-agent prompt cache ttl',
        experimental: { CacheTTL: '5m' },
      },
      'You are a cache ttl agent.',
      'projectSettings',
    )
    expect(agent?.cacheTtl).toBe('5m')
  })

  test('parseAgentFromMarkdown omits cacheTtl when missing or invalid', () => {
    const missing = parseAgentFromMarkdown(
      '/tmp/agents/plain.md',
      '/tmp',
      {
        name: 'plain-agent',
        description: 'no experimental cache ttl here',
      },
      'You are a plain agent.',
      'projectSettings',
    )
    expect(missing?.cacheTtl).toBeUndefined()

    const invalid = parseAgentFromMarkdown(
      '/tmp/agents/bad.md',
      '/tmp',
      {
        name: 'bad-agent',
        description: 'invalid experimental cache ttl value',
        experimental: { cacheTtl: '2h', other: true },
      },
      'You are a bad agent.',
      'projectSettings',
    )
    expect(invalid?.cacheTtl).toBeUndefined()
  })

  test('plugin parser and query path wire mUt / agentCacheTtlOverride', () => {
    expect(pluginSrc).toContain('parseAgentFrontmatterCacheTtl(frontmatter)')
    expect(pluginSrc).toContain(
      '...(cacheTtl !== undefined ? { cacheTtl } : {})',
    )
    expect(querySrc).toContain('agentCacheTtlOverride?: PromptCacheTtl')
    expect(querySrc).toContain('agentCacheTtlOverride,')
    expect(runAgentSrc).toContain(
      'agentCacheTtlOverride: agentDefinition.cacheTtl',
    )
  })

  test('jTt reasons stay gold — no invented extra reasons', () => {
    expect(ttlSrc).toContain("reason: 'agent_frontmatter'")
    expect(ttlSrc).toContain("reason: 'force_5m_env'")
    expect(ttlSrc).toContain("reason: 'env'")
    expect(ttlSrc).toContain("reason: 'setting'")
    expect(ttlSrc).toContain("reason: 'enable_1h_env'")
    expect(ttlSrc).not.toContain("reason: 'subscriber'")
    expect(ttlSrc).not.toContain("reason: 'default'")
    expect(ttlSrc).not.toContain('cacheRefresh')
    expect(ttlSrc).not.toContain('desktopSessionCleanupPeriodDays')
  })
})
