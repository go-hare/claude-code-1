/**
 * densable PKe placeholder gate (239 SEA):
 *   Rkg = Ckg && kkg !== void 0 && _Rc.length <= kkg
 * Tip: placeholderText while go && baseline != null && !dismissed && displayed.length <= baseline.
 * Windows yank-bug deferred path must not clear the echo before Messages catches up.
 * Mid-turn compact must not resurrect echo (dismiss latch). Over DEFERRED_CAP,
 * bridge uses deferred!==capped (length stays capped at 500).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const replSrc = readFileSync(join(import.meta.dir, '../REPL.tsx'), 'utf8')

describe('densable PKe submit placeholder baseline', () => {
  test('snapshots baseline at setUserInputOnProcessing, not userMessagePending', () => {
    expect(replSrc).toContain(
      'setPlaceholderBaseline(messagesRef.current.length)',
    )
    expect(replSrc).toContain('placeholderBaseline !== undefined')
    expect(replSrc).toContain('displayedMessages.length <= placeholderBaseline')
    expect(replSrc).not.toContain('setUserMessagePending')
    expect(replSrc).not.toContain('userMessagePendingRef')
  })

  test('forces sync Messages while placeholder bridge active (Windows deferred)', () => {
    expect(replSrc).toContain('placeholderBridgeActive')
    expect(replSrc).toContain(
      'showStreamingText || !isLoading || placeholderBridgeActive',
    )
    expect(replSrc).toContain('placeholderBridgePendingRef')
    expect(replSrc).toContain('deferredMessages !== cappedMessages')
  })

  test('latches echo dismissed after first past-baseline render (compact-safe)', () => {
    expect(replSrc).toContain('placeholderEchoDismissedRef')
    expect(replSrc).toContain('!placeholderEchoDismissedRef.current')
    expect(replSrc).toContain('displayedMessages.length > placeholderBaseline')
  })

  test('swarm mailbox soft-fail uses FRr asker, not tip sandbox queue', () => {
    expect(replSrc).toContain('return sandboxAsker.ask(hostPattern)')
    // Mailbox soft-fail must not enqueue tip sandbox-permission UI
    expect(replSrc).not.toContain(
      "If we couldn't send via mailbox, fall back to local handling",
    )
    expect(replSrc).not.toContain('resolvePromise: resolveShouldAllowHost')
    // densable: tip sandbox queue offline (_Zt keeps worker-sandbox only)
    expect(replSrc).not.toContain('sandboxPermissionRequestQueue')
    expect(replSrc).not.toContain('sandboxBridgeCleanupRef')
    expect(replSrc).not.toContain("'sandbox-permission'")
  })

  test('msf sandbox needs follows DialogStore FRr top (not K8c invent)', () => {
    // densable wrs / open.at(-1) — not open.find(kind) (queueBehind bottom)
    expect(replSrc).toContain('useTopDialog')
    expect(replSrc).toContain('topDialog?.kind !== SANDBOX_NETWORK_ACCESS_KIND')
    expect(replSrc).toContain("emitBgNeedsInput(null, 'sandbox')")
    expect(replSrc).toContain('topDialog?.id')
    expect(replSrc).toContain('topSandboxHost')
    expect(replSrc).not.toContain(
      'open.find(d => d.kind === SANDBOX_NETWORK_ACCESS_KIND)',
    )
    // densable y2A[FRr] = "sandbox request"
    expect(replSrc).toContain(
      'pendingSandboxRequest || topDialogKind === SANDBOX_NETWORK_ACCESS_KIND',
    )
  })
})
