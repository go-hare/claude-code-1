import { describe, expect, test } from 'bun:test'
import {
  abortReasonAsDOMException,
  attachDetachableAbortRelay,
  AUTO_RESTORE_SOURCE_REFUSAL_EDIT,
  AUTO_RESTORE_SOURCE_USER_CANCEL,
  classifyAbortKindForAnalytics,
  createAbortController,
  createChildAbortController,
  createRecoveryAbortController,
  isAutoRestoreAbortReason,
  isServerFallbackTombstoneAbort,
  isSubagentParkAbort,
  isUserFacingAbortKind,
  isUserFacingCancelAbortReason,
  normalizeAbortReason,
  PROPAGATING_CANCEL_ABORT_REASONS,
  RECOVERY_ABORT_TIMEOUT_MS,
  RECOVERY_TIMEOUT_REASON,
  REFUSAL_FALLBACK_EDIT_REASON,
  resolveAutoRestoreSource,
  SERVER_FALLBACK_TOMBSTONE_REASON,
  shouldSkipInterruptionMessage,
  SKIP_INTERRUPTION_MESSAGE_REASONS,
  SUBAGENT_PARK_REASON,
  subagentParkAbortReason,
} from '../abortController'

describe('createAbortController', () => {
  test('returns an AbortController that is not aborted', () => {
    const controller = createAbortController()
    expect(controller.signal.aborted).toBe(false)
  })

  test('aborting the controller sets signal.aborted', () => {
    const controller = createAbortController()
    controller.abort()
    expect(controller.signal.aborted).toBe(true)
  })

  test('abort reason is propagated', () => {
    const controller = createAbortController()
    controller.abort('custom reason')
    expect(controller.signal.reason).toBe('custom reason')
  })

  test('accepts custom maxListeners without error', () => {
    const controller = createAbortController(100)
    expect(controller.signal.aborted).toBe(false)
  })
})

describe('createChildAbortController', () => {
  test('child is not aborted initially', () => {
    const parent = createAbortController()
    const child = createChildAbortController(parent)
    expect(child.signal.aborted).toBe(false)
    expect(parent.signal.aborted).toBe(false)
  })

  test('parent abort propagates to child', () => {
    const parent = createAbortController()
    const child = createChildAbortController(parent)
    parent.abort('parent reason')
    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe('parent reason')
  })

  test('child abort does NOT propagate to parent', () => {
    const parent = createAbortController()
    const child = createChildAbortController(parent)
    child.abort('child reason')
    expect(child.signal.aborted).toBe(true)
    expect(parent.signal.aborted).toBe(false)
  })

  test('already-aborted parent immediately aborts child', () => {
    const parent = createAbortController()
    parent.abort('pre-abort')
    const child = createChildAbortController(parent)
    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe('pre-abort')
  })

  test('multiple children are independent', () => {
    const parent = createAbortController()
    const child1 = createChildAbortController(parent)
    const child2 = createChildAbortController(parent)
    child1.abort('child1')
    expect(child1.signal.aborted).toBe(true)
    expect(child2.signal.aborted).toBe(false)
    // Aborting child1 did not affect child2 or parent
    expect(parent.signal.aborted).toBe(false)
  })

  test('parent abort propagates to all children', () => {
    const parent = createAbortController()
    const child1 = createChildAbortController(parent)
    const child2 = createChildAbortController(parent)
    parent.abort('all go down')
    expect(child1.signal.aborted).toBe(true)
    expect(child2.signal.aborted).toBe(true)
  })

  test('grandchild abort propagation', () => {
    const grandparent = createAbortController()
    const parent = createChildAbortController(grandparent)
    const child = createChildAbortController(parent)
    grandparent.abort('chain')
    expect(parent.signal.aborted).toBe(true)
    expect(child.signal.aborted).toBe(true)
  })

  test('child abort then parent abort — child stays aborted with original reason', () => {
    const parent = createAbortController()
    const child = createChildAbortController(parent)
    child.abort('child first')
    parent.abort('parent later')
    expect(child.signal.reason).toBe('child first')
    expect(parent.signal.reason).toBe('parent later')
  })

  test('accepts custom maxListeners for child', () => {
    const parent = createAbortController()
    const child = createChildAbortController(parent, 200)
    expect(child.signal.aborted).toBe(false)
  })
})

