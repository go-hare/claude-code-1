import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..')

describe('gold thinking Ss paint', () => {
  test('AssistantThinkingMessage uses therefore glyph and collapsed italic', async () => {
    const src = await Bun.file(
      join(ROOT, 'src/components/messages/AssistantThinkingMessage.tsx'),
    ).text()
    expect(src).toContain('THEREFORE')
    expect(src).toContain('aria-label="thinking:"')
    expect(src).toContain('capProseWidth')
    expect(src).not.toContain("label = '∴ Thinking'")
    expect(src).not.toContain('CtrlOToExpand')
  })

  test('Message.tsx hides thinking unless transcript or verbose', async () => {
    const src = await Bun.file(join(ROOT, 'src/components/Message.tsx')).text()
    const idx = src.indexOf("case 'thinking'")
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 800)
    expect(slice).toContain('leftoverTut')
    expect(slice).toContain('AssistantNarrationMessage')
    expect(slice).toContain('!isTranscriptMode && !verbose')
    expect(slice).toContain('return null')
    expect(slice).not.toContain('hideInTranscript')
    expect(slice).not.toContain('lastThinkingBlockId.has')
  })

  test('Za narration row is claude-dot Markdown, not Ss therefore', async () => {
    const src = await Bun.file(
      join(ROOT, 'src/components/messages/AssistantNarrationMessage.tsx'),
    ).text()
    expect(src).toContain('aria-label="claude:"')
    expect(src).toContain('BLACK_CIRCLE')
    expect(src).toContain('fromLeftEdge')
    expect(src).toContain('capProseWidth')
    expect(src).toContain("hint={hideSummaryHint ? undefined : 'summary'}")
    expect(src).not.toContain('THEREFORE')
    expect(src).not.toContain('aria-label="thinking:"')
    const md = await Bun.file(join(ROOT, 'src/components/Markdown.tsx')).text()
    expect(md).toContain('hint?: string')
    expect(md).toContain('leftoverHint')
    expect(md).toContain('color="subtle"')
    const message = await Bun.file(
      join(ROOT, 'src/components/Message.tsx'),
    ).text()
    expect(message).toContain('leftoverQuizzicalShore(model)')
    const spinner = await Bun.file(
      join(ROOT, 'src/components/Spinner.tsx'),
    ).text()
    expect(spinner).not.toContain('leftoverIhrBind')
    expect(spinner).toContain('leftoverIhrSlice')
    expect(spinner).toContain('leftoverIhrHas')
    const repl = await Bun.file(join(ROOT, 'src/screens/REPL.tsx')).text()
    expect(repl).toContain(
      'leftoverIhrMain(getSessionId()).applyCompactProgress',
    )
    const clock = await Bun.file(
      join(ROOT, 'src/components/messages/CollapsedReadSearchContent.tsx'),
    ).text()
    expect(clock).toContain('leftoverIhrSubscribe')
    expect(clock).toContain('useSyncExternalStore')
  })

  test('Messages does not paint live Ss from streamingThinking', async () => {
    const src = await Bun.file(join(ROOT, 'src/components/Messages.tsx')).text()
    expect(src).not.toContain('streamingThinking.thinking')
    expect(src).not.toContain('isStreamingThinkingVisible')
    expect(src).not.toContain('AssistantThinkingMessage')
    expect(src).not.toContain('withholdThinkingOnly')
  })

  test('absorb stamps leftoverEm summary unconditionally like gold Spn', async () => {
    const absorb = await Bun.file(
      join(ROOT, 'src/utils/collapseReadSearch.ts'),
    ).text()
    expect(absorb).toContain(
      'if (summary) group.latestThinkingSummary = summary',
    )
    expect(absorb).not.toContain('leftoverShouldStampThinkingSummary')
    expect(absorb).not.toContain('isFirstPartyAnthropicBaseUrl')
    expect(absorb).not.toContain('withholdThinkingOnly')
    expect(absorb).not.toContain('function leftoverThinkingOnlyGroup')
  })

  test('thinking-block text_delta is gated off the live preview', async () => {
    const src = await Bun.file(join(ROOT, 'src/utils/messages.ts')).text()
    expect(src).toContain('isOpenThinkingPreviewBlock')
    expect(src).toContain('setOpenStreamPreviewBlock')
    expect(src).toContain("t === 'thinking' || t === 'redacted_thinking'")
  })

  test('collapse hint does not paint thinking body as effectiveHint', async () => {
    const src = await Bun.file(
      join(ROOT, 'src/components/messages/CollapsedReadSearchContent.tsx'),
    ).text()
    expect(src).toContain('leftoverPcHold')
    expect(src).toContain('leftoverEm ? leftoverSs : displayedHint')
    expect(src).toContain('leftoverHx')
    expect(src).toContain('italic')
    expect(src).not.toContain('thinkingSummary ?? displayedHint')
    expect(src).toContain('LEFTOVER_SS_HOLD_MS')
    expect(src).toContain("isActiveGroup ? 'Thinking' : 'Thought'")
  })

  test('Thought for verbose expand is gold content[0] Ss only (no analog fallbacks)', async () => {
    const src = await Bun.file(
      join(ROOT, 'src/components/messages/CollapsedReadSearchContent.tsx'),
    ).text()
    expect(src).toContain('const content = blocks[0]')
    expect(src).toContain("content?.type === 'thinking' && content.thinking")
    expect(src).not.toContain('AssistantRedactedThinkingMessage')
    expect(src).not.toContain('paintedThinking')
    expect(src).not.toContain('thought-summary')
    expect(src).not.toContain('thought-for-fallback')
    expect(src).not.toContain('thinking-empty')
    expect(src).not.toContain("content?.type === 'redacted_thinking'")
  })

  test('collapsed Thought for is gold Io (thoughtForMs or summary)', async () => {
    const src = await Bun.file(
      join(ROOT, 'src/components/messages/CollapsedReadSearchContent.tsx'),
    ).text()
    expect(src).toContain(
      'thoughtForMs > 0 || message.latestThinkingSummary !== undefined',
    )
    expect(src).not.toContain('isActiveGroup === true && thoughtForMs > 0')
    expect(src).toContain('LeftoverThoughtClock')
    expect(src).toContain('leftoverZcMs')
    const absorb = await Bun.file(
      join(ROOT, 'src/utils/collapseReadSearch.ts'),
    ).text()
    expect(absorb).toContain('function leftoverSpn')
    expect(absorb).toContain('s.blank')
    expect(absorb).toContain('function leftoverDve')
    expect(absorb).not.toContain('function isThinkingAssistant')
    expect(src).toContain('leftoverLastThinkingAtMs')
    expect(src).toContain('message.isLiveBriefTurn !== true')
    expect(src).toContain('leftoverIhrThinkingStartedAt')
    expect(src).toContain('leftoverIhrSubscribe')
    const ihrStore = await Bun.file(
      join(ROOT, 'src/state/leftoverIhrStore.tsx'),
    ).text()
    expect(ihrStore).toContain('leftoverIhrRequireStore')
    expect(ihrStore).toContain('LeftoverIhrStoreProvider')
    const appState = await Bun.file(join(ROOT, 'src/state/AppState.tsx')).text()
    expect(appState).toContain('LeftoverIhrStoreProvider')
    expect(absorb).toContain('leftoverIhrPhn')
    expect(absorb).toContain('leftoverIhrUxe')
    expect(absorb).toContain('leftoverIhrSanitizeRetry')
    expect(absorb).toContain('leftoverIhrPickVerb')
    const runner = await Bun.file(
      join(ROOT, 'src/utils/swarm/inProcessRunner.ts'),
    ).text()
    expect(runner).toContain('leftoverIhrPhn')
    expect(runner).toContain('leftoverIhrPhn(taskId)')
    expect(runner).not.toContain('leftoverIhrPhn(identity.agentId)')
    expect(runner).not.toContain('leftoverTeammateContext')
    expect(runner).toContain('setRetryStatus: status =>')
    expect(runner).toContain('setRetryStatus: undefined')
    expect(runner).not.toContain('leftoverCompactPhn')
    const engine = await Bun.file(join(ROOT, 'src/QueryEngine.ts')).text()
    expect(engine).toContain('leftoverIhrStartXe')
    expect(engine).toContain('leftoverIhrMain')
    expect(engine).toContain('setRetryStatus: leftoverIhrSdkRetry')
    expect(engine).toContain('setStreamMode: leftoverIhrSdkMode')
    expect(engine).toContain("type === 'spinner_mode'")
    const query = await Bun.file(join(ROOT, 'src/query.ts')).text()
    expect(query).toContain("type: 'spinner_mode'")
    expect(query).toContain('leftoverIhrStampTurnEffort')
    expect(query).toContain('leftoverStampTurnEffort(sf.toModel)')
    expect(query).toContain('leftoverStampTurnEffort(switchTo)')
    expect(query).toContain(
      'leftoverIhrStampTurnEffort(params.toolUseContext.agentId, null, null)',
    )
    expect(absorb).toContain(
      'if (!Object.hasOwn(leftoverIhrState, agentId)) return',
    )
    const forked = await Bun.file(join(ROOT, 'src/utils/forkedAgent.ts')).text()
    expect(forked).toContain('setStreamMode: undefined')
    expect(forked).toContain('setRetryStatus: overrides?.setRetryStatus')
    expect(forked).not.toContain('leftoverIhrPhn(childAgentId)')
    expect(runner).not.toContain('toolUseContext.setRetryStatus?.(status)')
    expect(forked).not.toContain('parentSetStreamMode')
    expect(runner).not.toContain('toolUseContext.setStreamMode?.(mode)')
    expect(runner).toContain('agentId: asAgentId(taskId)')
    expect(absorb).toContain("mode: ''")
    const repl = await Bun.file(join(ROOT, 'src/screens/REPL.tsx')).text()
    expect(repl).toContain('leftoverIhrUxe.setSpinnerColors')
    expect(repl).toContain('leftoverIhrMain(getSessionId()).setRetryStatus')
    expect(repl).toContain('leftoverIhrMain(getSessionId()).setMode')
    expect(repl).toContain(
      'leftoverIhrMain(getSessionId()).applyCompactProgress',
    )
    expect(repl).toContain('leftoverIhrMain(getSessionId()).resetOverrides')
    expect(repl).toContain('leftoverIhrMain(getSessionId()).setTurnEffort')
    expect(repl).toContain('LeftoverMhrRetryRow')
    const bootstrap = await Bun.file(
      join(ROOT, 'src/services/api/bootstrap.ts'),
    ).text()
    expect(bootstrap).toContain('leftoverQrrInstallReadGate')
    expect(runner).toContain('setTurnEffort(null, null)')
    expect(runner).toContain('if (isRunAgentSpinnerMode(message)) {')
    expect(runner).toContain('leftoverTeammatePhn?.setMode(message.mode)')
    const sessionStart = await Bun.file(
      join(ROOT, 'src/utils/sessionStart.ts'),
    ).text()
    expect(sessionStart).toContain('LEFTOVER_IHR_SESSION_START')
    expect(sessionStart).toContain('leftoverIhrUxe.setSpinnerMessage')
    const agent = await Bun.file(
      join(ROOT, 'src/tasks/LocalAgentTask/LocalAgentTask.tsx'),
    ).text()
    expect(agent).toContain('leftoverIhrEvict(taskId)')
    const spinner = await Bun.file(
      join(ROOT, 'src/components/Spinner.tsx'),
    ).text()
    expect(spinner).toContain('leftoverIhrGet(leftoverIhrSession).defaultVerb')
    expect(spinner).toContain('leftoverIhrSlice')
    expect(spinner).toContain('leftoverIhrHas')
    expect(src).toContain('useLeftoverIhrStore')
    expect(absorb).toContain('defaultVerb: leftoverIhrPickVerb()')
    expect(absorb).toContain('leftoverSilentTurnReminder')
    const attachments = await Bun.file(
      join(ROOT, 'src/utils/attachments.ts'),
    ).text()
    expect(attachments).toContain("maybe('silent_turn_reminder'")
    expect(src).not.toContain('export function $s')
  })
})
