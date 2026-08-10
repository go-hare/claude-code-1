import { describe, expect, test } from 'bun:test'
import {
  applyRefusalFallbackAppStateRebind,
  buildFallbackRequestEvent,
  buildModelRefusalFallbackSystemMessage,
  buildRefusalFallbackChoiceLabels,
  buildRefusalFallbackDialogPayload,
  applyRefusalFallbackLatchArm,
  applyRefusalFallbackLatchRestore,
  buildRefusalFallbackLatchArm,
  buildServerFallbackMessageShape,
  extractFallbackCreditToken,
  extractModelFieldFromPayload,
  getProviderRefusalFallbackGuidanceText,
  isCyberOrBioRefusalCategory,
  isRefusalDialogConsumerLackingCapability,
  isRefusalFallbackEnabled,
  isRefusalFallbackStuckWithoutDialog,
  matchRefusalFallbackRoute,
  normalizeApiRefusalCategory,
  parseApiRefusalStopDetails,
  planRefusalFallbackAppStateRebind,
  planRefusalFallbackArm,
  planRefusalFallbackPresentation,
  resolveInitialRefusalFallbackChoice,
  resolveRefusalDialogSuppressReason,
  resolveRefusalFallbackLatchRestore,
  resolveRefusalFallbackModelAndLane,
  resolveRefusalSilentAttempt,
  resolveSilentRearmModel,
  resolveStreamRefusalFallbackTarget,
  runRefusalFallbackDialogFlow,
  salvageRefusalPartialText,
  selectRefusalBridgeDialogAdapter,
  shouldInvokeRefusalFallbackDialog,
  showRefusalFallbackDialog,
  trimIncompleteRefusalSalvageText,
} from '../refusalFallback.js'
import { REFUSAL_FALLBACK_DIALOG_KIND } from '../printRequestDialog.js'

describe('isRefusalFallbackEnabled', () => {
  test('default on', () => {
    expect(isRefusalFallbackEnabled({})).toBe(true)
  })
  test('disable env', () => {
    expect(
      isRefusalFallbackEnabled({ CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: '1' }),
    ).toBe(false)
  })
})

