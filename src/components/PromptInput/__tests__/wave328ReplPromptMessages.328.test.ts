import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Command } from '../../../commands.js'
import {
  formatPluginToastKey,
  parsePluginToastOwner,
} from '../../../components/toastStore.js'
import { shouldOmitPromptFromHistory } from '../../../history.js'
import {
  getMaxOutputTokensRecoveryPrompt,
  SUBAGENT_MAX_OUTPUT_TOKENS_RECOVERY_PROMPT,
  SUBAGENT_MAX_OUTPUT_TOKENS_SECOND_RECOVERY_PROMPT,
} from '../../../query/queryHelpers.js'
import {
  applySpinnerApiMetricsEvent,
  SpinnerTokenCounter,
} from '../../../screens/repl/runReplTurn.js'
import {
  evaluateWorkflowRateLimitLoginHold,
  reconcileWorkflowRateLimitWaitOnEvent,
  WORKFLOW_HELD_FOR_LOGIN_NOTICE,
  type WorkflowRateLimitWaitStatus,
} from '../../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { parseShellCompletionInputContext } from '../../../utils/bash/shellCompletion.js'
import {
  formatImageNotShown,
  IMAGE_NOT_SHOWN_PREFIX,
  redactImageNotShownForDisplay,
} from '../../../utils/imageResizer.js'
import {
  dedupeCommandsByName,
  generateCommandSuggestions,
} from '../../../utils/suggestions/commandSuggestions.js'
import {
  buildTranscriptShortcutHints,
  packTranscriptShortcutColumns,
} from '../../../screens/REPL.js'
import { formatEffortShortcutPair } from '../PromptInputHelpMenu.js'
import {
  classifyFailedTurnAction,
  getFailedRequestPlaceholder,
} from '../usePromptInputPlaceholder.js'

const ROOT = join(import.meta.dir, '../../../..')