describe('classifyAbortKindForAnalytics densable TVt', () => {
  test('maps known densable reasons', () => {
    expect(classifyAbortKindForAnalytics('user-cancel')).toBe('user_cancel')
    expect(classifyAbortKindForAnalytics('remote-cancel')).toBe('remote_cancel')
    expect(classifyAbortKindForAnalytics('interrupt')).toBe('interrupt')
    expect(classifyAbortKindForAnalytics('background')).toBe('background')
    expect(classifyAbortKindForAnalytics('recovery-timeout')).toBe(
      'recovery_timeout',
    )
    expect(classifyAbortKindForAnalytics('server-fallback-tombstone')).toBe(
      'server_fallback_tombstone',
    )
  })

  test('unknown / undefined / objects → turn_teardown', () => {
    expect(classifyAbortKindForAnalytics(undefined)).toBe('turn_teardown')
    expect(classifyAbortKindForAnalytics('streaming_fallback')).toBe(
      'turn_teardown',
    )
    expect(classifyAbortKindForAnalytics({ custom: true })).toBe('turn_teardown')
  })

  test('DOMException AbortError uses message (densable RT)', () => {
    const dom = new DOMException('user-cancel', 'AbortError')
    expect(normalizeAbortReason(dom)).toBe('user-cancel')
    expect(classifyAbortKindForAnalytics(dom)).toBe('user_cancel')
  })

  test('isUserFacingAbortKind densable XMi', () => {
    expect(isUserFacingAbortKind('user_cancel')).toBe(true)
    expect(isUserFacingAbortKind('remote_cancel')).toBe(true)
    expect(isUserFacingAbortKind('interrupt')).toBe(true)
    expect(isUserFacingAbortKind('background')).toBe(true)
    expect(isUserFacingAbortKind('turn_teardown')).toBe(false)
    expect(isUserFacingAbortKind('recovery_timeout')).toBe(false)
    expect(isUserFacingAbortKind('server_fallback_tombstone')).toBe(false)
  })

  test('source anchors entry cancel phase+abortKind in toolExecution', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(import.meta.dir, '../../services/tools/toolExecution.ts'),
      'utf8',
    )
    expect(src).toContain('classifyAbortKindForAnalytics')
    // densable Auo entry via shared buildToolUseCancelledUpdate
    expect(src).toContain("phase: 'entry'")
    expect(src).toContain('buildToolUseCancelledUpdate')
    const cancelIdx = src.indexOf("logEvent('tengu_tool_use_cancelled'")
    expect(cancelIdx).toBeGreaterThan(-1)
    const window = src.slice(cancelIdx, cancelIdx + 600)
    expect(window).toContain('abortKind:')
    expect(window).toContain('phase:')
  })
})


describe('isServerFallbackTombstoneAbort densable H9e', () => {
  test('false when not aborted', () => {
    const c = createAbortController()
    expect(isServerFallbackTombstoneAbort(c.signal)).toBe(false)
  })

  test('true only for server-fallback-tombstone reason', () => {
    const c = createAbortController()
    c.abort(SERVER_FALLBACK_TOMBSTONE_REASON)
    expect(isServerFallbackTombstoneAbort(c.signal)).toBe(true)
  })

  test('false for user-cancel / interrupt / generic abort', () => {
    for (const reason of ['user-cancel', 'interrupt', 'other', undefined]) {
      const c = createAbortController()
      c.abort(reason)
      expect(isServerFallbackTombstoneAbort(c.signal)).toBe(false)
    }
  })
})

