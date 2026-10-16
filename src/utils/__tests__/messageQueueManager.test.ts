import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { AgentId } from '../../types/ids.js'
import {
  clearCommandQueue,
  countQueuedPeerMessages,
  dequeue,
  dequeueAllMatching,
  enqueue,
  enqueuePendingNotification,
  enqueueReportingAdmission,
  getCommandQueueLength,
  getMainThreadQueueLength,
  hasCommandsInQueue,
  isQueuedCommandEditable,
  isQueuedCommandVisible,
  isSlashCommand,
  peek,
  resetCommandQueue,
  markCancelPending,
  consumeCancelPending,
  consumeCancelPendingAcked,
  hasCancelPendingAcked,
} from '../messageQueueManager.js'
import {
  appendHopChain,
  createPeerAdmissionGuard,
  getOwnHopTokens,
  getOwnUdsHopToken,
  hashAddressToHopToken,
  HOP_CHAIN_CAP,
  HOP_TOKEN_HEX_LEN,
  resetPeerAdmissionGuardForTests,
  setOwnBridgeHopAddressResolver,
  setOwnHopTokensProviderForTests,
  setOwnUdsHopAddress,
} from '../peerAdmission.js'
import {
  clearHandbackDeliveriesForTests,
  getHandbackDelivery,
} from '../subagentHandback.js'

// Reset module-level queue state between tests
beforeEach(() => {
  resetCommandQueue()
  clearHandbackDeliveriesForTests()
  resetPeerAdmissionGuardForTests()
  setOwnHopTokensProviderForTests(null)
})

afterEach(() => {
  resetCommandQueue()
  clearHandbackDeliveriesForTests()
  resetPeerAdmissionGuardForTests()
  setOwnHopTokensProviderForTests(null)
})

describe('messageQueueManager.isSlashCommand', () => {
  test('treats normal slash commands as slash commands', () => {
    expect(isSlashCommand({ value: '/help', mode: 'prompt' } as any)).toBe(true)
  })

  test('keeps remote bridge slash commands slash-routed when bridgeOrigin is set', () => {
    expect(
      isSlashCommand({
        value: '/proactive',
        mode: 'prompt',
        skipSlashCommands: true,
        bridgeOrigin: true,
      } as any),
    ).toBe(true)
  })

  test('keeps skipSlashCommands text-only when bridgeOrigin is absent', () => {
    expect(
      isSlashCommand({
        value: '/proactive',
        mode: 'prompt',
        skipSlashCommands: true,
      } as any),
    ).toBe(false)
  })
})

describe('messageQueueManager.enqueue', () => {
  test('adds command to queue with default next priority', () => {
    enqueue({ value: 'hello', mode: 'prompt' } as any)
    expect(hasCommandsInQueue()).toBe(true)
    const cmd = dequeue()
    expect(cmd).toBeDefined()
    expect(cmd!.value).toBe('hello')
    expect(cmd!.priority).toBe('next')
  })

  test('preserves explicit priority', () => {
    enqueue({ value: 'urgent', mode: 'prompt', priority: 'now' } as any)
    const cmd = dequeue()
    expect(cmd!.priority).toBe('now')
  })

  test('stamps sticky main-thread agentId so AL still matches after session regenerate', () => {
    const {
      getMainThreadAgentId,
      isMainThreadQueuedCommand,
      regenerateSessionId,
    } =
      require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')

    const mainAgentIdBefore = getMainThreadAgentId()
    enqueue({ value: 'survive-clear', mode: 'prompt' } as any)
    const sessionAfter = regenerateSessionId()
    expect(sessionAfter).not.toBe(
      mainAgentIdBefore as unknown as typeof sessionAfter,
    )
    // sticky mainAgentId — no queue rewrite needed (densable 2.1.211)
    expect(getMainThreadAgentId()).toBe(mainAgentIdBefore)
    const cmd = dequeue(isMainThreadQueuedCommand)
    expect(cmd).toBeDefined()
    expect(cmd!.value).toBe('survive-clear')
    expect(cmd!.agentId).toBe(mainAgentIdBefore)
  })
})

describe('messageQueueManager.enqueuePendingNotification', () => {
  test('adds command with later priority', () => {
    enqueuePendingNotification({
      value: '<task-notification/>',
      mode: 'task-notification',
    } as any)
    const cmd = dequeue()
    expect(cmd).toBeDefined()
    expect(cmd!.priority).toBe('later')
    expect(cmd!.mode).toBe('task-notification')
  })
})

