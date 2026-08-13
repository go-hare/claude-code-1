/**
 * densable 2.1.229 #24 — PREFIX_STAGGER FZp behavior.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  WORKFLOW_PREFIX_STAGGER_DEFAULT_MS,
  WORKFLOW_PREFIX_WARM_TTL_MS,
  WorkflowPrefixStagger,
  buildWorkflowPrefixKey,
  resolveWorkflowPrefixStaggerCapMs,
  resetWorkflowPrefixStaggerForTests,
} from '../prefixStagger.js'

afterEach(() => {
  resetWorkflowPrefixStaggerForTests()
})

describe('densable 2.1.229 #24 prefix stagger', () => {
  test('$Zp defaults to 5000; DISABLE_PROMPT_CACHING forces 0', () => {
    expect(resolveWorkflowPrefixStaggerCapMs({})).toBe(
      WORKFLOW_PREFIX_STAGGER_DEFAULT_MS,
    )
    expect(
      resolveWorkflowPrefixStaggerCapMs({
        CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS: '1200',
      }),
    ).toBe(1200)
    expect(
      resolveWorkflowPrefixStaggerCapMs({
        DISABLE_PROMPT_CACHING: '1',
        CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS: '1200',
      }),
    ).toBe(0)
  })

  test('warm TTL constant is densable h_S=270000', () => {
    expect(WORKFLOW_PREFIX_WARM_TTL_MS).toBe(270_000)
  })

  test('leader is not held; follower waits until responded or cap', async () => {
    let now = 1_000_000
    const gate = new WorkflowPrefixStagger(() => now)
    const prefix = 'model\n\nworker\n\n\n/cwd'

    const leader = await gate.enter(prefix, { capMs: 50 })
    expect(leader.leader).toBe(true)
    expect(leader.waitedMs).toBe(0)
    expect(gate.stateOf(prefix)).toBe('warming')

    const followerP = gate.enter(prefix, { capMs: 5_000 })
    // allow follower to start waiting
    await Promise.resolve()
    leader.responded()
    const follower = await followerP
    expect(follower.leader).toBe(false)
    expect(follower.waitedMs).toBeGreaterThanOrEqual(0)
    expect(gate.stateOf(prefix)).toBe('warm')
  })

  test('done without responded releases leader so follower is not stuck past warm', async () => {
    const gate = new WorkflowPrefixStagger()
    const prefix = 'p1'
    const leader = await gate.enter(prefix, { capMs: 50 })
    expect(gate.stateOf(prefix)).toBe('warming')
    leader.done()
    expect(gate.stateOf(prefix)).toBe('cold')

    const next = await gate.enter(prefix, { capMs: 50 })
    expect(next.leader).toBe(true)
    next.done()
  })

  test('buildWorkflowPrefixKey joins densable Ze fields', () => {
    expect(
      buildWorkflowPrefixKey({
        model: 'sonnet',
        effort: 'high',
        agentType: 'workflow-worker',
        toolNames: ['Bash', 'Read'],
        schemaJson: '{"type":"object"}',
        cwd: '/tmp',
      }),
    ).toBe(
      [
        'sonnet',
        'high',
        'workflow-worker',
        'Bash,Read',
        '{"type":"object"}',
        '/tmp',
      ].join('\n'),
    )
  })
})