describe('densable QMi createRecoveryAbortController / FLc', () => {
  test('isUserFacingCancelAbortReason densable FLc/Y9h', () => {
    expect(isUserFacingCancelAbortReason('user-cancel')).toBe(true)
    expect(isUserFacingCancelAbortReason('remote-cancel')).toBe(true)
    expect(isUserFacingCancelAbortReason('interrupt')).toBe(true)
    expect(
      isUserFacingCancelAbortReason(abortReasonAsDOMException('user-cancel')),
    ).toBe(true)
    // Y9h does NOT include background (unlike isUserFacingAbortKind)
    expect(isUserFacingCancelAbortReason('background')).toBe(false)
    expect(isUserFacingCancelAbortReason(RECOVERY_TIMEOUT_REASON)).toBe(false)
    expect(isUserFacingCancelAbortReason(undefined)).toBe(false)
    expect([...PROPAGATING_CANCEL_ABORT_REASONS].sort()).toEqual(
      ['interrupt', 'remote-cancel', 'user-cancel'].sort(),
    )
  })

  test('parent user-cancel propagates to recovery child', () => {
    const parent = createAbortController()
    const child = createRecoveryAbortController(parent, 60_000)
    expect(child.signal.aborted).toBe(false)
    parent.abort('user-cancel')
    expect(child.signal.aborted).toBe(true)
    expect(normalizeAbortReason(child.signal.reason)).toBe('user-cancel')
  })

  test('parent background does NOT propagate to recovery child', () => {
    const parent = createAbortController()
    const child = createRecoveryAbortController(parent, 60_000)
    parent.abort('background')
    expect(parent.signal.aborted).toBe(true)
    expect(child.signal.aborted).toBe(false)
  })

  test('pre-aborted parent with interrupt immediately aborts child', () => {
    const parent = createAbortController()
    parent.abort('interrupt')
    const child = createRecoveryAbortController(parent, 60_000)
    expect(child.signal.aborted).toBe(true)
    expect(normalizeAbortReason(child.signal.reason)).toBe('interrupt')
  })

  test('pre-aborted parent with background leaves child live', () => {
    const parent = createAbortController()
    parent.abort('background')
    const child = createRecoveryAbortController(parent, 60_000)
    expect(child.signal.aborted).toBe(false)
  })

  test('recovery-timeout fires after short timeoutMs', async () => {
    const parent = createAbortController()
    const child = createRecoveryAbortController(parent, 30)
    expect(child.signal.aborted).toBe(false)
    await new Promise(r => setTimeout(r, 80))
    expect(child.signal.aborted).toBe(true)
    expect(normalizeAbortReason(child.signal.reason)).toBe(
      RECOVERY_TIMEOUT_REASON,
    )
  })

  test('default timeout constant matches densable jjn 10m', () => {
    expect(RECOVERY_ABORT_TIMEOUT_MS).toBe(600_000)
  })

  test('createChildAbortController still propagates all reasons (V9h)', () => {
    const parent = createAbortController()
    const child = createChildAbortController(parent)
    parent.abort('background')
    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe('background')
  })

  test('source anchors query.ts QMi wire', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const query = readFileSync(
      join(import.meta.dir, '../../query.ts'),
      'utf8',
    )
    expect(query).toContain('createRecoveryAbortController')
    expect(query).toContain('recoveryToolUseContext')
  })
})

