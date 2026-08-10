import { describe, expect, test } from 'bun:test'
import {
  applyRefusalFallbackAppStateRebind,
  buildFallbackRequestEvent,
  buildModelRefusalFallbackSystemMessage,
  buildRefusalContinuationSalvage,
  buildRefusalFallbackChoiceLabels,
  buildRefusalFallbackDialogPayload,
  applyRefusalFallbackLatchArm,
  applyRefusalFallbackLatchRestore,
  buildRefusalFallbackLatchArm,
  buildRefusalContinuationBeginEvent,
  buildRefusalNoFallbackEvent,
  buildRefusalRetainedText,
  buildQueryModelChangeEvent,
  buildServerFallbackEvent,
  buildServerFallbackMessageShape,
  extractFallbackCreditToken,
  planFallbackCreditBeta,
  planFallbackCreditMint,
  planFallbackCreditStamp,
  planServerRefusalFallbackBetas,
  buildPartialResponseSalvageMetaContent,
  planRefusalContinuationBeginWithSilentStitchGate,
  planServerFallbackSeamMerge,
  resolveConvoluteArcadesRetryOutcome,
  SERVER_FALLBACK_SILENT_STITCH_SKIP_WARN,
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
      mode: 'explicit',
    })
    expect(plan.shouldLogSuppression).toBe(false)

    // densable: same-model epr blocks serverLane
    const same = planRefusalFallbackArm({
      currentModel: 'opus-fallback',
      isMainThread: true,
      requestDialog: () => {},
      switchModelsOnFlag: true,
      resolveArmedFallbackModel: () => 'opus-fallback',
      refusalFallbackEnabled: true,
      serverLaneEnabled: true,
    })
    expect(same.visibleModel).toBe('opus-fallback')
    expect(same.serverLane).toBeUndefined()

    // densable: inCascadeEpisode blocks serverLane
    const cascade = planRefusalFallbackArm({
      currentModel: 'fable',
      isMainThread: true,
      requestDialog: () => {},
      resolveArmedFallbackModel: resolve,
      refusalFallbackEnabled: true,
      serverLaneEnabled: true,
      inCascadeEpisode: true,
    })
    expect(cascade.visibleModel).toBe('opus-fallback')
    expect(cascade.serverLane).toBeUndefined()

    // densable dkd default when serverLaneEnabled omitted + firstParty inject
    const auto = planRefusalFallbackArm({
      currentModel: 'fable',
      isMainThread: true,
      requestDialog: () => {},
      resolveArmedFallbackModel: resolve,
      refusalFallbackEnabled: true,
      // serverLaneEnabled omitted → isServerRefusalFallbackLaneEnabled
    })
    // may or may not arm server depending on provider env in test process;
    // visible still arms
    expect(auto.visibleModel).toBe('opus-fallback')

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

  test('retainedText join "" + Yt continuation salvage (densable)', () => {
    const msgs = [
      {
        uuid: 'u1',
        message: {
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'text', text: 'World' },
          ],
        },
      },
      {
        uuid: 'u2',
        message: { content: [{ type: 'text', text: '!' }] },
      },
      {
        uuid: 'err',
        isApiErrorMessage: true,
        message: { content: [{ type: 'text', text: 'ignore' }] },
      },
    ]
    // densable retainedText: no inter-message newline
    expect(buildRefusalRetainedText(msgs)).toBe('HelloWorld!')

    const yt = buildRefusalContinuationSalvage({ messages: msgs })
    expect(yt).not.toBeNull()
    expect(yt!.salvageText).toBe('HelloWorld!')
    expect(yt!.replacesUuids).toEqual(['u1', 'u2'])

    // empty retained → null (no IXl min-char gate on emit)
    expect(
      buildRefusalContinuationSalvage({
        messages: [{ uuid: 'x', message: { content: [] } }],
      }),
    ).toBeNull()

    // IXl salvageText uses raw retainedText when gates pass
    const salvaged = salvageRefusalPartialText({
      messages: [
        {
          uuid: 'a',
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
    expect(salvaged.replacesUuids).toEqual(['a'])
    expect(salvaged.salvageText).toBe(
      'This is a sufficiently long partial assistant reply.',
    )
  })

  test('server_fallback seam merge vs Gt silent stitch (densable)', () => {
    const retained = [
      {
        uuid: 'r1',
        message: { content: [{ type: 'text', text: 'partial' }] },
      },
    ]
    // midStream + retained + Gt free → merge Yt
    const merge = planServerFallbackSeamMerge({
      midStream: true,
      retainedText: 'partial',
      retainedMessages: retained,
      silentStitchPending: false,
    })
    expect(merge.action).toBe('merge')
    if (merge.action === 'merge') {
      expect(merge.yt.text).toBe('partial')
      expect(merge.yt.originals).toEqual(retained)
      const begin = buildRefusalContinuationBeginEvent(merge.yt)
      expect(begin.phase).toBe('begin')
      expect(begin.salvageText).toBe('partial')
      expect(begin.replacesUuids).toEqual(['r1'])
      expect(begin.join).toBe('exact')
    }
    // Gt pending → skip
    expect(
      planServerFallbackSeamMerge({
        midStream: true,
        retainedText: 'partial',
        silentStitchPending: true,
      }).action,
    ).toBe('skip_silent_stitch_pending')
    expect(SERVER_FALLBACK_SILENT_STITCH_SKIP_WARN).toContain('silent stitch')
    // not midStream
    expect(
      planServerFallbackSeamMerge({
        midStream: false,
        retainedText: 'x',
        silentStitchPending: false,
      }).action,
    ).toBe('not_mid_stream')
    // empty retained
    expect(
      planServerFallbackSeamMerge({
        midStream: true,
        retainedText: '',
        silentStitchPending: false,
      }).action,
    ).toBe('no_retained')
  })

  test('client begin gate with silent stitch + event builders', () => {
    const msgs = [
      {
        uuid: 'c1',
        message: { content: [{ type: 'text', text: 'Hello salvage' }] },
      },
    ]
    const begin = planRefusalContinuationBeginWithSilentStitchGate({
      messages: msgs,
      silentStitchPending: false,
    })
    expect(begin.action).toBe('begin')
    expect(
      planRefusalContinuationBeginWithSilentStitchGate({
        messages: msgs,
        silentStitchPending: true,
      }).action,
    ).toBe('skip_silent_stitch_pending')

    const sf = buildServerFallbackEvent({
      fromModel: 'a',
      toModel: 'b',
      midStream: true,
      retainedText: 't',
      retainedMessages: msgs,
    })
    expect(sf.type).toBe('server_fallback')
    expect(sf.retainedText).toBe('t')
    expect(buildRefusalNoFallbackEvent('route_declined').type).toBe(
      'refusal_no_fallback',
    )
    expect(buildQueryModelChangeEvent('m').toModel).toBe('m')
  })

  test('convolute_arcades_retry_outcome matrix', () => {
    expect(
      resolveConvoluteArcadesRetryOutcome({
        path: 'success',
        silentStitchPending: false,
      }),
    ).toBe('merged')
    expect(
      resolveConvoluteArcadesRetryOutcome({
        path: 'success',
        silentStitchPending: true,
      }),
    ).toBe('no_text')
    expect(
      resolveConvoluteArcadesRetryOutcome({
        path: 'error',
        silentStitchPending: true,
      }),
    ).toBe('error')
  })

  test('server_fallback production: parse hop + midStream partition + Xs flush', () => {
    const {
      parseServerFallbackContentBlockStart,
      isMalformedServerFallbackBlockStart,
      buildMidStreamServerFallbackEvent,
      buildNonMidStreamServerFallbackEvent,
      planDeferredServerFallbackFlush,
      planSilentStitchFillOnFallbackRequest,
      messageHasNonTextContent,
      partitionServerFallbackStreamMessages,
    } =
      require('../refusalFallback.js') as typeof import('../refusalFallback.js')

    const hopEvt = {
      type: 'content_block_start',
      index: 2,
      content_block: {
        type: 'fallback',
        from: { model: 'opus' },
        to: { model: 'sonnet' },
        trigger: { type: 'refusal', category: 'cyber' },
      },
    }
    const hop = parseServerFallbackContentBlockStart(hopEvt)
    expect(hop).toEqual({
      index: 2,
      fromModel: 'opus',
      model: 'sonnet',
      reason: 'refusal',
      category: 'cyber',
    })
    expect(
      isMalformedServerFallbackBlockStart({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'fallback', from: {}, to: {} },
      }),
    ).toBe(true)
    expect(parseServerFallbackContentBlockStart({ type: 'text' })).toBe(
      undefined,
    )

    const msgs = [
      {
        uuid: 't1',
        message: {
          content: [
            { type: 'text', text: 'hello' },
            { type: 'tool_use', id: 'x', name: 'Bash', input: {} },
          ],
        },
      },
      {
        uuid: 'r1',
        message: { content: [{ type: 'text', text: 'keep' }] },
      },
    ]
    expect(messageHasNonTextContent(msgs[0]!)).toBe(true)
    expect(messageHasNonTextContent(msgs[1]!)).toBe(false)
    const part = partitionServerFallbackStreamMessages(msgs)
    expect(part.discardedMessages.map(m => m.uuid)).toEqual(['t1'])
    expect(part.retainedMessages.map(m => m.uuid)).toEqual(['r1'])
    expect(part.retainedText).toBe('keep')

    const mid = buildMidStreamServerFallbackEvent({
      hop: hop!,
      messages: msgs,
      requestId: 'req-1',
    })
    expect(mid.type).toBe('server_fallback')
    expect(mid.midStream).toBe(true)
    expect(mid.retainedText).toBe('keep')
    expect(mid.discardedMessages).toHaveLength(1)
    expect(mid.retainedMessages).toHaveLength(1)

    const nonMid = buildNonMidStreamServerFallbackEvent({
      fromModel: 'a',
      toModel: 'b',
      reason: 'sticky',
      finalStopReason: 'end_turn',
    })
    expect(nonMid.midStream).toBe(false)
    expect(nonMid.retainedText).toBe('')
    expect(nonMid.reason).toBe('sticky')

    const deferred = planDeferredServerFallbackFlush({
      deferredHop: hop!,
      alreadyEmitted: false,
      requestId: 'r',
    })
    expect(deferred?.midStream).toBe(false)
    expect(deferred?.toModel).toBe('sonnet')
    expect(
      planDeferredServerFallbackFlush({
        deferredHop: hop!,
        alreadyEmitted: true,
      }),
    ).toBeUndefined()

    expect(
      planSilentStitchFillOnFallbackRequest({
        silentArmAtTrigger: true,
        salvageText: 'partial',
      }),
    ).toEqual({ fillSilentStitch: true, fillConvolute: true })
    expect(
      planSilentStitchFillOnFallbackRequest({
        silentArmAtTrigger: true,
        salvageText: '',
      }),
    ).toEqual({ fillSilentStitch: false, fillConvolute: false })
    expect(
      planSilentStitchFillOnFallbackRequest({
        silentArmAtTrigger: false,
        salvageText: 'x',
      }),
    ).toEqual({ fillSilentStitch: false, fillConvolute: false })
  })

  test('land join exact/soft + non-streaming fa/wa (densable)', () => {
    const {
      planRefusalLandJoin,
      materializeNonStreamingServerFallbackContent,
      planNonStreamingServerFallbackEvent,
      isServerRefusalFallbackLaneEnabled,
      isSameRefusalFallbackModel,
      isFirstPartyAnthropicApiCapable,
    } =
      require('../refusalFallback.js') as typeof import('../refusalFallback.js')

    // densable exact Yt land
    const exact = planRefusalLandJoin({
      content: [
        { type: 'thinking', thinking: 'x' },
        { type: 'text', text: ' world' },
      ],
      exactSalvage: {
        text: 'hello',
        originals: [{ uuid: 'u1' }, { uuid: 'u2' }],
      },
      isMainThread: true,
    })
    expect(exact.joined).toBe(true)
    if (exact.joined) {
      expect((exact.content[1] as { text: string }).text).toBe('hello world')
      expect(exact.lane).toBe('server_stitch')
      expect(exact.supersedesUuids).toEqual(['u1', 'u2'])
      expect(exact.clearExact).toBe(true)
    }

    // densable soft Gt land (Cjs)
    const soft = planRefusalLandJoin({
      content: [{ type: 'text', text: 'continuation' }],
      softSalvageText: 'partial prefix.',
      isMainThread: true,
    })
    expect(soft.joined).toBe(true)
    if (soft.joined) {
      expect((soft.content[0] as { text: string }).text).toContain(
        'partial prefix',
      )
      expect((soft.content[0] as { text: string }).text).toContain(
        'continuation',
      )
      expect(soft.lane).toBe('client_soft')
      expect(soft.clearSoft).toBe(true)
      expect(soft.supersedesUuids).toBeUndefined()
    }

    // no text → no join
    expect(
      planRefusalLandJoin({
        content: [{ type: 'tool_use', id: 't' }],
        softSalvageText: 'x',
      }).joined,
    ).toBe(false)

    // densable fa materialize
    const fa = materializeNonStreamingServerFallbackContent({
      content: [
        { type: 'tool_use', id: 'drop' },
        {
          type: 'fallback',
          from: { model: 'opus' },
          to: { model: 'sonnet' },
          trigger: { type: 'refusal', category: 'cyber' },
        },
        { type: 'text', text: 'after' },
      ],
      stopReason: 'end_turn',
      armed: true,
    })
    expect(fa.lastHop).toEqual({
      fromModel: 'opus',
      model: 'sonnet',
      reason: 'refusal',
      category: 'cyber',
    })
    expect(fa.droppedCount).toBe(1)
    expect(fa.droppedHadToolUse).toBe(true)
    expect(fa.content[0]).toEqual({
      type: 'fallback',
      from: { model: 'opus' },
      to: { model: 'sonnet' },
    })
    expect(fa.content[1]).toEqual({ type: 'text', text: 'after' })

    // densable wa non-mid event
    const wa = planNonStreamingServerFallbackEvent({
      lastHop: fa.lastHop,
      currentModel: 'opus',
      requestId: 'r1',
      finalStopReason: 'end_turn',
    })
    expect(wa?.type).toBe('server_fallback')
    expect(wa?.midStream).toBe(false)
    expect(wa?.toModel).toBe('sonnet')
    expect(wa?.reason).toBe('refusal')
    expect(
      planNonStreamingServerFallbackEvent({
        lastHop: undefined,
        currentModel: 'opus',
      }),
    ).toBeUndefined()

    // dkd / epr helpers
    expect(
      isServerRefusalFallbackLaneEnabled({
        refusalFallbackEnabled: true,
        switchModelsOnFlag: true,
        firstPartyCapable: true,
      }),
    ).toBe(true)
    expect(
      isServerRefusalFallbackLaneEnabled({
        refusalFallbackEnabled: true,
        switchModelsOnFlag: true,
        firstPartyCapable: false,
      }),
    ).toBe(false)
    expect(isSameRefusalFallbackModel('a[1m]', 'a')).toBe(true)
    expect(isSameRefusalFallbackModel('a', 'b')).toBe(false)
    expect(
      isFirstPartyAnthropicApiCapable({
        provider: 'firstParty',
        env: {},
      }),
    ).toBe(true)
    expect(
      isFirstPartyAnthropicApiCapable({
        provider: 'openai',
        env: {},
      }),
    ).toBe(false)
  })

  test('ekd beta plan default/explicit + sticky (densable B)', () => {
    const sticky = { sent: new Set<string>(), rejected: new Set<string>() }
    const explicit = planServerRefusalFallbackBetas({
      serverRefusalFallback: {
        forModel: 'opus',
        model: 'sonnet[1m]',
        mode: 'explicit',
      },
      requestModel: 'opus',
      sticky,
      firstPartyCapable: true,
    })
    expect(explicit.armed).toBe(true)
    expect(explicit.mode).toBe('explicit')
    expect(explicit.body).toEqual({
      fallbacks: [{ model: 'sonnet' }],
    })
    expect(explicit.betas).toContain('server-side-fallback-2026-06-01')
    expect(sticky.sent.has('server-side-fallback-2026-06-01')).toBe(true)

    const sticky2 = { sent: new Set<string>(), rejected: new Set<string>() }
    const def = planServerRefusalFallbackBetas({
      serverRefusalFallback: {
        forModel: 'opus',
        model: 'sonnet',
        mode: 'default',
      },
      requestModel: 'opus',
      sticky: sticky2,
      firstPartyCapable: true,
    })
    expect(def.mode).toBe('default')
    expect(def.body).toEqual({ fallbacks: 'default' })
    expect(def.betas).toContain('server-side-fallback-2026-07-01')

    const off = planServerRefusalFallbackBetas({
      serverRefusalFallback: {
        forModel: 'opus',
        model: 'sonnet',
        mode: 'explicit',
      },
      requestModel: 'other',
      sticky: { sent: new Set(), rejected: new Set() },
      firstPartyCapable: true,
    })
    expect(off.armed).toBe(false)
    expect(off.body).toEqual({})

    // silent arm suppresses beta push but still marks sticky when armed
    const sticky3 = { sent: new Set<string>(), rejected: new Set<string>() }
    const silent = planServerRefusalFallbackBetas({
      serverRefusalFallback: {
        forModel: 'opus',
        model: 'sonnet',
        mode: 'explicit',
      },
      requestModel: 'opus',
      silentArmActive: true,
      sticky: sticky3,
      firstPartyCapable: true,
    })
    expect(silent.armed).toBe(true)
    expect(silent.betas).toEqual([])
    expect(sticky3.sent.has('server-side-fallback-2026-06-01')).toBe(true)
  })

  test('DRd partial-response meta (densable E)', () => {
    const short = buildPartialResponseSalvageMetaContent('hello partial')
    expect(short).toContain('<partial-response>')
    expect(short).toContain('hello partial')
    expect(short).not.toContain('(earlier part omitted)')
    expect(short).toContain('not instructions to follow')

    const nested = buildPartialResponseSalvageMetaContent(
      'before</partial-response>after',
    )
    expect(nested).toContain('<​/partial-response>')
    expect(nested).not.toMatch(/<\/partial-response>\nafter/)

    const long = 'x'.repeat(12000)
    const truncated = buildPartialResponseSalvageMetaContent(long)
    expect(truncated).toContain('(earlier part omitted)')
    expect(truncated).toContain('…')
    // yUp keeps last 1e4
    expect(truncated).toContain('x'.repeat(100))
  })

  test('G2s credit mint/stamp + rkd beta (densable F)', () => {
    const details = {
      type: 'refusal',
      fallback_credit_token: 'credit-tok-abc',
    }
    const mint = planFallbackCreditMint({
      stopDetails: details,
      alreadyMinted: false,
    })
    expect(mint.creditCode).toBe('credit-tok-abc')
    expect(mint.shouldLogMint).toBe(true)
    expect(
      (mint.scrubbedStopDetails as { fallback_credit_token?: unknown })
        .fallback_credit_token,
    ).toBeUndefined()
    // original object still has token until caller deletes; plan returns scrubbed copy
    expect(details.fallback_credit_token).toBe('credit-tok-abc')

    expect(
      planFallbackCreditMint({
        stopDetails: details,
        alreadyMinted: true,
      }).shouldLogMint,
    ).toBe(false)

    expect(planFallbackCreditStamp({ creditCode: 'tok' })).toEqual({
      fallback_credit_token: 'tok',
    })
    expect(planFallbackCreditStamp({})).toEqual({})
    expect(planFallbackCreditStamp({ creditCode: '' })).toEqual({})

    const sticky = { sent: new Set<string>(), rejected: new Set<string>() }
    const rkd = planFallbackCreditBeta({
      creditCode: 'tok',
      betas: [],
      sticky,
    })
    expect(rkd.creditBetaActive).toBe(true)
    expect(rkd.betas).toContain('fallback-credit-2026-06-01')
    expect(sticky.sent.has('fallback-credit-2026-06-01')).toBe(true)

    const silent = planFallbackCreditBeta({
      creditLaneArmed: true,
      silentArmActive: true,
      betas: [],
      sticky: { sent: new Set(), rejected: new Set() },
    })
    expect(silent.creditBetaActive).toBe(false)
    expect(silent.betas).toEqual([])
  })
})