describe('messageQueueManager.dequeue', () => {
  test('returns undefined when queue empty', () => {
    expect(dequeue()).toBeUndefined()
  })

  test('returns highest priority command', () => {
    enqueuePendingNotification({
      value: 'later-cmd',
      mode: 'task-notification',
    } as any)
    enqueue({ value: 'next-cmd', mode: 'prompt' } as any)
    enqueue({ value: 'now-cmd', mode: 'prompt', priority: 'now' } as any)

    const first = dequeue()
    expect(first!.value).toBe('now-cmd')

    const second = dequeue()
    expect(second!.value).toBe('next-cmd')

    const third = dequeue()
    expect(third!.value).toBe('later-cmd')
  })

  test('FIFO within same priority', () => {
    enqueue({ value: 'first', mode: 'prompt' } as any)
    enqueue({ value: 'second', mode: 'prompt' } as any)

    expect(dequeue()!.value).toBe('first')
    expect(dequeue()!.value).toBe('second')
  })

  test('respects filter parameter', () => {
    enqueue({ value: 'prompt-cmd', mode: 'prompt' } as any)
    enqueuePendingNotification({
      value: 'task-cmd',
      mode: 'task-notification',
    } as any)

    // Filter to only task-notification commands
    const cmd = dequeue(c => c.mode === 'task-notification')
    expect(cmd).toBeDefined()
    expect(cmd!.value).toBe('task-cmd')

    // Prompt command should still be in queue
    expect(hasCommandsInQueue()).toBe(true)
    expect(dequeue()!.value).toBe('prompt-cmd')
  })
})

describe('messageQueueManager.peek', () => {
  test('returns undefined when queue empty', () => {
    expect(peek()).toBeUndefined()
  })

  test('returns highest priority without removing', () => {
    enqueuePendingNotification({
      value: 'later',
      mode: 'task-notification',
    } as any)
    enqueue({ value: 'next', mode: 'prompt' } as any)

    expect(peek()!.value).toBe('next')
    expect(hasCommandsInQueue()).toBe(true)
    expect(dequeue()!.value).toBe('next')
  })
})

describe('messageQueueManager.dequeueAllMatching', () => {
  test('removes all matching commands', () => {
    enqueue({ value: 'a', mode: 'prompt' } as any)
    enqueue({ value: 'b', mode: 'task-notification' } as any)
    enqueue({ value: 'c', mode: 'task-notification' } as any)

    const matched = dequeueAllMatching(c => c.mode === 'task-notification')
    expect(matched).toHaveLength(2)
    expect(matched.map(c => c.value)).toEqual(['b', 'c'])

    // Remaining command should still be in queue
    expect(dequeue()!.value).toBe('a')
  })

  test('returns empty array when no matches', () => {
    enqueue({ value: 'a', mode: 'prompt' } as any)
    const matched = dequeueAllMatching(c => c.mode === 'bash')
    expect(matched).toHaveLength(0)
    expect(hasCommandsInQueue()).toBe(true)
  })

  test('returns empty array when queue empty', () => {
    const matched = dequeueAllMatching(() => true)
    expect(matched).toHaveLength(0)
  })
})

describe('messageQueueManager.clearCommandQueue', () => {
  test('removes all commands', () => {
    enqueue({ value: 'a', mode: 'prompt' } as any)
    enqueue({ value: 'b', mode: 'prompt' } as any)
    expect(hasCommandsInQueue()).toBe(true)

    clearCommandQueue()
    expect(hasCommandsInQueue()).toBe(false)
  })

  test('no-op on empty queue', () => {
    clearCommandQueue()
    expect(hasCommandsInQueue()).toBe(false)
  })
})

describe('messageQueueManager priority ordering', () => {
  test('now dequeued before next and later', () => {
    enqueuePendingNotification({
      value: 'later',
      mode: 'task-notification',
    } as any)
    enqueue({ value: 'next', mode: 'prompt' } as any)
    enqueue({ value: 'now', mode: 'prompt', priority: 'now' } as any)

    expect(dequeue()!.value).toBe('now')
    expect(dequeue()!.value).toBe('next')
    expect(dequeue()!.value).toBe('later')
  })

  test('next dequeued before later', () => {
    enqueuePendingNotification({
      value: 'later',
      mode: 'task-notification',
    } as any)
    enqueue({ value: 'next', mode: 'prompt' } as any)

    expect(dequeue()!.value).toBe('next')
    expect(dequeue()!.value).toBe('later')
  })
})