describe('densable YMi attachDetachableAbortRelay / Z9h', () => {
  test('parent abort propagates to child while linked', () => {
    const parent = createAbortController()
    const child = createAbortController()
    attachDetachableAbortRelay(parent, child)
    parent.abort('user-cancel')
    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe('user-cancel')
  })

  test('detach stops further parent→child propagation', () => {
    const parent = createAbortController()
    const child = createAbortController()
    const detach = attachDetachableAbortRelay(parent, child)
    detach()
    parent.abort('user-cancel')
    expect(parent.signal.aborted).toBe(true)
    expect(child.signal.aborted).toBe(false)
  })

  test('already-aborted parent immediately aborts child; cleanup is noop', () => {
    const parent = createAbortController()
    parent.abort('pre-abort')
    const child = createAbortController()
    const detach = attachDetachableAbortRelay(parent, child)
    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe('pre-abort')
    expect(() => detach()).not.toThrow()
  })

  test('child abort does NOT affect parent', () => {
    const parent = createAbortController()
    const child = createAbortController()
    attachDetachableAbortRelay(parent, child)
    child.abort('child-only')
    expect(child.signal.aborted).toBe(true)
    expect(parent.signal.aborted).toBe(false)
  })

  test('isSubagentParkAbort densable Z9h / JMi', () => {
    expect(SUBAGENT_PARK_REASON).toBe('subagent-park')
    const live = createAbortController()
    expect(isSubagentParkAbort(live.signal)).toBe(false)
    live.abort('user-cancel')
    expect(isSubagentParkAbort(live.signal)).toBe(false)

    const parked = createAbortController()
    parked.abort(SUBAGENT_PARK_REASON)
    expect(isSubagentParkAbort(parked.signal)).toBe(true)

    const viaDom = createAbortController()
    viaDom.abort(subagentParkAbortReason())
    expect(isSubagentParkAbort(viaDom.signal)).toBe(true)
    expect(normalizeAbortReason(viaDom.signal.reason)).toBe(
      SUBAGENT_PARK_REASON,
    )
  })

  test('source anchors AgentTool YMi wire + OSu abortController return', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const agentTool = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx',
      ),
      'utf8',
    )
    expect(agentTool).toContain('attachDetachableAbortRelay')
    expect(agentTool).toContain('detachParentAbortRelay')
    expect(agentTool).toContain('foregroundTaskAbortController')

    const localAgent = readFileSync(
      join(
        import.meta.dir,
        '../../tasks/LocalAgentTask/LocalAgentTask.tsx',
      ),
      'utf8',
    )
    expect(localAgent).toContain('abortController,')
    expect(localAgent).toMatch(
      /return \{\s*taskId: agentId,\s*backgroundSignal,\s*cancelAutoBackground,\s*abortController,/,
    )
  })
})

describe('densable Hus shouldSkipInterruptionMessage', () => {
  test('skips interrupt and refusal-fallback-edit (string + DOMException)', () => {
    expect(shouldSkipInterruptionMessage('interrupt')).toBe(true)
    expect(shouldSkipInterruptionMessage(REFUSAL_FALLBACK_EDIT_REASON)).toBe(
      true,
    )
    expect(
      shouldSkipInterruptionMessage(
        abortReasonAsDOMException(REFUSAL_FALLBACK_EDIT_REASON),
      ),
    ).toBe(true)
    expect(
      shouldSkipInterruptionMessage(
        abortReasonAsDOMException('interrupt'),
      ),
    ).toBe(true)
  })

  test('does not skip user-cancel / background / undefined', () => {
    expect(shouldSkipInterruptionMessage('user-cancel')).toBe(false)
    expect(shouldSkipInterruptionMessage('background')).toBe(false)
    expect(shouldSkipInterruptionMessage(undefined)).toBe(false)
    expect(shouldSkipInterruptionMessage(SERVER_FALLBACK_TOMBSTONE_REASON)).toBe(
      false,
    )
  })

  test('SKIP_INTERRUPTION_MESSAGE_REASONS matches densable Hus set', () => {
    expect([...SKIP_INTERRUPTION_MESSAGE_REASONS].sort()).toEqual(
      ['interrupt', REFUSAL_FALLBACK_EDIT_REASON].sort(),
    )
  })

  test('source anchors query.ts Hus wire', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const query = readFileSync(
      join(import.meta.dir, '../../query.ts'),
      'utf8',
    )
    expect(query).toContain('shouldSkipInterruptionMessage')
    expect(query).not.toMatch(
      /abortController\.signal\.reason !== ['"]interrupt['"]/,
    )
  })
})

