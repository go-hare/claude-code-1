/**
 * densable 2.1.236 GAP #2 — notify_when_idle / peer_idle_notice (Kur / M2f / H2f / IZa / PZa).
 *
 * Focused unit coverage for refuse reasons, schema parse, cap=32, and one-shot fire.
 * Do not conflate with swarm teammateMailbox createIdleNotification.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { chmod, mkdir, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'
import * as realSettings from 'src/utils/settings/settings.js'
import {
  acceptNotifyWhenIdle,
  correlatePeerIdleNotice,
  flushIdleSubscribers,
  hasOutstandingIdleSubscription,
  idleSelfTargetMessage,
  idleSubscribeDisplayLine,
  idleSubscribeFailedLine,
  idleSubscribedLine,
  MAX_PENDING_IDLE_SUBSCRIPTIONS,
  notifyWhenIdleActionSchema,
  peerIdleNoticeActionSchema,
  parseControlAction,
  resetUdsIdleNotifyForTests,
  sameSocketNamespace,
  setIdleNoticeHandler,
  setPeerIdleNoticeSender,
  subscribeToPeerIdle,
} from '../udsIdleNotify.js'

let inboundPolicy: 'accept' | 'hold' | 'refuse' | undefined = 'accept'

const settingsSnap = snapshotModuleExports(realSettings)

function settingsMock() {
  return {
    ...settingsSnap,
    resolveCrossSessionInbound: () => inboundPolicy,
  }
}

mock.module('src/utils/settings/settings.js', settingsMock)
mock.module('src/utils/settings/settings.ts', settingsMock)

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap, [
    'src/utils/settings/settings.js',
    'src/utils/settings/settings.ts',
  ])
})

afterEach(() => {
  resetUdsIdleNotifyForTests()
  inboundPolicy = 'accept'
  setIdleNoticeHandler(null)
  setPeerIdleNoticeSender(null)
})

describe('densable 2.1.236 Kur / SEA strings', () => {
  test('Kur pending idle subscription cap is 32', () => {
    expect(MAX_PENDING_IDLE_SUBSCRIPTIONS).toBe(32)
  })

  test('M2f idleSelfTargetMessage SEA text', () => {
    expect(idleSelfTargetMessage('that address')).toBe(
      'notify_when_idle: that address is THIS session — nothing was subscribed; you already know when your own turn ends.',
    )
  })

  test('H2f refuse / fail lines match SEA', () => {
    expect(idleSubscribeFailedLine({ ok: false, reason: 'no-inbox' })).toBe(
      'notify_when_idle needs this session to have a messaging inbox, and it has none — no notice will arrive.',
    )
    expect(
      idleSubscribeFailedLine({
        ok: false,
        reason: 'requester-refuses-inbound',
      }),
    ).toBe(
      'notify_when_idle: this session does not accept inbound cross-session traffic (messaging is off here or crossSessionInbound is refuse), so an idle notice could never be shown to you — nothing was subscribed.',
    )
    expect(
      idleSubscribeFailedLine({ ok: false, reason: 'unreachable-namespace' }),
    ).toBe(
      "notify_when_idle: that session could not answer into this session's messaging inbox (different namespace, or an address it will not accept), so its idle notice could not be delivered here — nothing was subscribed.",
    )
    expect(
      idleSubscribeFailedLine({ ok: false, reason: 'peer-unsupported' }),
    ).toBe(
      'notify_when_idle: that session runs a version without idle notices — nothing was subscribed. Ask your user, or message it and wait for its reply instead.',
    )
    expect(idleSubscribeFailedLine({ ok: false, reason: 'cap' })).toBe(
      `notify_when_idle: this session already holds ${MAX_PENDING_IDLE_SUBSCRIPTIONS} pending idle subscriptions — wait for some to fire or expire.`,
    )
    expect(idleSubscribeFailedLine({ ok: false, reason: 'peer-gone' })).toBe(
      'notify_when_idle: no session is listening at that address any more; nothing was subscribed, and any earlier idle subscription to it is void',
    )
    expect(idleSubscribeFailedLine({ ok: false, reason: 'send-failed' })).toBe(
      'notify_when_idle: the subscription could not be sent — no notice will arrive.',
    )
    expect(
      idleSubscribeFailedLine({
        ok: false,
        reason: 'send-failed',
        restoredEarlier: true,
      }),
    ).toBe(
      'notify_when_idle: the re-subscribe could not be sent; your earlier idle subscription to that session still stands.',
    )
    expect(
      idleSubscribeFailedLine({ ok: false, reason: 'send-uncertain' }),
    ).toBe(
      'notify_when_idle: sending the subscription did not complete cleanly, so it is unknown whether that session recorded it — a notice may or may not arrive. Do not rely on it.',
    )
    expect(idleSubscribeFailedLine({ ok: false, reason: 'self-target' })).toBe(
      idleSelfTargetMessage('that address'),
    )
  })

  test('L2f / N2f success display lines', () => {
    expect(idleSubscribedLine('worker', true)).toContain(
      'Subscribed — you will get one notice here when "worker" is next idle',
    )
    expect(idleSubscribedLine('worker', false)).toContain(
      'whether it supports idle notices is unknown',
    )
    expect(
      idleSubscribeDisplayLine('worker', {
        ok: true,
        peerKnownCapable: true,
      }),
    ).toBe('You will be told here when worker is next idle.')
  })
})

describe('densable 2.1.236 namespace + control parse', () => {
  test('sameSocketNamespace accepts cc-socks/<id>/ siblings via grandparent', () => {
    expect(
      sameSocketNamespace(
        '/tmp/cc-socks/a/messaging.sock',
        '/tmp/cc-socks/b/messaging.sock',
      ),
    ).toBe(true)
    expect(
      sameSocketNamespace(
        '/tmp/cc-socks/a/messaging.sock',
        '/var/other/b/messaging.sock',
      ),
    ).toBe(false)
  })

  test('parseControlAction prefers densable top-level action fields', () => {
    const parsed = parseControlAction({
      type: 'control',
      action: 'notify_when_idle',
      from: 'uds:/tmp/cc-socks/a/messaging.sock',
      msg_id: 'm1',
      meta: { action: 'ignored' },
    })
    expect(parsed?.action).toBe('notify_when_idle')
    expect(parsed?.msg_id).toBe('m1')
  })
})

describe('densable 2.1.236 IZa / PZa schemas', () => {
  test('notify_when_idle control schema', () => {
    const ok = notifyWhenIdleActionSchema().safeParse({
      action: 'notify_when_idle',
      from: 'uds:/tmp/cc-socks/a/messaging.sock',
      msg_id: 'm1',
      from_mode: 'prompting',
    })
    expect(ok.success).toBe(true)
    expect(
      notifyWhenIdleActionSchema().safeParse({
        action: 'peer_idle_notice',
        from: 'x',
        msg_id: 'm1',
      }).success,
    ).toBe(false)
  })

  test('peer_idle_notice control schema', () => {
    const ok = peerIdleNoticeActionSchema().safeParse({
      action: 'peer_idle_notice',
      orig_msg_id: 'm1',
      state: 'idle',
      finished_at: '2026-08-20T00:00:00.000Z',
      detail: 'turn done',
      from: 'uds:/tmp/cc-socks/b/messaging.sock',
    })
    expect(ok.success).toBe(true)
    expect(
      peerIdleNoticeActionSchema().safeParse({
        action: 'notify_when_idle',
        orig_msg_id: 'm1',
        state: 'idle',
      }).success,
    ).toBe(false)
  })
})

describe('densable 2.1.236 subscribeToPeerIdle refuse reasons', () => {
  let sockDir: string
  let ownSock: string

  beforeEach(async () => {
    resetUdsIdleNotifyForTests()
    inboundPolicy = 'accept'
    sockDir = await mkdtemp(join(tmpdir(), 'cc-idle-'))
    await chmod(sockDir, 0o700)
    ownSock = join(sockDir, 'own', 'messaging.sock')
    // Let startUdsMessaging create the private parent (0o700); do not pre-mkdir.
    const { startUdsMessaging, stopUdsMessaging } = await import(
      '../udsMessaging.js'
    )
    await stopUdsMessaging().catch(() => {})
    await startUdsMessaging(ownSock)
  })

  afterEach(async () => {
    const { stopUdsMessaging } = await import('../udsMessaging.js')
    await stopUdsMessaging().catch(() => {})
    await rm(sockDir, { recursive: true, force: true }).catch(() => {})
    resetUdsIdleNotifyForTests()
  })

  test('no-inbox when messaging server stopped', async () => {
    const { stopUdsMessaging } = await import('../udsMessaging.js')
    await stopUdsMessaging()
    const r = await subscribeToPeerIdle(
      join(sockDir, 'peer', 'messaging.sock'),
      {
        sendControl: async () => {},
      },
    )
    expect(r).toEqual({ ok: false, reason: 'no-inbox' })
  })

  test('requester-refuses-inbound', async () => {
    inboundPolicy = 'refuse'
    const r = await subscribeToPeerIdle(
      join(sockDir, 'peer', 'messaging.sock'),
      {
        sendControl: async () => {},
      },
    )
    expect(r).toEqual({ ok: false, reason: 'requester-refuses-inbound' })
  })

  test('self-target', async () => {
    const r = await subscribeToPeerIdle(ownSock, {
      sendControl: async () => {},
    })
    expect(r).toEqual({ ok: false, reason: 'self-target' })
  })

  test('unreachable-namespace for non-local path', async () => {
    const r = await subscribeToPeerIdle('\\\\server\\share\\x.sock', {
      sendControl: async () => {},
    })
    expect(r).toEqual({ ok: false, reason: 'unreachable-namespace' })
  })

  test('peer-unsupported when features voucher lacks notify_idle', async () => {
    const r = await subscribeToPeerIdle(
      join(sockDir, 'peer', 'messaging.sock'),
      {
        peerRecord: { pid: 1234, features: ['other'] },
        sendControl: async () => {},
      },
    )
    expect(r).toEqual({ ok: false, reason: 'peer-unsupported' })
  })

  test('peer-unsupported when live peer record has no features voucher', async () => {
    const r = await subscribeToPeerIdle(
      join(sockDir, 'peer', 'messaging.sock'),
      {
        peerRecord: { pid: 1234 },
        sendControl: async () => {},
      },
    )
    expect(r).toEqual({ ok: false, reason: 'peer-unsupported' })
  })

  test('cap at Kur=32 distinct targets', async () => {
    for (let i = 0; i < MAX_PENDING_IDLE_SUBSCRIPTIONS; i++) {
      // densable cc-socks layout: …/<id>/messaging.sock under shared grandparent.
      const target = join(sockDir, `p${i}`, 'messaging.sock')
      const r = await subscribeToPeerIdle(target, {
        label: `p${i}`,
        peerRecord: { pid: 1000 + i, features: ['notify_idle'] },
        sendControl: async () => {},
      })
      expect(r.ok).toBe(true)
    }
    const over = await subscribeToPeerIdle(
      join(sockDir, 'pX', 'messaging.sock'),
      {
        label: 'pX',
        peerRecord: { pid: 9999, features: ['notify_idle'] },
        sendControl: async () => {},
      },
    )
    expect(over).toEqual({ ok: false, reason: 'cap' })
  })

  test('peer-gone when send throws connect-fail', async () => {
    const err = Object.assign(new Error('Failed to connect'), {
      code: 'ECONNREFUSED',
    })
    const r = await subscribeToPeerIdle(
      join(sockDir, 'gone', 'messaging.sock'),
      {
        sendControl: async () => {
          throw err
        },
      },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('peer-gone')
    }
  })

  test('send-failed on EPIPE', async () => {
    const err = Object.assign(new Error('broken pipe'), { code: 'EPIPE' })
    const r = await subscribeToPeerIdle(
      join(sockDir, 'pipe', 'messaging.sock'),
      {
        sendControl: async () => {
          throw err
        },
      },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('send-failed')
    }
  })

  test('send-uncertain on opaque failure', async () => {
    const r = await subscribeToPeerIdle(
      join(sockDir, 'maybe', 'messaging.sock'),
      {
        sendControl: async () => {
          throw new Error('protocol glitch')
        },
      },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('send-uncertain')
    }
  })
})

describe('densable 2.1.236 one-shot peer_idle_notice fire', () => {
  test('accept + flushIdleSubscribers fires exactly one notice then clears', async () => {
    const sent: Array<{ target: string; payload: Record<string, unknown> }> = []
    // vetReplyAddress requires same parent directory for reply + own sockets.
    const dir = await mkdtemp(join(tmpdir(), 'cc-idle-fire-'))
    await chmod(dir, 0o700)
    const own = join(dir, 'own.sock')
    const peer = join(dir, 'peer.sock')
    setPeerIdleNoticeSender(async (replyTarget, payload) => {
      sent.push({ target: replyTarget, payload: { ...payload } })
    })
    expect(
      acceptNotifyWhenIdle({
        from: `uds:${peer}`,
        msgId: 'sub-2',
        ownSocketPath: own,
      }),
    ).toBe('full')

    await flushIdleSubscribers({ state: 'idle', detail: 'turn done' })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.target).toBe(peer)
    expect(sent[0]!.payload.orig_msg_id).toBe('sub-2')
    expect(sent[0]!.payload.state).toBe('idle')
    expect(typeof sent[0]!.payload.finished_at).toBe('string')

    // Second flush is a no-op (one-shot).
    await flushIdleSubscribers({ state: 'idle' })
    expect(sent).toHaveLength(1)
    await rm(dir, { recursive: true, force: true })
  })

  test('correlatePeerIdleNotice consumes outstanding once', async () => {
    const notices: string[] = []
    setIdleNoticeHandler(n => {
      notices.push(n.kind)
    })
    const dir = await mkdtemp(join(tmpdir(), 'cc-idle-corr-'))
    await chmod(dir, 0o700)
    const own = join(dir, 'own.sock')
    const peer = join(dir, 'peer.sock')
    const { startUdsMessaging, stopUdsMessaging } = await import(
      '../udsMessaging.js'
    )
    await stopUdsMessaging().catch(() => {})
    await startUdsMessaging(own)
    let msgId = ''
    try {
      const sub = await subscribeToPeerIdle(peer, {
        label: 'peer',
        peerRecord: { pid: 7, features: ['notify_idle'] },
        sendControl: async (_t, frame) => {
          const action = frame.meta as { msg_id?: string }
          msgId = action.msg_id ?? ''
        },
      })
      expect(sub.ok).toBe(true)
      expect(msgId.length).toBeGreaterThan(0)
      expect(hasOutstandingIdleSubscription(msgId)).toBe(true)
      expect(
        correlatePeerIdleNotice({
          origMsgId: msgId,
          state: 'idle',
          finishedAt: '2026-08-20T12:00:00.000Z',
        }),
      ).toBe(true)
      expect(hasOutstandingIdleSubscription(msgId)).toBe(false)
      expect(
        correlatePeerIdleNotice({
          origMsgId: msgId,
          state: 'idle',
        }),
      ).toBe(false)
      expect(notices).toEqual(['idle'])
    } finally {
      await stopUdsMessaging().catch(() => {})
      await rm(dir, { recursive: true, force: true })
    }
  })
})