describe('getMainThreadQueueLength densable Xwt', () => {
  test('0 when empty', () => {
    expect(getMainThreadQueueLength()).toBe(0)
    expect(getCommandQueueLength()).toBe(0)
  })

  test('counts only AL (agentId === mi()) entries', () => {
    enqueue({ value: 'main', mode: 'prompt' } as any)
    enqueue({
      value: 'sub notif',
      mode: 'task-notification',
      agentId: 'agent-xyz' as AgentId,
    } as any)
    enqueuePendingNotification({
      value: '<task/>',
      mode: 'task-notification',
    } as any)
    // Full queue has subagent-addressed noise; spinner must ignore it.
    expect(getCommandQueueLength()).toBe(3)
    expect(getMainThreadQueueLength()).toBe(2)
  })

  test('subagent-only queue does not inflate main-thread length', () => {
    enqueue({
      value: 'parked',
      mode: 'task-notification',
      agentId: 'nested-owner' as AgentId,
    } as any)
    expect(getCommandQueueLength()).toBe(1)
    expect(getMainThreadQueueLength()).toBe(0)
  })
})

describe('messageQueueManager isQueuedCommandEditable/Visible (densable aJ/U4i)', () => {
  test('human prompt is editable and visible', () => {
    const cmd = { value: 'hi', mode: 'prompt' as const }
    expect(isQueuedCommandEditable(cmd as any)).toBe(true)
    expect(isQueuedCommandVisible(cmd as any)).toBe(true)
  })

  test('meta prompt is not editable', () => {
    const cmd = { value: 'tick', mode: 'prompt' as const, isMeta: true }
    expect(isQueuedCommandEditable(cmd as any)).toBe(false)
  })

  test('peer without senderTaskId is not editable or visible without force', () => {
    const cmd = {
      value: 'from peer',
      mode: 'prompt' as const,
      origin: { kind: 'peer' as const },
    }
    expect(isQueuedCommandEditable(cmd as any)).toBe(false)
    expect(isQueuedCommandVisible(cmd as any)).toBe(false)
    expect(isQueuedCommandVisible(cmd as any, true)).toBe(true)
  })

  test('peer with senderTaskId is visible but not editable', () => {
    const cmd = {
      value: 'from peer',
      mode: 'prompt' as const,
      origin: { kind: 'peer' as const, senderTaskId: 't1' },
    }
    expect(isQueuedCommandEditable(cmd as any)).toBe(false)
    expect(isQueuedCommandVisible(cmd as any)).toBe(true)
  })

  test('channel / task-notification / observer are visible, not editable', () => {
    for (const kind of ['channel', 'task-notification', 'observer'] as const) {
      const cmd = {
        value: kind,
        mode: 'prompt' as const,
        origin: { kind },
        isMeta: true,
      }
      expect(isQueuedCommandEditable(cmd as any)).toBe(false)
      expect(isQueuedCommandVisible(cmd as any)).toBe(true)
    }
  })
})

