import { describe, expect, test } from 'bun:test'
import { NestedChainIdleTracker } from '../nestedChainIdle.js'

describe('NestedChainIdleTracker densable', () => {
  test('waitingOnUser requires requires_action and no open main refs', () => {
    const t = new NestedChainIdleTracker({ isDisabled: () => false })
    expect(t.waitingOnUser).toBe(false)
    t.setState('requires_action')
    // mainLoopRefcount 0 - nested 0 <= 0 → waiting
    expect(t.waitingOnUser).toBe(true)
    t.setMainLoopRefcount(1)
    expect(t.waitingOnUser).toBe(false)
  })

  test('nested block reduces effective refcount into waiting', () => {
    const seen: boolean[] = []
    const t = new NestedChainIdleTracker({
      isDisabled: () => false,
      onWaitingOnUserChanged: w => seen.push(w),
    })
    t.setState('requires_action')
    t.setMainLoopRefcount(1)
    // not waiting (1-0 > 0)
    expect(t.waitingOnUser).toBe(false)
    t.notifyNestedPromptBlocking('agent-a')
    // 1-1 <= 0 → waiting
    expect(t.waitingOnUser).toBe(true)
    expect(seen.at(-1)).toBe(true)
    t.notifyNestedPromptUnblocking('agent-a')
    expect(t.waitingOnUser).toBe(false)
    expect(seen.at(-1)).toBe(false)
  })

  test('DISABLE_NESTED_CHAIN_IDLE no-ops blocking', () => {
    const t = new NestedChainIdleTracker({ isDisabled: () => true })
    t.setState('requires_action')
    t.setMainLoopRefcount(1)
    t.notifyNestedPromptBlocking('a')
    expect(t.nestedBlockedChainCount).toBe(0)
    expect(t.waitingOnUser).toBe(false)
  })

  test('dropNestedBlockedChain marks agent and decrements', () => {
    const t = new NestedChainIdleTracker({ isDisabled: () => false })
    t.setState('requires_action')
    t.setMainLoopRefcount(1)
    t.notifyNestedPromptBlocking('a')
    expect(t.nestedBlockedChainCount).toBe(1)
    t.dropNestedBlockedChain('a')
    expect(t.nestedBlockedChainCount).toBe(0)
    // further blocks ignored
    t.notifyNestedPromptBlocking('a')
    expect(t.nestedBlockedChainCount).toBe(0)
  })

  test('chain excess fires once until recovered', () => {
    const excess: number[] = []
    const t = new NestedChainIdleTracker({
      isDisabled: () => false,
      onChainExcess: info => excess.push(info.nestedBlockedChainCount),
    })
    t.setState('requires_action')
    t.setMainLoopRefcount(0)
    t.notifyNestedPromptBlocking('a')
    // first excess at count=1
    t.notifyNestedPromptBlocking('b')
    // still excess; should not re-fire while unrecovered
    t.emitIfWaitingChanged()
    expect(excess).toEqual([1])
    t.notifyNestedPromptUnblocking('a')
    t.notifyNestedPromptUnblocking('b')
    t.notifyNestedPromptBlocking('c')
    expect(excess).toEqual([1, 1])
  })
})
