/**
 * densable 2.1.239 leftover — Tno / mSl / isolation resolve.
 * Source-lock + unmocked resolveEffectiveIsolation. No mock.module
 * (utils/__tests__ shares the process with residualEnvGates).
 * storageV5 is not ported.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { resolveEffectiveIsolation } from '../agentIsolationRemote.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isolationSource = readFileSync(
  join(__dirname, '..', 'agentIsolationRemote.ts'),
  'utf-8',
)
const promptSource = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    'packages',
    'builtin-tools',
    'src',
    'tools',
    'AgentTool',
    'prompt.ts',
  ),
  'utf-8',
)

describe('densable 2.1.239 Tno isolation leftover', () => {
  test('Tno gold is firstParty + token + remote flags + tengu_neapolitan', () => {
    expect(isolationSource).toContain("getAPIProvider() !== 'firstParty'")
    expect(isolationSource).toContain('CLAUDE_CODE_REMOTE')
    expect(isolationSource).toContain('accessToken == null')
    expect(isolationSource).toContain('hasUsedRemoteSession')
    expect(isolationSource).toContain('hasRemoteEnvironment')
    expect(isolationSource).toContain("tengu_neapolitan', false")
    expect(isolationSource).toContain('hasWorktreeCreateHook()')
    expect(isolationSource).toContain(
      'Cannot create agent worktree: not in a git repository and no WorktreeCreate hooks are configured.',
    )
  })

  test('prompt remote line is gated by Tno not USER_TYPE', () => {
    expect(promptSource).toContain('isRemoteIsolationAvailable()')
    expect(promptSource).not.toContain("process.env.USER_TYPE === 'ant'")
  })

  test('web-fetch agent isolation is ignored', () => {
    expect(
      resolveEffectiveIsolation('worktree', {
        source: 'built-in',
        agentType: 'web-fetch',
      }),
    ).toBeUndefined()
    expect(
      resolveEffectiveIsolation('remote', {
        source: 'built-in',
        agentType: 'web-fetch',
      }),
    ).toBeUndefined()
  })

  test('non-web-fetch remote falls back when Tno is off', () => {
    // Test env has no tengu_neapolitan + this repo is a git root → worktree.
    expect(
      resolveEffectiveIsolation('remote', {
        source: 'built-in',
        agentType: 'Explore',
      }),
    ).toBe('worktree')
  })
})
