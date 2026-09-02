/**
 * densable 2.1.234 #7 — wkr / bun / Jvr / W4g sandbox network ask helpers.
 */
import { describe, expect, mock, test } from 'bun:test'
import type { ToolPermissionContext } from '../../../Tool.js'
import type { Message } from '../../../types/message.js'
import {
  SandboxNetworkVerdictCache,
  resolveSandboxNetworkAskDecision,
  sandboxNetworkTranscriptWatermark,
  wrapSandboxAskCallbackWithPermissionMode,
} from '../sandboxNetworkDecision.js'

describe('resolveSandboxNetworkAskDecision (wkr)', () => {
  test('auto → classify', () => {
    expect(resolveSandboxNetworkAskDecision('auto', false)).toBe('classify')
    expect(resolveSandboxNetworkAskDecision('auto', true)).toBe('classify')
  })

  test('bypassPermissions → allow', () => {
    expect(resolveSandboxNetworkAskDecision('bypassPermissions', false)).toBe(
      'allow',
    )
  })

  test('plan inherits bypass only via prePlanMode, not listable flag', () => {
    expect(resolveSandboxNetworkAskDecision('plan', true)).toBe('ask')
    expect(resolveSandboxNetworkAskDecision('plan', false)).toBe('ask')
    expect(
      resolveSandboxNetworkAskDecision('plan', true, 'bypassPermissions'),
    ).toBe('allow')
    expect(resolveSandboxNetworkAskDecision('plan', true, 'default')).toBe(
      'ask',
    )
  })

  test('dontAsk → deny', () => {
    expect(resolveSandboxNetworkAskDecision('dontAsk', false)).toBe('deny')
  })

  test('default / acceptEdits → ask', () => {
    expect(resolveSandboxNetworkAskDecision('default', false)).toBe('ask')
    expect(resolveSandboxNetworkAskDecision('acceptEdits', true)).toBe('ask')
  })
})

describe('sandboxNetworkTranscriptWatermark (bun)', () => {
  test('counts non-progress and last non-progress uuid', () => {
    const messages = [
      { type: 'user', uuid: 'u1' },
      { type: 'progress', uuid: 'p1' },
      { type: 'assistant', uuid: 'a1' },
      { type: 'progress', uuid: 'p2' },
    ] as unknown as Message[]
    expect(sandboxNetworkTranscriptWatermark(messages)).toEqual({
      messageCount: 2,
      lastMessageUuid: 'a1',
    })
  })

  test('empty transcript', () => {
    expect(sandboxNetworkTranscriptWatermark([])).toEqual({
      messageCount: 0,
      lastMessageUuid: undefined,
    })
  })
})

