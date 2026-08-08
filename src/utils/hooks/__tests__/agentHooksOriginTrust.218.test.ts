import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'path'
import {
  isAgentHooksOriginTrusted,
  resolveAgentHooksTrustRoot,
} from '../agentHooksOriginTrust.js'

describe('resolveAgentHooksTrustRoot (densable 2.1.218 psd)', () => {
  test('unwraps .claude/agents to project root', () => {
    expect(resolveAgentHooksTrustRoot('/repo/.claude/agents')).toBe('/repo')
  })

  test('leaves other dirs unchanged', () => {
    expect(resolveAgentHooksTrustRoot('/repo/custom/agents')).toBe(
      '/repo/custom/agents',
    )
    expect(resolveAgentHooksTrustRoot('/repo/.claude')).toBe('/repo/.claude')
  })
})

describe('isAgentHooksOriginTrusted (densable 2.1.218 mvo)', () => {
  // pluginOnlyPolicy treats plugin/built-in/policySettings as admin-trusted
  test('admin-trusted sources always pass', () => {
    expect(
      isAgentHooksOriginTrusted({
        agentType: 'x',
        source: 'built-in',
        baseDir: 'built-in',
      }),
    ).toBe(true)
    expect(
      isAgentHooksOriginTrusted({
        agentType: 'x',
        source: 'plugin',
        baseDir: '/untrusted/path',
      }),
    ).toBe(true)
  })

  test('userSettings / flagSettings always pass', () => {
    expect(
      isAgentHooksOriginTrusted({
        agentType: 'x',
        source: 'userSettings',
        baseDir: '/somewhere/untrusted',
      }),
    ).toBe(true)
    expect(
      isAgentHooksOriginTrusted({
        agentType: 'x',
        source: 'flagSettings',
        baseDir: '/somewhere/untrusted',
      }),
    ).toBe(true)
  })

  test('projectSettings without trusted baseDir is rejected', () => {
    // isPathTrusted walks config.projects — a synthetic path with no trust entry fails
    const root = join('/tmp', `untrusted-agent-hooks-${Date.now()}`)
    expect(
      isAgentHooksOriginTrusted({
        agentType: 'sneaky',
        source: 'projectSettings',
        baseDir: join(root, '.claude', 'agents'),
      }),
    ).toBe(false)
  })
})