describe('densable J0/RT auto-restore abort reasons', () => {
  test('abortReasonAsDOMException caches AbortError by message', () => {
    const a = abortReasonAsDOMException(REFUSAL_FALLBACK_EDIT_REASON)
    const b = abortReasonAsDOMException(REFUSAL_FALLBACK_EDIT_REASON)
    expect(a).toBe(b)
    expect(a).toBeInstanceOf(DOMException)
    expect(a.name).toBe('AbortError')
    expect(a.message).toBe(REFUSAL_FALLBACK_EDIT_REASON)
    expect(normalizeAbortReason(a)).toBe(REFUSAL_FALLBACK_EDIT_REASON)
  })

  test('isAutoRestoreAbortReason accepts user-cancel and refusal-fallback-edit', () => {
    expect(isAutoRestoreAbortReason('user-cancel')).toBe(true)
    expect(isAutoRestoreAbortReason(REFUSAL_FALLBACK_EDIT_REASON)).toBe(true)
    expect(
      isAutoRestoreAbortReason(
        abortReasonAsDOMException(REFUSAL_FALLBACK_EDIT_REASON),
      ),
    ).toBe(true)
    expect(
      isAutoRestoreAbortReason(new DOMException('user-cancel', 'AbortError')),
    ).toBe(true)
    expect(isAutoRestoreAbortReason('interrupt')).toBe(false)
    expect(isAutoRestoreAbortReason('background')).toBe(false)
    expect(isAutoRestoreAbortReason(undefined)).toBe(false)
    expect(isAutoRestoreAbortReason(SERVER_FALLBACK_TOMBSTONE_REASON)).toBe(
      false,
    )
  })

  test('resolveAutoRestoreSource maps densable Ad tags', () => {
    expect(resolveAutoRestoreSource('user-cancel')).toBe(
      AUTO_RESTORE_SOURCE_USER_CANCEL,
    )
    expect(resolveAutoRestoreSource(REFUSAL_FALLBACK_EDIT_REASON)).toBe(
      AUTO_RESTORE_SOURCE_REFUSAL_EDIT,
    )
    expect(
      resolveAutoRestoreSource(
        abortReasonAsDOMException(REFUSAL_FALLBACK_EDIT_REASON),
      ),
    ).toBe(AUTO_RESTORE_SOURCE_REFUSAL_EDIT)
    expect(resolveAutoRestoreSource('interrupt')).toBeUndefined()
    expect(resolveAutoRestoreSource(undefined)).toBeUndefined()
  })

  test('abort with J0 reason recovers via RT on controller signal', () => {
    const c = createAbortController()
    c.abort(abortReasonAsDOMException(REFUSAL_FALLBACK_EDIT_REASON))
    expect(c.signal.aborted).toBe(true)
    expect(isAutoRestoreAbortReason(c.signal.reason)).toBe(true)
    expect(resolveAutoRestoreSource(c.signal.reason)).toBe(
      AUTO_RESTORE_SOURCE_REFUSAL_EDIT,
    )
  })

  test('source anchors REPL dual-reason restore + query edit abort', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const repl = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(repl).toContain('isAutoRestoreAbortReason')
    expect(repl).toContain('resolveAutoRestoreSource')
    expect(repl).toContain('refusal_fallback_edit')
    const query = readFileSync(
      join(import.meta.dir, '../../query.ts'),
      'utf8',
    )
    expect(query).toContain('refusal_edit_prompt')
    expect(query).toContain('REFUSAL_FALLBACK_EDIT_REASON')
    expect(query).toContain('abortReasonAsDOMException')
    const claude = readFileSync(
      join(import.meta.dir, '../../services/api/claude.ts'),
      'utf8',
    )
    expect(claude).toContain("type: 'refusal_edit_prompt'")
    expect(claude).toContain("flow.choice === 'edit_prompt'")
  })

  test('DOMException AbortError with tombstone message matches RT', () => {
    const c = createAbortController()
    c.abort(
      new DOMException(SERVER_FALLBACK_TOMBSTONE_REASON, 'AbortError'),
    )
    expect(isServerFallbackTombstoneAbort(c.signal)).toBe(true)
  })
})