describe('SandboxNetworkVerdictCache (Jvr)', () => {
  test('reuses allow with same-transcript watermark', async () => {
    const cache = new SandboxNetworkVerdictCache()
    const watermark = { messageCount: 1, lastMessageUuid: 'a' }
    let runs = 0
    const run = async () => {
      runs++
      return { allow: true, unavailable: false, transcriptTooLong: false }
    }
    const first = await cache.getOrClassify('h', 443, watermark, run)
    const second = await cache.getOrClassify('h', 443, watermark, run)
    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(runs).toBe(1)
  })

  test('deny reuses always even when watermark changes', async () => {
    const cache = new SandboxNetworkVerdictCache()
    let runs = 0
    const deny = async () => {
      runs++
      return { allow: false, unavailable: false, transcriptTooLong: false }
    }
    await cache.getOrClassify(
      'h',
      undefined,
      { messageCount: 1, lastMessageUuid: 'a' },
      deny,
    )
    // allow microtask that sets reuse=always to settle
    await Promise.resolve()
    await Promise.resolve()
    const again = await cache.getOrClassify(
      'h',
      undefined,
      { messageCount: 99, lastMessageUuid: 'z' },
      deny,
    )
    expect(again).toBe(false)
    expect(runs).toBe(1)
  })

  test('unavailable (non-PTL) drops cache so next ask retries', async () => {
    const cache = new SandboxNetworkVerdictCache()
    let runs = 0
    const unavailable = async () => {
      runs++
      return { allow: false, unavailable: true, transcriptTooLong: false }
    }
    await cache.getOrClassify(
      'h',
      80,
      { messageCount: 1, lastMessageUuid: 'a' },
      unavailable,
    )
    await Promise.resolve()
    await Promise.resolve()
    await cache.getOrClassify(
      'h',
      80,
      { messageCount: 1, lastMessageUuid: 'a' },
      unavailable,
    )
    expect(runs).toBe(2)
  })

  test('transcriptTooLong reuses same-transcript only', async () => {
    const cache = new SandboxNetworkVerdictCache()
    let runs = 0
    const ptl = async () => {
      runs++
      return { allow: false, unavailable: true, transcriptTooLong: true }
    }
    await cache.getOrClassify(
      'h',
      1,
      { messageCount: 2, lastMessageUuid: 'a' },
      ptl,
    )
    await Promise.resolve()
    await Promise.resolve()
    await cache.getOrClassify(
      'h',
      1,
      { messageCount: 2, lastMessageUuid: 'a' },
      ptl,
    )
    expect(runs).toBe(1)
    await cache.getOrClassify(
      'h',
      1,
      { messageCount: 3, lastMessageUuid: 'b' },
      ptl,
    )
    expect(runs).toBe(2)
  })
})

describe('wrapSandboxAskCallbackWithPermissionMode (W4g)', () => {
  function ctx(
    mode: ToolPermissionContext['mode'],
    bypass = false,
  ): ToolPermissionContext {
    return {
      mode,
      isBypassPermissionsModeAvailable: bypass,
    } as ToolPermissionContext
  }

  test('allow / deny short-circuit without ask', async () => {
    const ask = mock(() => Promise.resolve(true))
    const allowWrap = wrapSandboxAskCallbackWithPermissionMode({
      ask,
      getPermissionContext: () => ctx('bypassPermissions'),
      getMessages: () => [],
      getTools: () => [],
    })
    await expect(allowWrap({ host: 'x.com' })).resolves.toBe(true)
    expect(ask).not.toHaveBeenCalled()

    const denyWrap = wrapSandboxAskCallbackWithPermissionMode({
      ask,
      getPermissionContext: () => ctx('dontAsk'),
      getMessages: () => [],
      getTools: () => [],
    })
    await expect(denyWrap({ host: 'x.com' })).resolves.toBe(false)
    expect(ask).not.toHaveBeenCalled()
  })

  test('plan with listable bypass still asks; inherited bypass allows', async () => {
    const ask = mock(() => Promise.resolve(true))
    const planWrap = wrapSandboxAskCallbackWithPermissionMode({
      ask,
      getPermissionContext: () => ctx('plan', true),
      getMessages: () => [],
      getTools: () => [],
    })
    await expect(planWrap({ host: 'x.com' })).resolves.toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)

    const inherited = wrapSandboxAskCallbackWithPermissionMode({
      ask,
      getPermissionContext: () =>
        ({
          ...ctx('plan', true),
          prePlanMode: 'bypassPermissions',
        }) as ToolPermissionContext,
      getMessages: () => [],
      getTools: () => [],
    })
    await expect(inherited({ host: 'x.com' })).resolves.toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  test('ask delegates to underlying callback', async () => {
    const ask = mock(() => Promise.resolve(true))
    const wrap = wrapSandboxAskCallbackWithPermissionMode({
      ask,
      getPermissionContext: () => ctx('default'),
      getMessages: () => [],
      getTools: () => [],
    })
    await expect(wrap({ host: 'example.com', port: 443 })).resolves.toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith({ host: 'example.com', port: 443 })
  })
})