describe('refusal dialog decision densables', () => {
  test('resolveRefusalDialogSuppressReason priority', () => {
    expect(resolveRefusalDialogSuppressReason({ silentAttempt: true })).toBe(
      'silent_ab',
    )
    expect(
      resolveRefusalDialogSuppressReason({
        isMainThread: false,
        requestDialog: () => {},
      }),
    ).toBe('subagent')
    expect(resolveRefusalDialogSuppressReason({ isMainThread: true })).toBe(
      'no_dialog_host',
    )
    expect(
      resolveRefusalDialogSuppressReason({
        isMainThread: true,
        requestDialog: () => {},
        switchModelsOnFlag: true,
      }),
    ).toBe('setting')
    expect(
      resolveRefusalDialogSuppressReason({
        isMainThread: true,
        requestDialog: () => {},
        switchModelsOnFlag: false,
        consumerLacksDialogCapability: true,
      }),
    ).toBe('no_consumer_capability')
    expect(
      resolveRefusalDialogSuppressReason({
        isMainThread: true,
        requestDialog: () => {},
        switchModelsOnFlag: false,
      }),
    ).toBeUndefined()
  })

  test('isRefusalFallbackStuckWithoutDialog', () => {
    expect(
      isRefusalFallbackStuckWithoutDialog({
        isMainThread: true,
        requestDialog: undefined,
        switchModelsOnFlag: false,
      }),
    ).toBe(true)
    expect(
      isRefusalFallbackStuckWithoutDialog({
        isMainThread: true,
        requestDialog: () => {},
        switchModelsOnFlag: true,
      }),
    ).toBe(false)
  })

  test('isRefusalDialogConsumerLackingCapability', () => {
    expect(
      isRefusalDialogConsumerLackingCapability({
        dialogHostActive: true,
        supportedDialogKinds: ['other'],
      }),
    ).toBe(true)
    expect(
      isRefusalDialogConsumerLackingCapability({
        dialogHostActive: true,
        supportedDialogKinds: [REFUSAL_FALLBACK_DIALOG_KIND],
      }),
    ).toBe(false)
    expect(
      isRefusalDialogConsumerLackingCapability({
        dialogHostActive: false,
        supportedDialogKinds: [],
      }),
    ).toBe(false)
  })

  test('buildRefusalFallbackChoiceLabels', () => {
    expect(buildRefusalFallbackChoiceLabels('Opus', 'Sonnet')).toEqual({
      retry_fallback: 'Switch to Sonnet',
      edit_prompt: 'Edit prompt and retry with Opus',
    })
  })

  test('selectRefusalBridgeDialogAdapter', () => {
    const ok = {
      supportsKind: (k: string) => k === REFUSAL_FALLBACK_DIALOG_KIND,
    }
    expect(selectRefusalBridgeDialogAdapter(ok, () => true)).toBe(ok)
    expect(selectRefusalBridgeDialogAdapter(ok, () => false)).toBeUndefined()
    expect(
      selectRefusalBridgeDialogAdapter(
        { supportsKind: () => false },
        () => true,
      ),
    ).toBeUndefined()
  })

  test('resolveInitialRefusalFallbackChoice', () => {
    expect(resolveInitialRefusalFallbackChoice('no_consumer_capability')).toBe(
      'cancelled',
    )
    expect(resolveInitialRefusalFallbackChoice('setting')).toBe(
      'retry_fallback',
    )
    expect(resolveInitialRefusalFallbackChoice(undefined)).toBe(
      'retry_fallback',
    )
  })

  test('shouldInvokeRefusalFallbackDialog', () => {
    expect(shouldInvokeRefusalFallbackDialog(undefined, () => {})).toBe(true)
    expect(shouldInvokeRefusalFallbackDialog('setting', () => {})).toBe(false)
    expect(shouldInvokeRefusalFallbackDialog(undefined, undefined)).toBe(false)
  })

  test('getProviderRefusalFallbackGuidanceText / payload', () => {
    expect(getProviderRefusalFallbackGuidanceText(true)).toBeUndefined()
    expect(getProviderRefusalFallbackGuidanceText(false)).toContain(
      'ANTHROPIC_DEFAULT_FABLE_MODEL',
    )
    expect(
      buildRefusalFallbackDialogPayload({
        originalModel: 'a',
        fallbackModel: 'b',
        apiRefusalCategory: 'x',
        retractedMessageUuids: ['u1'],
      }),
    ).toEqual({
      originalModel: 'a',
      fallbackModel: 'b',
      apiRefusalCategory: 'x',
      retractedMessageUuids: ['u1'],
    })
  })

  test('showRefusalFallbackDialog FXl densable', async () => {
    const calls: unknown[] = []
    const result = await showRefusalFallbackDialog({
      requestDialog: async (spec, payload) => {
        calls.push({ kind: spec.kind, payload })
        return 'retry_fallback'
      },
      payload: {
        originalModel: 'opus',
        fallbackModel: 'sonnet',
      },
    })
    expect(result).toBe('retry_fallback')
    expect(calls).toEqual([
      {
        kind: REFUSAL_FALLBACK_DIALOG_KIND,
        payload: { originalModel: 'opus', fallbackModel: 'sonnet' },
      },
    ])

    const cancelled = await showRefusalFallbackDialog({
      requestDialog: async () => 'retry_fallback',
      bridgeDialog: {},
      hasQueuedPrompts: () => true,
      payload: { originalModel: 'a', fallbackModel: 'b' },
    })
    expect(cancelled).toBe('cancelled')
  })

  test('runRefusalFallbackDialogFlow decision + FXl densable', async () => {
    const suppressed = await runRefusalFallbackDialogFlow({
      decision: {
        isMainThread: true,
        requestDialog: undefined,
        switchModelsOnFlag: true,
      },
      payload: { originalModel: 'a', fallbackModel: 'b' },
    })
    expect(suppressed.dialogShown).toBe(false)
    expect(suppressed.suppressReason).toBe('no_dialog_host')
    expect(suppressed.shouldSwitchToFallback).toBe(true)

    let shown = 0
    const dialoged = await runRefusalFallbackDialogFlow({
      decision: {
        isMainThread: true,
        switchModelsOnFlag: false,
      },
      requestDialog: async () => {
        shown += 1
        return 'edit_prompt'
      },
      payload: { originalModel: 'a', fallbackModel: 'b' },
    })
    expect(shown).toBe(1)
    expect(dialoged.dialogShown).toBe(true)
    expect(dialoged.choice).toBe('edit_prompt')
    expect(dialoged.shouldSwitchToFallback).toBe(false)
  })
})

