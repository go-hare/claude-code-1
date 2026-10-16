/**
 * densable 2.1.239 / 2.1.289 leftover — Qun / mSl / isolation resolve (kn).
 * Source-lock + unmocked resolveEffectiveIsolation / isRemoteIsolationAvailable.
 * No mock.module (utils/__tests__ shares the process with residualEnvGates).
 * storageV5 is not ported. Diskless Nt() is LaunchOptions.diskless().
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  isRemoteIsolationAvailable,
  resolveEffectiveIsolation,
} from '../agentIsolationRemote.js'
import {
  disableRemoteAgentIsolation,
  resetSessionBackgroundGatesForTests,
} from '../sessionBackgroundGates.js'

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

afterEach(() => {
  resetSessionBackgroundGatesForTests()
  delete process.env.CLAUDE_CODE_EVAL_CONFINED
})

describe('densable 2.1.289 Qun isolation leftover', () => {
  test('Qun gold order: evalConfined → firstParty → REMOTE/session disable → token → remote flags → tengu_neapolitan', () => {
    expect(isolationSource).toContain('isEvalConfined()')
    expect(isolationSource).toContain('isDisklessLaunch()')
    expect(isolationSource).toContain('diskless')
    expect(isolationSource).toContain("getAPIProvider() !== 'firstParty'")
    expect(isolationSource).toContain('CLAUDE_CODE_REMOTE')
    expect(isolationSource).toContain(
      'getSessionBackgroundGates().remoteAgentIsolationDisabled',
    )
    expect(isolationSource).toContain('accessToken == null')
    expect(isolationSource).toContain('hasUsedRemoteSession')
    expect(isolationSource).toContain('hasRemoteEnvironment')
    expect(isolationSource).toContain("tengu_neapolitan', false")
    expect(isolationSource).toContain('hasWorktreeCreateHook()')
    expect(isolationSource).toContain(
      'Cannot create agent worktree: not in a git repository and no WorktreeCreate hooks are configured.',
    )
    // Gate order: evalConfined before firstParty before REMOTE/session bag.
    const evalIdx = isolationSource.indexOf('isEvalConfined()')
    const disklessIdx = isolationSource.indexOf('isDisklessLaunch()')
    const firstPartyIdx = isolationSource.indexOf(
      "getAPIProvider() !== 'firstParty'",
    )
    const remoteIdx = isolationSource.indexOf(
      'getSessionBackgroundGates().remoteAgentIsolationDisabled',
    )
    expect(evalIdx).toBeGreaterThan(-1)
    expect(disklessIdx).toBeGreaterThan(evalIdx)
    expect(firstPartyIdx).toBeGreaterThan(disklessIdx)
    expect(remoteIdx).toBeGreaterThan(firstPartyIdx)
  })

  test('prompt remote line is gated by Qun not USER_TYPE', () => {
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

  test('non-web-fetch remote falls back when Qun is off', () => {
    // Test env has no tengu_neapolitan + this repo is a git root → worktree.
    expect(
      resolveEffectiveIsolation('remote', {
        source: 'built-in',
        agentType: 'Explore',
      }),
    ).toBe('worktree')
  })

  test('Qun is false when eval-confined', () => {
    process.env.CLAUDE_CODE_EVAL_CONFINED = '1'
    expect(isRemoteIsolationAvailable()).toBe(false)
  })

  test('Qun is false when session remoteAgentIsolationDisabled', () => {
    disableRemoteAgentIsolation()
    expect(isRemoteIsolationAvailable()).toBe(false)
    expect(
      resolveEffectiveIsolation('remote', {
        source: 'built-in',
        agentType: 'Explore',
      }),
    ).toBe('worktree')
  })
})