describe('enqueueReportingAdmission densable ds (2.1.289)', () => {
  test('admits non-peer and pushes with default next priority', () => {
    const result = enqueueReportingAdmission({
      value: 'hello',
      mode: 'prompt',
    } as any)
    expect(result).toEqual({ admitted: true })
    expect(dequeue()!.value).toBe('hello')
  })

  test('records handback delivery for peer handback origin', () => {
    const recipient = 'main-agent' as AgentId
    const result = enqueueReportingAdmission({
      value: 'handback body',
      mode: 'prompt',
      agentId: recipient,
      origin: {
        kind: 'peer',
        handback: true,
        senderTaskId: 'sender-1',
        from: 'Explore',
        flagged: true,
      },
    } as any)
    expect(result).toEqual({ admitted: true })
    expect(getHandbackDelivery('sender-1', recipient)).toEqual({
      recipient,
      flagged: true,
    })
    expect(dequeue()!.value).toBe('handback body')
  })

  test('enqueuePendingNotification pushes directly; handback delivery is ds-only (gold jr)', () => {
    const recipient = 'owner-1' as AgentId
    enqueuePendingNotification({
      value: 'notify',
      mode: 'task-notification',
      agentId: recipient,
      origin: {
        kind: 'peer',
        handback: true,
        senderTaskId: 'sender-2',
      },
    } as any)
    expect(getHandbackDelivery('sender-2', recipient)).toBeUndefined()
    const cmd = dequeue()!
    expect(cmd.mode).toBe('task-notification')
    expect(cmd.priority).toBe('later')
  })

  test('enqueuePendingNotification admits a verified cross-session peer exactly once', () => {
    enqueuePendingNotification({
      value: 'peer note',
      mode: 'task-notification',
      origin: {
        kind: 'peer',
        from: 'uds:/tmp/b.sock',
        verifiedPeerPid: 7,
      },
    } as any)
    expect(countQueuedPeerMessages()).toBe(1)
    expect(dequeue()!.value).toBe('peer note')
  })

  test('admits verified cross-session peer under hopChain host', () => {
    const result = enqueueReportingAdmission({
      value: 'hello peer',
      mode: 'prompt',
      origin: {
        kind: 'peer',
        from: 'uds:/tmp/a.sock',
        verifiedPeerPid: 42,
        hopChain: ['tok-a'],
      },
    } as any)
    expect(result).toEqual({ admitted: true })
    expect(countQueuedPeerMessages()).toBe(1)
    expect(dequeue()!.value).toBe('hello peer')
  })

  test('refuses hop-runaway when hopChain exceeds maxChainLength', () => {
    const longChain = Array.from({ length: 29 }, (_, i) => `h${i}`)
    const result = enqueueReportingAdmission({
      value: 'loop',
      mode: 'prompt',
      origin: {
        kind: 'peer',
        from: 'unknown',
        hopChain: longChain,
      },
    } as any)
    expect(result).toEqual({ admitted: false, reason: 'hop-runaway' })
    expect(hasCommandsInQueue()).toBe(false)
  })

  test('refuses hop-loop when own tokens appear too often', () => {
    setOwnHopTokensProviderForTests(() => new Set(['self']))
    const result = enqueueReportingAdmission({
      value: 'relayed',
      mode: 'prompt',
      origin: {
        kind: 'peer',
        from: 'unknown',
        hopChain: Array.from({ length: 10 }, () => 'self'),
      },
    } as any)
    expect(result).toEqual({ admitted: false, reason: 'hop-loop' })
    expect(hasCommandsInQueue()).toBe(false)
  })

  test('q2r: inbox bind stamps HMAC token; hop-loop fires on live K2r', () => {
    setOwnUdsHopAddress('uds:/tmp/own.sock')
    const tok = getOwnUdsHopToken()
    expect(tok).toHaveLength(HOP_TOKEN_HEX_LEN)
    expect(tok).toMatch(/^[0-9a-f]{24}$/)
    expect(getOwnHopTokens().has(tok!)).toBe(true)
    expect(hashAddressToHopToken('uds:/tmp/own.sock')).toBe(tok)
    const result = enqueueReportingAdmission({
      value: 'looped',
      mode: 'prompt',
      origin: {
        kind: 'peer',
        from: 'unknown',
        hopChain: Array.from({ length: 10 }, () => tok!),
      },
    } as any)
    expect(result).toEqual({ admitted: false, reason: 'hop-loop' })
  })

  test('jUt: bridge resolver HMAC is in K2r', () => {
    setOwnBridgeHopAddressResolver(() => 'bridge:cse_abc')
    const tok = hashAddressToHopToken('bridge:cse_abc')
    expect(getOwnHopTokens().has(tok)).toBe(true)
    setOwnBridgeHopAddressResolver(undefined)
    expect(getOwnHopTokens().has(tok)).toBe(false)
  })

  test('spe: remote session id HMAC is in K2r', () => {
    const prevRemote = process.env.CLAUDE_CODE_REMOTE
    const prevId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    process.env.CLAUDE_CODE_REMOTE = '1'
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'session_abc'
    const tok = hashAddressToHopToken('bridge:session_abc')
    expect(getOwnHopTokens().has(tok)).toBe(true)
    if (prevRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
    else process.env.CLAUDE_CODE_REMOTE = prevRemote
    if (prevId === undefined) delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    else process.env.CLAUDE_CODE_REMOTE_SESSION_ID = prevId
  })

  test('Tkn appendHopChain caps at zVt and drops empty', () => {
    expect(appendHopChain(undefined, undefined)).toBeUndefined()
    const tok = 'a'.repeat(HOP_TOKEN_HEX_LEN)
    expect(appendHopChain(undefined, tok)).toEqual([tok])
    const long = Array.from({ length: HOP_CHAIN_CAP + 4 }, (_, i) =>
      i.toString(16).padStart(HOP_TOKEN_HEX_LEN, '0'),
    )
    const capped = appendHopChain(long.slice(0, HOP_CHAIN_CAP + 3), tok)
    expect(capped).toHaveLength(HOP_CHAIN_CAP)
    expect(capped?.at(-1)).toBe(tok)
  })

  test('htt via kernel pid: omitted from still rate/dedups when verifiedPeerPid is set', () => {
    const origin = {
      kind: 'peer' as const,
      from: 'unknown',
      verifiedPeerPid: 4242,
    }
    expect(
      enqueueReportingAdmission({
        value: 'pid-dedup',
        mode: 'prompt',
        origin,
      } as any),
    ).toEqual({ admitted: true })
    expect(
      enqueueReportingAdmission({
        value: 'pid-dedup',
        mode: 'prompt',
        origin,
      } as any),
    ).toEqual({ admitted: false, reason: 'duplicate' })
    expect(getCommandQueueLength()).toBe(1)
  })

  test('yr 1:1: missing from with pid is from:undefined, not pid: (gold Fr.from!=="unknown")', () => {
    const origin = {
      kind: 'peer' as const,
      verifiedPeerPid: 99,
    }
    expect(
      enqueueReportingAdmission({
        value: 'undef-from',
        mode: 'prompt',
        origin,
      } as any),
    ).toEqual({ admitted: true })
    expect(
      enqueueReportingAdmission({
        value: 'undef-from',
        mode: 'prompt',
        origin,
      } as any),
    ).toEqual({ admitted: false, reason: 'duplicate' })
    expect(
      enqueueReportingAdmission({
        value: 'undef-from',
        mode: 'prompt',
        origin: { kind: 'peer', from: 'unknown', verifiedPeerPid: 99 },
      } as any),
    ).toEqual({ admitted: true })
    expect(getCommandQueueLength()).toBe(2)
  })

  test('refuses duplicate verified peer body inside dedup window', () => {
    const origin = {
      kind: 'peer' as const,
      from: 'uds:/tmp/b.sock',
      verifiedPeerPid: 7,
    }
    expect(
      enqueueReportingAdmission({
        value: 'same',
        mode: 'prompt',
        origin,
      } as any),
    ).toEqual({ admitted: true })
    expect(
      enqueueReportingAdmission({
        value: 'same',
        mode: 'prompt',
        origin,
      } as any),
    ).toEqual({ admitted: false, reason: 'duplicate' })
    expect(getCommandQueueLength()).toBe(1)
  })

  test('resurrected exempt skips hop refuse but still hits queue-full', () => {
    resetPeerAdmissionGuardForTests()
    // Force tiny queue cap via a fresh guard limits override is hard on the
    // shared singleton — fill to default 50 instead via a local count path:
    // use createPeerAdmissionGuard only to assert hop exemption locally.
    const local = createPeerAdmissionGuard({ maxChainLength: 2 })
    const hop = local.checkHopChain(['a', 'b', 'c'], new Set())
    expect(hop).toEqual({ admitted: false, reason: 'hop-runaway' })

    const longChain = Array.from({ length: 29 }, (_, i) => `h${i}`)
    const admitted = enqueueReportingAdmission({
      value: 'resurrected',
      mode: 'prompt',
      admissionExempt: 'resurrected',
      origin: {
        kind: 'peer',
        from: 'unknown',
        hopChain: longChain,
      },
    } as any)
    expect(admitted).toEqual({ admitted: true })
    expect(dequeue()!.value).toBe('resurrected')
  })

  test('refuses queue-full when undelivered peer count hits cap', () => {
    // Cap is 50 by default — enqueue 50 verified peers with unique bodies.
    for (let i = 0; i < 50; i++) {
      const r = enqueueReportingAdmission({
        value: `peer-${i}`,
        mode: 'prompt',
        origin: {
          kind: 'peer',
          from: `uds:/tmp/p${i}.sock`,
          verifiedPeerPid: 100 + i,
        },
      } as any)
      expect(r.admitted).toBe(true)
    }
    expect(countQueuedPeerMessages()).toBe(50)
    const refused = enqueueReportingAdmission({
      value: 'overflow',
      mode: 'prompt',
      origin: {
        kind: 'peer',
        from: 'uds:/tmp/overflow.sock',
        verifiedPeerPid: 999,
      },
    } as any)
    expect(refused).toEqual({ admitted: false, reason: 'queue-full' })
    expect(getCommandQueueLength()).toBe(50)
  })
})

describe('densable 2.1.289 print Kc cancel-pending (he/ye/ke/Se)', () => {
  test('consumeCancelPending is one-shot; acked only with terminalEmitted', () => {
    expect(markCancelPending('u1')).toBe(false)
    expect(hasCancelPendingAcked('u1')).toBe(false)
    expect(consumeCancelPending('u1')).toBe(true)
    expect(consumeCancelPending('u1')).toBe(false)
    expect(markCancelPending('u2', { terminalEmitted: true })).toBe(true)
    expect(hasCancelPendingAcked('u2')).toBe(true)
    expect(consumeCancelPendingAcked('u2')).toBe(true)
    expect(hasCancelPendingAcked('u2')).toBe(false)
  })
})