describe('silent-arm densables (m1u / w_i / g_i)', () => {
  test('normalizeApiRefusalCategory PJe densable', () => {
    expect(normalizeApiRefusalCategory('cyber')).toBe('cyber')
    expect(normalizeApiRefusalCategory('bio')).toBe('bio')
    expect(normalizeApiRefusalCategory('frontier_llm')).toBe('frontier_llm')
    expect(normalizeApiRefusalCategory('weird')).toBe('other')
    expect(normalizeApiRefusalCategory(null)).toBeUndefined()
    expect(isCyberOrBioRefusalCategory('cyber')).toBe(true)
  })

  test('matchRefusalFallbackRoute g_i densable', () => {
    expect(
      matchRefusalFallbackRoute({
        originalModelCanonical: 'claude-opus-4-6',
        armedFallbackModel: 'claude-opus-4-8',
        apiRefusalCategory: 'cyber',
        catchAllEnabled: false,
      }),
    ).toEqual({ matched: 'category', model: 'claude-opus-4-8' })

    expect(
      matchRefusalFallbackRoute({
        originalModelCanonical: 'claude-opus-4-6',
        armedFallbackModel: 'claude-opus-4-8',
        apiRefusalCategory: 'bio',
        catchAllEnabled: false,
      }).matched,
    ).toBe('none')

    expect(
      matchRefusalFallbackRoute({
        originalModelCanonical: 'claude-opus-4-6',
        armedFallbackModel: 'claude-opus-4-8',
        apiRefusalCategory: 'bio',
        catchAllEnabled: true,
      }),
    ).toEqual({ matched: 'catch_all', model: 'claude-opus-4-8' })

    // mapped target not opus-4-8 → unresolvable
    expect(
      matchRefusalFallbackRoute({
        originalModelCanonical: 'x',
        armedFallbackModel: 'fallback',
        apiRefusalCategory: 'cyber',
        routesOverride: { cyber: 'claude-sonnet-4' },
        catchAllEnabled: false,
      }),
    ).toEqual({
      matched: 'none',
      model: undefined,
      reason: 'mapped_target_unresolvable',
    })
  })

  test('planRefusalFallbackArm m1u densable', () => {
    const resolve = (m: string) => (m === 'fable' ? 'opus-fallback' : undefined)
    const plan = planRefusalFallbackArm({
      currentModel: 'fable',
      isMainThread: true,
      requestDialog: () => {},
      switchModelsOnFlag: true,
      resolveArmedFallbackModel: resolve,
      refusalFallbackEnabled: true,
      serverLaneEnabled: true,
    })
    expect(plan.visibleModel).toBe('opus-fallback')
    expect(plan.serverLane).toEqual({
      forModel: 'fable',
      model: 'opus-fallback',
    })
    expect(plan.shouldLogSuppression).toBe(false)

    const stuck = planRefusalFallbackArm({
      currentModel: 'fable',
      isMainThread: true,
      requestDialog: undefined,
      switchModelsOnFlag: false,
      resolveArmedFallbackModel: resolve,
      refusalFallbackEnabled: true,
    })
    expect(stuck.visibleModel).toBeUndefined()
    expect(stuck.shouldLogSuppression).toBe(true)

    const declined = planRefusalFallbackArm({
      currentModel: 'fable',
      declined: true,
      resolveArmedFallbackModel: resolve,
      refusalFallbackEnabled: true,
    })
    expect(declined.visibleModel).toBeUndefined()
  })

  test('resolveSilentRearmModel w_i densable', () => {
    expect(
      resolveSilentRearmModel({
        currentModel: 'claude-opus-4-8',
        isVisiblyArmable: true,
        silentRearmGateEnabled: true,
        defaultOpusModel: 'claude-opus-4-8',
      }),
    ).toBeUndefined()
    expect(
      resolveSilentRearmModel({
        currentModel: 'claude-opus-4-8',
        isVisiblyArmable: false,
        silentRearmGateEnabled: true,
        defaultOpusModel: 'claude-opus-4-8',
      }),
    ).toBe('claude-opus-4-8')
    expect(
      resolveSilentRearmModel({
        currentModel: 'claude-sonnet-4',
        isVisiblyArmable: false,
        silentRearmGateEnabled: true,
        defaultOpusModel: 'claude-opus-4-8',
      }),
    ).toBeUndefined()
  })

  test('resolveRefusalFallbackModelAndLane densable', () => {
    expect(
      resolveRefusalFallbackModelAndLane({
        visibleModel: 'v',
        silentRearmModel: 's',
      }),
    ).toEqual({
      refusalFallbackModel: 'v',
      refusalFallbackModelLane: 'visible',
      refusalFallbackSilentArmActive: false,
      serverRefusalFallback: undefined,
    })
    expect(
      resolveRefusalFallbackModelAndLane({
        serverLane: { forModel: 'a', model: 'b' },
        visibleModel: 'v',
        silentRearmModel: 's',
      }),
    ).toEqual({
      refusalFallbackModel: 's',
      refusalFallbackModelLane: 'silent',
      refusalFallbackSilentArmActive: false,
      serverRefusalFallback: { forModel: 'a', model: 'b' },
    })
    // When serverLane set, visible deferred → silent wins for model field;
    // silentArmActive only when no server either (official pi).
    expect(
      resolveRefusalFallbackModelAndLane({
        silentRearmModel: 's',
      }),
    ).toEqual({
      refusalFallbackModel: 's',
      refusalFallbackModelLane: 'silent',
      refusalFallbackSilentArmActive: true,
      serverRefusalFallback: undefined,
    })
  })

  test('buildFallbackRequestEvent densable', () => {
    const ev = buildFallbackRequestEvent({
      originalModel: 'a',
      fallbackModel: 'b',
      apiRefusalCategory: 'cyber',
      silentArmAtTrigger: true,
      routeMatched: 'category',
    })
    expect(ev.type).toBe('fallback_request')
    expect(ev.silentArmAtTrigger).toBe(true)
    expect(ev.routeMatched).toBe('category')
    expect(
      buildFallbackRequestEvent({
        originalModel: 'a',
        fallbackModel: 'b',
        routeMatched: 'none',
      }).routeMatched,
    ).toBeNull()
  })

  test('resolveStreamRefusalFallbackTarget densable', () => {
    expect(
      resolveStreamRefusalFallbackTarget({
        originalModel: 'm',
        armedFallbackModel: 'f',
        apiRefusalCategory: 'cyber',
        catchAllEnabled: false,
      }).fallbackModel,
    ).toBe('f')
    expect(
      resolveStreamRefusalFallbackTarget({
        originalModel: 'm',
        armedFallbackModel: undefined,
      }).fallbackModel,
    ).toBeUndefined()
  })

  test('resolveRefusalSilentAttempt densable', () => {
    expect(resolveRefusalSilentAttempt({ silentArmActive: true })).toBe(true)
    expect(resolveRefusalSilentAttempt({ modelLane: 'silent' })).toBe(true)
    expect(resolveRefusalSilentAttempt({ modelLane: 'visible' })).toBe(false)
    expect(resolveRefusalSilentAttempt({ silentArmAtTrigger: true })).toBe(true)
  })

  test('silent arm suppresses dialog via OXl', async () => {
    let shown = 0
    const flow = await runRefusalFallbackDialogFlow({
      decision: {
        isMainThread: true,
        silentAttempt: true,
        switchModelsOnFlag: false,
      },
      requestDialog: async () => {
        shown += 1
        return 'edit_prompt'
      },
      payload: { originalModel: 'a', fallbackModel: 'b' },
    })
    expect(shown).toBe(0)
    expect(flow.suppressReason).toBe('silent_ab')
    expect(flow.shouldSwitchToFallback).toBe(true)
  })

  test('refusal latch arm/restore densables (b$t/JUa pure)', () => {
    const arm = buildRefusalFallbackLatchArm({
      fallbackModel: 'opus-fb',
      previousOverride: 'sonnet',
      previousAppStateModel: 'sonnet',
    })
    expect(arm).toEqual({
      fallbackModel: 'opus-fb',
      previousOverride: 'sonnet',
      previousAppStateModel: 'sonnet',
    })
    expect(
      resolveRefusalFallbackLatchRestore({
        latch: arm,
        currentOverride: 'opus-fb',
      }),
    ).toEqual({
      restoredOverride: 'sonnet',
      restoredToExplicitOverride: true,
      appStateModel: 'sonnet',
      forSessionValue: undefined,
      fallbackModel: 'opus-fb',
    })
    expect(
      resolveRefusalFallbackLatchRestore({
        latch: arm,
        currentOverride: 'other',
      }),
    ).toBeUndefined()
  })

  test('applyRefusalFallbackLatchArm densable sets latch + override', () => {
    let latched: ReturnType<typeof buildRefusalFallbackLatchArm> | undefined
    let override: string | undefined
    let marked = false
    const arm = applyRefusalFallbackLatchArm({
      fallbackModel: 'opus-fb',
      previousOverride: 'sonnet',
      previousAppStateModel: 'sonnet',
      previousModelForSession: 'session-sonnet',
      setLatch: v => {
        latched = v
      },
      setMainLoopModelOverride: m => {
        override = m
      },
      markOccurred: () => {
        marked = true
      },
    })
    expect(arm.fallbackModel).toBe('opus-fb')
    expect(arm.previousOverride).toBe('sonnet')
    expect(arm.previousModelForSession).toBe('session-sonnet')
    expect(latched).toEqual(arm)
    expect(override).toBe('opus-fb')
    expect(marked).toBe(true)
  })

  test('applyRefusalFallbackLatchRestore densable restores + clears', () => {
    const arm = buildRefusalFallbackLatchArm({
      fallbackModel: 'opus-fb',
      previousOverride: 'sonnet',
      previousAppStateModel: 'sonnet',
    })
    let override: string | undefined = 'opus-fb'
    let cleared = false
    const restored = applyRefusalFallbackLatchRestore({
      latch: arm,
      currentOverride: 'opus-fb',
      setMainLoopModelOverride: m => {
        override = m
      },
      clearLatch: () => {
        cleared = true
      },
    })
    expect(restored).toEqual({
      restoredOverride: 'sonnet',
      restoredToExplicitOverride: true,
      appStateModel: 'sonnet',
      forSessionValue: undefined,
      fallbackModel: 'opus-fb',
    })
    expect(override).toBe('sonnet')
    expect(cleared).toBe(true)

    expect(
      applyRefusalFallbackLatchRestore({
        latch: arm,
        currentOverride: 'other',
        setMainLoopModelOverride: () => {},
        clearLatch: () => {},
      }),
    ).toBeUndefined()
  })

  test('BMg AppState rebind densable', () => {
    const plan = planRefusalFallbackAppStateRebind({
      appStateModel: 'opus-fb',
      forSessionValue: null,
      overrideValue: 'opus-fb',
      currentMainLoopModel: 'sonnet',
      currentMainLoopModelForSession: 'session-sonnet',
      fastMode: true,
      isFastModeSupportedForModel: () => false,
    })
    expect(plan.changed).toBe(true)
    expect(plan.disableFastMode).toBe(true)
    expect(plan.mainLoopModel).toBe('opus-fb')
    expect(plan.mainLoopModelForSession).toBeNull()

    let state = {
      mainLoopModel: 'sonnet' as string | null,
      mainLoopModelForSession: 'session-sonnet' as string | null,
      fastMode: true,
    }
    let override: string | undefined
    applyRefusalFallbackAppStateRebind({
      plan,
      setAppState: f => {
        state = f(state) as typeof state
      },
      setMainLoopModelOverride: m => {
        override = m
      },
    })
    expect(state.mainLoopModel).toBe('opus-fb')
    expect(state.mainLoopModelForSession).toBeNull()
    expect(state.fastMode).toBe(false)
    expect(override).toBe('opus-fb')
  })

  test('credit token / stop_details densables (ues/des/d1u)', () => {
    expect(extractFallbackCreditToken({ fallback_credit_token: 'tok' })).toBe(
      'tok',
    )
    expect(
      extractFallbackCreditToken({ fallback_credit_token: '' }),
    ).toBeUndefined()
    expect(extractFallbackCreditToken(null)).toBeUndefined()
    expect(extractModelFieldFromPayload({ model: 'm' })).toBe('m')
    expect(
      buildServerFallbackMessageShape({ fromModel: 'a', model: 'b' }),
    ).toEqual({
      type: 'fallback',
      from: { model: 'a' },
      to: { model: 'b' },
    })
    expect(
      parseApiRefusalStopDetails({
        type: 'refusal',
        category: 'cyber',
        explanation: 'x',
      }),
    ).toEqual({ type: 'refusal', category: 'cyber', explanation: 'x' })
    expect(parseApiRefusalStopDetails({ type: 'other' })).toBeNull()
  })

  test('IXl salvage + h1u/g1u presentation densables', () => {
    expect(trimIncompleteRefusalSalvageText('hello world unfinished')).toBe(
      'hello world',
    )
    expect(trimIncompleteRefusalSalvageText('Done.')).toBe('Done.')

    const salvaged = salvageRefusalPartialText({
      messages: [
        {
          message: {
            content: [
              {
                type: 'text',
                text: 'This is a sufficiently long partial assistant reply.',
              },
            ],
          },
        },
      ],
    })
    expect(salvaged.salvageText).toContain('sufficiently long')
    expect(salvaged.skipReason).toBeUndefined()

    expect(
      salvageRefusalPartialText({
        messages: [{ message: { content: [{ type: 'text', text: 'hi' }] } }],
      }).skipReason,
    ).toBe('too_short')

    expect(
      salvageRefusalPartialText({
        messages: [
          {
            message: {
              content: [
                {
                  type: 'text',
                  text: 'This is a sufficiently long partial assistant reply.',
                },
                { type: 'tool_use', input: {} },
              ],
            },
          },
        ],
      }).skipReason,
    ).toBe('mid_tool_input')

    const plan = planRefusalFallbackPresentation({
      reason: 'refusal',
      midStream: true,
      discardedMessages: [
        { message: { content: [{ type: 'tool_use' }, { type: 'text' }] } },
      ],
      fromModel: 'a',
      isMainThread: true,
      apiRefusalCategory: 'cyber',
      entitlementBlind: true,
    })
    expect(plan.userVisible).toBe(true)
    expect(plan.showBanner).toBe(true)
    expect(plan.tombstonedToolUse).toBe(true)
    expect(plan.telemetry.apiRefusalCategory).toBe('cyber')
    // densable 2.1.220 entitlement_blind:zkt()
    expect(plan.telemetry.entitlementBlind).toBe(true)
    expect(
      planRefusalFallbackPresentation({
        reason: 'refusal',
        midStream: false,
        discardedMessages: [],
        fromModel: 'a',
        entitlementBlind: false,
      }).telemetry.entitlementBlind,
    ).toBe(false)

    const banner = buildModelRefusalFallbackSystemMessage({
      content: 'Switched',
      fromModel: 'a',
      toModel: 'b',
      timestamp: 't',
      uuid: 'u',
    })
    expect(banner.subtype).toBe('model_refusal_fallback')
    expect(banner.level).toBe('warning')
    expect(banner.fallbackModel).toBe('b')
  })
})
