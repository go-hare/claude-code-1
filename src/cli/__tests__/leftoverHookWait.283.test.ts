/**
 * densable 2.1.283 leftover unique bSn/qn/Li/_s/Os source-lock.
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { analyticsMock } from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'

mock.module('../../utils/debug.js', () => debugMock())
mock.module('../../utils/debug.ts', () => debugMock())
mock.module('src/utils/debug.js', () => debugMock())
mock.module('src/utils/debug.ts', () => debugMock())
mock.module('../../services/analytics/index.js', () => analyticsMock())
mock.module('../../services/analytics/index.ts', () => analyticsMock())
mock.module('src/services/analytics/index.js', () => analyticsMock())
mock.module('src/services/analytics/index.ts', () => analyticsMock())

const {
  FORWARDED_HOOK_INTERNAL_ERROR_RETRY,
  HEADLESS_CLOUD_FRAME_KEEP,
  completeHostAllowWithShownInput,
  createForwardedHookWait,
  isFailedForwardedHookCall,
  isHeadlessServiceEvent,
  isReplayedForwardedHookCall,
  lookupHeadlessCloudFrameKeep,
  unrefTimeout,
} = await import('../leftoverHookWait.js')
const { createBoundCreatePack } = await import('../leftoverUnique.js')

const src = readFileSync(
  join(import.meta.dir, '../leftoverHookWait.ts'),
  'utf8',
)
const leftoverUnique = readFileSync(
  join(import.meta.dir, '../leftoverUnique.ts'),
  'utf8',
)

describe('leftoverHookWait 283 leftover unique wrap', () => {
  test('source-locks unique strings + gold comments; no minify public API', () => {
    expect(src).toContain('gold `bSn` @202277620')
    expect(src).toContain('gold `qn` @202305373')
    expect(src).toContain('gold `Et` @202305320')
    expect(src).toContain('gold `Li` @202277796')
    expect(src).toContain('gold `_s` @202329864')
    expect(src).toContain('gold `Os` @202334745')
    expect(src).toContain('gold `$t` @202334568')
    expect(src).toContain('gold `As` @202334800')
    expect(src).toContain('r.unref()')
    expect(src).toContain('unknown_call')
    expect(src).toContain(
      'A hook on your machine could not be run for this call (internal error); retry',
    )
    expect(src).toContain(
      "[headlessCloudClient] completing the host's allow with the shown input",
    )
    expect(src).toContain('heartbeat_probe')
    expect(src).toContain('createBoundCreatePack')
    expect(leftoverUnique).toContain("from './leftoverHookWait.js'")
    expect(leftoverUnique).toContain('createForwardedHookWait')
    expect(src).not.toMatch(/^export (async )?function bSn\b/m)
    expect(src).not.toMatch(/^export (async )?function qn\b/m)
    expect(src).not.toMatch(/^export (async )?function Li\b/m)
    expect(src).not.toMatch(/^export (async )?function _s\b/m)
    expect(src).not.toMatch(/^export (async )?function Os\b/m)
    expect(src).not.toContain('settings.set(')
    expect(src).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(src).not.toContain('tengu_violin_amati')
    expect(src).not.toContain('new WebSocket')
  })

  test('bSn unref waiter', () => {
    let fired = 0
    const wait = unrefTimeout(() => {
      fired += 1
    }, 50)
    expect(typeof wait.clear).toBe('function')
    wait.clear()
    expect(fired).toBe(0)
  })

  test('qn unknown_call polarity + Et replayed', () => {
    expect(isFailedForwardedHookCall({ outcome: 'failed' })).toBe(true)
    expect(
      isFailedForwardedHookCall({ outcome: 'refused', code: 'busy' }),
    ).toBe(true)
    expect(
      isFailedForwardedHookCall({
        outcome: 'refused',
        code: 'unknown_call',
      }),
    ).toBe(false)
    expect(isFailedForwardedHookCall({ outcome: 'answered' })).toBe(false)
    expect(
      isFailedForwardedHookCall({ outcome: 'failed', replayed: true }),
    ).toBe(false)
    expect(isReplayedForwardedHookCall({ replayed: true })).toBe(true)
    expect(isReplayedForwardedHookCall({ replayed: false })).toBe(false)
    expect(isReplayedForwardedHookCall({})).toBe(false)
  })

  test('Li copy + waiter factory on createBoundCreatePack host', async () => {
    expect(FORWARDED_HOOK_INTERNAL_ERROR_RETRY).toBe(
      'A hook on your machine could not be run for this call (internal error); retry',
    )
    createBoundCreatePack({ launchDir: '/tmp' })
    const released: string[] = []
    const responded: Array<{ id: string; answer: unknown }> = []
    const errors: unknown[] = []
    const cancelled: Array<{ id: string; reason: string }> = []
    let disposed = false
    const wait = createForwardedHookWait({
      servicer: {
        serve: async hook => {
          if (hook.requestId === 'silent') {
            return { kind: 'silent', reason: 'not_mine' }
          }
          if (hook.requestId === 'boom') {
            throw new Error('serve failed')
          }
          return { kind: 'answer', answer: { ok: true } }
        },
        cancel: (id, reason) => {
          cancelled.push({ id, reason })
          return true
        },
        cancelAll: () => {},
      },
      release: id => {
        released.push(id)
      },
      respond: (id, answer) => {
        responded.push({ id, answer })
      },
      logError: err => {
        errors.push(err)
      },
      staging: {
        dispose: async () => {
          disposed = true
        },
      },
      lookupCallback: () => ({ event: 'PreToolUse' }),
    })
    expect(wait.state()).toBe(null)
    wait.setState({ pin: 1 })
    expect(wait.state()).toEqual({ pin: 1 })
    await wait.handleForwardedHook({ requestId: 'silent' })
    expect(released).toEqual(['silent'])
    await wait.handleForwardedHook({ requestId: 'ok' })
    expect(responded[0]).toEqual({ id: 'ok', answer: { ok: true } })
    await wait.handleForwardedHook({
      requestId: 'boom',
      callbackId: 'cb',
    })
    expect(errors).toHaveLength(1)
    expect(responded[1]?.answer).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: FORWARDED_HOOK_INTERNAL_ERROR_RETRY,
      },
    })
    let stopped = 0
    const unsub = wait.onStoppedWhileRunning(() => {
      stopped += 1
    })
    wait.handleCancelled('req', 'peer')
    expect(stopped).toBe(0)
    wait.handleCancelled('req', 'worker')
    expect(stopped).toBe(1)
    unsub()
    wait.handleCancelled('req', 'worker')
    expect(stopped).toBe(1)
    await wait.dispose()
    expect(disposed).toBe(true)
    wait.setState({ pin: 2 })
    expect(wait.state()).toBe(null)
  })

  test('_s completes host allow with shown input', () => {
    const logs: string[] = []
    const deny = completeHostAllowWithShownInput(
      { behavior: 'deny', toolUseID: 'old' },
      { tool_use_id: 'shown', input: { a: 1 } },
      { log: line => logs.push(line) },
    )
    expect(deny).toEqual({ behavior: 'deny', toolUseID: 'shown' })
    expect(logs).toEqual([])
    const filled = completeHostAllowWithShownInput(
      {
        behavior: 'allow',
        toolUseID: 'old',
        updatedInput: { keep: true },
      },
      { tool_use_id: 'shown', input: { a: 1 } },
      { log: line => logs.push(line) },
    )
    expect(filled.updatedInput).toEqual({ keep: true })
    expect(logs).toEqual([])
    const completed = completeHostAllowWithShownInput(
      { behavior: 'allow', toolUseID: 'old' },
      { tool_use_id: 'shown', tool_name: 'Bash', input: { a: 1 } },
      { log: line => logs.push(line) },
    )
    expect(completed.toolUseID).toBe('shown')
    expect(completed.updatedInput).toEqual({ a: 1 })
    expect(logs).toEqual([
      "[headlessCloudClient] completing the host's allow with the shown input",
    ])
  })

  test('Os $t lookup; heartbeat_probe is As not $t', () => {
    expect(lookupHeadlessCloudFrameKeep('assistant')).toBe(true)
    expect(lookupHeadlessCloudFrameKeep('keep_alive')).toBe(false)
    expect(lookupHeadlessCloudFrameKeep('heartbeat_probe')).toBe(undefined)
    expect('heartbeat_probe' in HEADLESS_CLOUD_FRAME_KEEP).toBe(false)
    expect(Object.keys(HEADLESS_CLOUD_FRAME_KEEP)).toEqual([
      'assistant',
      'user',
      'result',
      'system',
      'stream_event',
      'tool_progress',
      'tool_use_summary',
      'rate_limit_event',
      'prompt_suggestion',
      'conversation_reset',
      'command_lifecycle',
      'transcript_mirror',
      'auth_status',
      'active_goal',
      'autocompact_state',
      'keep_alive',
      'control_request',
      'control_response',
      'control_cancel_request',
    ])
    expect(isHeadlessServiceEvent('heartbeat_probe')).toBe(true)
    expect(isHeadlessServiceEvent('assistant')).toBe(false)
  })
})