describe('Wave 327-328 Group 4B: REPL / PromptInput / Messages / Spinner', () => {
  test('#383 REPL handleOpenRateLimitOptions clears half-typed bash draft and resets mode', () => {
    const replSrc = readFileSync(join(ROOT, 'src/screens/REPL.tsx'), 'utf8')
    expect(replSrc).toContain("if (draftController.mode === 'bash')")
    expect(replSrc).toContain('draftController.clear()')
    expect(replSrc).toContain("draftController.setMode('prompt')")
  })

  test('#388 evaluateWorkflowRateLimitLoginHold keeps workflow paused after login change until earlier login returns or prompt is typed', () => {
    const baseStatus: WorkflowRateLimitWaitStatus = {
      resetsAt: Math.floor(Date.now() / 1000) + 60,
      resumeAtMs: Date.now() + 60_000,
      waitingAgents: 2,
      armedFor: 'acct-a',
    }
    // Login switches to another account -> enters hold & announces
    const held = evaluateWorkflowRateLimitLoginHold({
      status: baseStatus,
      loginRelation: 'other',
      humanPrompts: 3,
      nowMs: baseStatus.resumeAtMs + 1000,
    })
    expect(held.isHeldForLogin).toBe(true)
    expect(held.shouldAnnounceHeld).toBe(true)
    expect(held.shouldResumeNow).toBe(false)
    expect(held.nextStatus.promptsAtHold).toBe(3)
    expect(WORKFLOW_HELD_FOR_LOGIN_NOTICE).toContain('Workflow paused')
    expect(WORKFLOW_HELD_FOR_LOGIN_NOTICE).toContain('/workflows to stop it')

    // Still held on same prompt count even after reset time passed
    const stillHeld = evaluateWorkflowRateLimitLoginHold({
      status: held.nextStatus,
      loginRelation: 'other',
      humanPrompts: 3,
      nowMs: baseStatus.resumeAtMs + 5000,
    })
    expect(stillHeld.isHeldForLogin).toBe(true)
    expect(stillHeld.shouldResumeNow).toBe(false)
    expect(stillHeld.shouldAnnounceHeld).toBe(false)

    // Typing a new human prompt resumes on current login
    const resumedByPrompt = evaluateWorkflowRateLimitLoginHold({
      status: held.nextStatus,
      loginRelation: 'other',
      humanPrompts: 4,
      nowMs: baseStatus.resumeAtMs + 5000,
    })
    expect(resumedByPrompt.shouldResumeNow).toBe(true)

    // Earlier login returning clears hold and resumes after reset time
    const resumedByEarlierLogin = evaluateWorkflowRateLimitLoginHold({
      status: held.nextStatus,
      loginRelation: 'same',
      humanPrompts: 3,
      nowMs: baseStatus.resumeAtMs + 5000,
    })
    expect(resumedByEarlierLogin.isHeldForLogin).toBe(false)
    expect(resumedByEarlierLogin.shouldResumeNow).toBe(true)
  })

  test('#455 dedupeCommandsByName and generateCommandSuggestions keep only the first skill of a duplicate name', () => {
    const firstSkill = {
      type: 'prompt' as const,
      name: 'deploy',
      description: 'Project deploy skill',
      source: 'projectSettings' as const,
      userFacingName: () => 'deploy',
      getPromptForCommand: async () => [],
    } as unknown as Command
    const secondSkill = {
      type: 'prompt' as const,
      name: 'deploy',
      description: 'User deploy skill',
      source: 'userSettings' as const,
      userFacingName: () => 'deploy',
      getPromptForCommand: async () => [],
    } as unknown as Command
    const otherSkill = {
      type: 'prompt' as const,
      name: 'status',
      description: 'Status skill',
      source: 'userSettings' as const,
      userFacingName: () => 'status',
      getPromptForCommand: async () => [],
    } as unknown as Command

    const deduped = dedupeCommandsByName([firstSkill, secondSkill, otherSkill])
    expect(deduped).toHaveLength(2)
    expect(deduped[0]).toBe(firstSkill)
    expect(deduped[1]).toBe(otherSkill)

    const slashSuggestions = generateCommandSuggestions('/deploy', [
      firstSkill,
      secondSkill,
      otherSkill,
    ])
    const deployRows = slashSuggestions.filter(s => s.displayText === '/deploy')
    expect(deployRows).toHaveLength(1)
    expect(deployRows[0]?.description).toContain('Project deploy skill')
  })

  test('#460 parseShellCompletionInputContext completes commands after &&, ||, ;, and |', () => {
    for (const input of [
      'echo hi && ',
      'echo hi &&',
      'echo hi; ',
      'echo hi;',
      'echo hi | ',
      'echo hi |',
      'echo hi || ',
    ]) {
      const ctx = parseShellCompletionInputContext(input, input.length)
      expect(ctx).toEqual({ prefix: '', completionType: 'command' })
    }
    const afterAndPrefix = parseShellCompletionInputContext(
      'echo hi && gr',
      'echo hi && gr'.length,
    )
    expect(afterAndPrefix).toEqual({
      prefix: 'gr',
      completionType: 'command',
    })
    const normalArg = parseShellCompletionInputContext('cat ', 'cat '.length)
    expect(normalArg).toEqual({ prefix: '', completionType: 'file' })
  })

  test('#463 classifyFailedTurnAction does not show Resend your message hints after spend caps or usage limits', () => {
    const spendCapMsg = {
      type: 'assistant',
      isApiErrorMessage: true,
      error: 'billing_error',
      message: {
        content: [
          {
            type: 'text',
            text: 'You have reached your extra usage spending cap for this month.',
          },
        ],
      },
    }
    const action = classifyFailedTurnAction([spendCapMsg])
    expect(action).toBe('wait')
    expect(getFailedRequestPlaceholder(action)).toBeUndefined()

    const usageLimitReachedMsg = {
      type: 'assistant',
      isApiErrorMessage: true,
      apiError: 'usage_limit_reached',
      message: { content: [{ type: 'text', text: 'Usage limit reached' }] },
    }
    expect(classifyFailedTurnAction([usageLimitReachedMsg])).toBe('wait')
    expect(
      getFailedRequestPlaceholder(
        classifyFailedTurnAction([usageLimitReachedMsg]),
      ),
    ).toBeUndefined()
  })

  test('#465 + #602 TranscriptShortcutsHelp keeps exit/close visible in short windows and PromptInputHelpMenu surfaces exitMessage', () => {
    const hints = buildTranscriptShortcutHints({
      exitShortcut: 'q',
      toggleShortcut: 'ctrl+o',
    })
    const shortCols = packTranscriptShortcutColumns(hints, 40, 4, s => s.length)
    expect(shortCols[0]?.slice(0, 2)).toEqual([
      'q/ctrl+o to exit',
      '? to close',
    ])

    expect(formatEffortShortcutPair('shift+up', 'shift+down')).toBe('shift+↑/↓')

    const helpSrc = readFileSync(
      join(ROOT, 'src/components/PromptInput/PromptInputHelpMenu.tsx'),
      'utf8',
    )
    expect(helpSrc).toContain(
      "exitMessage?.show ? `Press ${exitMessage.key ?? 'Ctrl-C'} again to exit` : null",
    )

    const footerSrc = readFileSync(
      join(ROOT, 'src/components/PromptInput/PromptInputFooter.tsx'),
      'utf8',
    )
    expect(footerSrc).toContain('exitMessage={exitMessage}')
  })

  test('#480 getMaxOutputTokensRecoveryPrompt tightens subagent instructions on second output token limit hit', () => {
    expect(getMaxOutputTokensRecoveryPrompt(true, 1)).toBe(
      SUBAGENT_MAX_OUTPUT_TOKENS_RECOVERY_PROMPT,
    )
    expect(getMaxOutputTokensRecoveryPrompt(true, 2)).toBe(
      SUBAGENT_MAX_OUTPUT_TOKENS_SECOND_RECOVERY_PROMPT,
    )
    expect(SUBAGENT_MAX_OUTPUT_TOKENS_SECOND_RECOVERY_PROMPT).toContain(
      'at most half the length',
    )
    expect(SUBAGENT_MAX_OUTPUT_TOKENS_SECOND_RECOVERY_PROMPT).toContain(
      'say so in your first line, then give what fits',
    )
    expect(getMaxOutputTokensRecoveryPrompt(false, 2)).not.toContain(
      'Your caller does not receive',
    )
  })

  test('#525 shouldOmitPromptFromHistory omits launch prompts from child Claude Code sessions', () => {
    expect(
      shouldOmitPromptFromHistory({ CLAUDE_CODE_CHILD_SESSION: '1' }),
    ).toBe(true)
    expect(
      shouldOmitPromptFromHistory({ CLAUDECODE: '1' }, { isTTY: false }),
    ).toBe(true)
    expect(
      shouldOmitPromptFromHistory({ CLAUDECODE: '1' }, { isTTY: true }),
    ).toBe(false)
    expect(
      shouldOmitPromptFromHistory({
        CLAUDE_CODE_CHILD_SESSION: '1',
        CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: '1',
      }),
    ).toBe(false)
    expect(shouldOmitPromptFromHistory({})).toBe(false)
  })

  test('#563 SpinnerTokenCounter avoids double-counting retried replies, advances while thinking, and counts non-streamed replies', () => {
    const counter = new SpinnerTokenCounter()

    // 1. Streaming thinking advances token counter (does not stand still)
    counter.onApiMetricsEvent({ type: 'start', ttftMs: 100 })
    counter.onApiMetricsEvent({ type: 'content_block_start' })
    counter.onApiMetricsEvent({
      type: 'thinking_progress',
      estimatedTokensDelta: 25,
    })
    expect(counter.tokenCount).toBe(25)
    counter.onApiMetricsEvent({
      type: 'thinking_progress',
      estimatedTokensDelta: 15,
    })
    expect(counter.tokenCount).toBe(40)

    // 2. Retried reply (new message_start with ttftMs) resets current reply so it is not counted twice
    counter.addDeltaChars(200)
    expect(counter.tokenCount).toBe(90) // (160 + 200) / 4
    counter.onStreamMessageStart(true)
    expect(counter.tokenCount).toBe(0)
    counter.addDeltaChars(80)
    expect(counter.tokenCount).toBe(20)
    counter.onStreamMessageDelta(30)
    expect(counter.tokenCount).toBe(30)

    // 3. Second reply in same turn keeps first reply's count via keepReply()
    counter.onApiMetricsEvent({ type: 'start', ttftMs: 50 })
    expect(counter.tokenCount).toBe(30)

    // 4. Non-streamed assistant reply is counted via usage.output_tokens
    counter.onAssistantMessage({
      message: {
        stop_reason: 'end_turn',
        usage: { output_tokens: 45 },
      },
    })
    expect(counter.tokenCount).toBe(75) // 30 kept + 45 non-streamed

    // applySpinnerApiMetricsEvent handles thinking_signature after thinking_progress
    const entries: Parameters<
      typeof applySpinnerApiMetricsEvent
    >[0]['entries'] = []
    let len = applySpinnerApiMetricsEvent({
      entries,
      responseLength: 0,
      event: { type: 'start' },
    })
    len = applySpinnerApiMetricsEvent({
      entries,
      responseLength: len,
      event: { type: 'content_block_start' },
    })
    len = applySpinnerApiMetricsEvent({
      entries,
      responseLength: len,
      event: { type: 'thinking_progress', estimatedTokensDelta: 10 },
    })
    len = applySpinnerApiMetricsEvent({
      entries,
      responseLength: len,
      event: { type: 'thinking_signature', chars: 80 },
    })
    expect(len).toBe(80)
  })

  test('#606 formatImageNotShown and redactImageNotShownForDisplay replace cached path with [Image]', () => {
    const cacheDir = '/Users/dev/.claude/image-cache'
    const hash = 'a'.repeat(64)
    const note = formatImageNotShown(`${cacheDir}/image-${hash}.png`)
    expect(note.startsWith(IMAGE_NOT_SHOWN_PREFIX)).toBe(true)
    expect(
      redactImageNotShownForDisplay(`Check ${note} please`, cacheDir),
    ).toBe('Check [Image] please')
    const sessionNote = formatImageNotShown(
      `${cacheDir}/sess-123/image-${hash}.jpeg`,
    )
    expect(
      redactImageNotShownForDisplay(`Look: ${sessionNote}`, cacheDir),
    ).toBe('Look: [Image]')
    // Paths outside the image cache directory are untouched
    const outsideNote = formatImageNotShown('/tmp/other/image.png')
    expect(redactImageNotShownForDisplay(outsideNote, cacheDir)).toBe(
      outsideNote,
    )
  })

  test('#622 formatPluginToastKey scopes toast keys by plugin name', () => {
    const keyA = formatPluginToastKey('alpha', '123')
    const keyB = formatPluginToastKey('beta', '123')
    expect(keyA).toBe('plugin-toast-alpha:123')
    expect(keyB).toBe('plugin-toast-beta:123')
    expect(keyA).not.toBe(keyB)
    expect(parsePluginToastOwner(keyA)).toBe('alpha')
    expect(parsePluginToastOwner(keyB)).toBe('beta')
    expect(parsePluginToastOwner('other-key')).toBeUndefined()
  })

  test('Companion & Sub-Wave I production wires exist in owned files', () => {
    const replSrc = readFileSync(join(ROOT, 'src/screens/REPL.tsx'), 'utf8')
    const runTurnSrc = readFileSync(
      join(ROOT, 'src/screens/repl/runReplTurn.ts'),
      'utf8',
    )
    const messagesSrc = readFileSync(
      join(ROOT, 'src/components/Messages.tsx'),
      'utf8',
    )
    const promptInputSrc = readFileSync(
      join(ROOT, 'src/components/PromptInput/PromptInput.tsx'),
      'utf8',
    )
    const slashSrc = readFileSync(
      join(ROOT, 'src/utils/processUserInput/processSlashCommand.tsx'),
      'utf8',
    )
    const webSearchSrc = readFileSync(
      join(
        ROOT,
        'packages/builtin-tools/src/tools/WebSearchTool/WebSearchTool.ts',
      ),
      'utf8',
    )
    const pluginsHookSrc = readFileSync(
      join(ROOT, 'src/hooks/useManagePlugins.ts'),
      'utf8',
    )

    // #370
    expect(replSrc).toContain('hasMissingEarlierMessages(')
    expect(replSrc).toContain('createMissingEarlierMessagesWarning()')
    // #398 / #399 / #524
    expect(pluginsHookSrc).toContain('beginInitialPluginLoad(')
    expect(pluginsHookSrc).toContain('mergeCliAgentsIntoDefinitions(')
    expect(runTurnSrc).toContain('waitForInitialPluginsLoaded(')
    expect(replSrc).toContain('ensurePluginAgentLoadedForResume(')
    // #432
    expect(replSrc).toContain('setEnvHookNotifier(')
    expect(replSrc).toContain('formatOutsideReplHookFailures(')
    // #434
    expect(messagesSrc).toContain(
      'const focusIsLoading = isLoading && !isStopHookRunning',
    )
    expect(replSrc).toContain(
      'isStopHookRunning={Boolean(stopHookSpinnerSuffix)}',
    )
    // #555
    expect(runTurnSrc).toContain('renderSystemPrompt:')
    // #573 / #574 / #575 / #582
    expect(replSrc).toContain('codeModePlan.autoBackgroundEligible')
    expect(replSrc).toContain('codeModePlan.interruptedScriptNotice')
    expect(replSrc).toContain('mergeCodeModeReplySideEffects(')
    expect(replSrc).toContain('shouldAutoStartCodeModeTurnAfterCommand(')
    // #397
    expect(slashSrc).toContain('imageContentBlocks.length > 0')
    expect(slashSrc).toContain('imagePasteIds:')
    // #664 / #665
    expect(slashSrc).toContain('formatCodeReviewForegroundForkResult(')
    // #601
    expect(promptInputSrc).toContain(
      "onImagePaste: mode === 'bash' ? undefined : onImagePaste",
    )
    // #594
    expect(webSearchSrc).toContain('throw new AbortError()')
    // #582: Esc sets codeModeInterruptedByEscRef and slash commands consult shouldAutoStartCodeModeTurnAfterCommand
    expect(replSrc).toContain('codeModeInterruptedByEscRef.current = true')
    expect(replSrc).toContain('codeModeInterruptedByEscRef.current = false')
    // #388: REPL wires setWorkflowRateLimitWait & evaluateWorkflowRateLimitLoginHold
    expect(replSrc).toContain('setWorkflowRateLimitWait(')
    expect(replSrc).toContain('evaluateWorkflowRateLimitLoginHold(')
    // #606: REPL wires formatBackgroundAgentImageNote for non-inline background agent images
    expect(replSrc).toContain('formatBackgroundAgentImageNote(cachePath)')

    // #447: launchAutofixPr wires createAutofixCancelController + onCancel on AutofixProgress
    const autofixSrc = readFileSync(
      join(ROOT, 'src/commands/autofix-pr/launchAutofixPr.ts'),
      'utf8',
    )
    expect(autofixSrc).toContain(
      'const cancelController = createAutofixCancelController(',
    )
    expect(autofixSrc).toContain('onCancel: cancelController.cancelNow')

    // #422: artifacts.tsx wires fetchPaginatedArtifacts and passes loading/incomplete/loadError
    const artifactsSrc = readFileSync(
      join(ROOT, 'src/commands/artifacts/artifacts.tsx'),
      'utf8',
    )
    expect(artifactsSrc).toContain('fetchPaginatedArtifacts')
    expect(artifactsSrc).toContain('loading={loading}')
    expect(artifactsSrc).toContain('incomplete={incomplete}')
    expect(artifactsSrc).toContain('loadError={loadError}')
  })

  test('#388 reconcileWorkflowRateLimitWaitOnEvent holds paused workflow on login change and resumes after prompt', () => {
    let appState: {
      tasks: Record<
        string,
        {
          id: string
          type: 'local_workflow'
          status: 'paused' | 'running'
          agentCount: number
          rateLimitWait?: WorkflowRateLimitWaitStatus
        }
      >
    } = {
      tasks: {
        'wf-1': {
          id: 'wf-1',
          type: 'local_workflow',
          status: 'paused',
          agentCount: 2,
          rateLimitWait: {
            resetsAt: 2000,
            resumeAtMs: 2_000_000,
            waitingAgents: 2,
          },
        },
      },
    }
    const setAppState = (
      updater: (prev: typeof appState) => typeof appState,
    ) => {
      appState = updater(appState)
    }

    const held = reconcileWorkflowRateLimitWaitOnEvent({
      tasks: appState.tasks,
      loginRelation: 'other',
      humanPrompts: 3,
      nowMs: 1_500_000,
      setAppState: setAppState as never,
    })
    expect(held.anyHeld).toBe(true)
    expect(held.shouldAnnounceHeld).toBe(true)
    expect(appState.tasks['wf-1']?.rateLimitWait?.isHeldForLogin).toBe(true)
    expect(appState.tasks['wf-1']?.rateLimitWait?.promptsAtHold).toBe(3)

    // After user types a new prompt (humanPrompts = 4 > 3), wait clears and workflow resumes
    const resumed = reconcileWorkflowRateLimitWaitOnEvent({
      tasks: appState.tasks,
      loginRelation: 'other',
      humanPrompts: 4,
      nowMs: 1_600_000,
      setAppState: setAppState as never,
    })
    expect(resumed.resumedTaskIds).toEqual(['wf-1'])
    expect(appState.tasks['wf-1']?.rateLimitWait).toBeUndefined()
  })
})
