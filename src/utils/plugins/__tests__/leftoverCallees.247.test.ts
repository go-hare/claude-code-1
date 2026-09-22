import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import { installedPluginsRegistryKey } from '../installedPluginsManager.js'

describe('densable 2.1.247 leftover callee 接', () => {
  test('K8 writes pluginCache .orphaned_at inPlace when mp/ra/qr match', () => {
    const src = readFileSync(join(import.meta.dir, '../cacheUtils.ts'), 'utf8')
    expect(src).toContain('storageV5?: unknown')
    expect(src).toContain("publishDiscipline: 'inPlace'")
    expect(src).toContain("namespace: 'pluginCache'")
    expect(src).toContain('relPath: [ORPHANED_AT_FILENAME]')
    expect(src).toContain('cacheRoot === officialPluginCacheRoot()')
    expect(src).toContain('isPluginCacheVersionDirPath(versionPath, cacheRoot)')
  })

  test('TB is leftover-wired XX("installed", Fs())', () => {
    expect(
      installedPluginsRegistryKey(join(getClaudeConfigHomeDir(), 'plugins')),
    ).toEqual({ namespace: 'pluginRegistry', file: 'installed' })
    expect(installedPluginsRegistryKey('/tmp/other-plugins')).toBeNull()
    const src = readFileSync(
      join(import.meta.dir, '../installedPluginsManager.ts'),
      'utf8',
    )
    expect(src).toContain('_storageV5?: unknown')
    expect(src).not.toContain('function z0n')
    expect(src).not.toContain('function qBo')
    expect(src).not.toContain('function F0n')
  })

  test('nPe is ay + Jr.mutate + t3; Is writes userSettings followAtomic', () => {
    const options = readFileSync(
      join(import.meta.dir, '../pluginOptionsStorage.ts'),
      'utf8',
    )
    expect(options).toContain('export async function deletePluginOptions(')
    expect(options).toContain('persistSettingsForSource(')
    expect(options).toContain('storage lock unavailable')
    expect(options).toContain('clearPluginOptionsCache()')
    const settings = readFileSync(
      join(import.meta.dir, '../../settings/settings.ts'),
      'utf8',
    )
    expect(settings).toContain(
      'export async function persistSettingsForSource(',
    )
    expect(settings).toContain("publishDiscipline: 'followAtomic'")
    expect(settings).toContain("namespace: 'settings', layer: 'user'")
    expect(settings).toContain('settings storageV5 write failed:')
  })

  test('dPe calls yln before pluginUsage persist wipe', () => {
    const src = readFileSync(
      join(import.meta.dir, '../marketplaceManager.ts'),
      'utf8',
    )
    const wipe = src.slice(src.indexOf('function wipePluginUsage('))
    expect(wipe).toContain('wipePendingPluginUsage(wanted)')
    expect(wipe.indexOf('wipePendingPluginUsage(wanted)')).toBeLessThan(
      wipe.indexOf('saveGlobalConfig(current =>'),
    )
  })

  test('HP is leftover-wired WeakOwnerCache.of(k.host); fn/bn not invented', () => {
    const src = readFileSync(
      join(import.meta.dir, '../pluginUsagePending.ts'),
      'utf8',
    )
    expect(src).toContain('pendingUsageOwners.of(getBootstrapSessionHost())')
    expect(src).toContain('r.count++')
    expect(src).toContain('r.lastUsedAt = t')
    expect(src).toContain('n.pendingUsage.set(e, { count: 1, lastUsedAt: t })')
    expect(src).toContain('lastUsedNumStartups: t.numStartups')
    expect(src).toContain('uln({ flush: oko, flushAtExit: sko })')
    expect(src).toContain('const Xwo = 60_000')
    expect(src).not.toContain('function bn(')
    expect(src).not.toContain('class fn')
  })

  test('Xi/Zt is k.host; slot classes not invented', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../sessionHost.ts'),
      'utf8',
    )
    expect(src).toContain('export class SessionHost')
    expect(src).toContain('export function createSessionHost()')
    expect(src).toContain(
      'backgroundHousekeeping: new BackgroundHousekeeping()',
    )
    expect(src).not.toContain('new Map<string, object>')
    expect(src).not.toContain('class Yt')
    expect(src).not.toContain('class jt')
    const root = readFileSync(
      join(import.meta.dir, '../../sessionRoot.ts'),
      'utf8',
    )
    expect(root).toContain('return getBootstrapSessionHost()')
    expect(root).not.toContain('class Yt')
    expect(root).not.toContain('class jt')
  })

  test('cn increments dm(pluginInfo.repository) on prompt paths', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../processUserInput/processSlashCommand.tsx'),
      'utf8',
    )
    expect(src).toContain(
      'incrementPluginUsage(returnedCommand.pluginInfo.repository)',
    )
    expect(
      src.split('incrementPluginUsage(returnedCommand.pluginInfo.repository)')
        .length - 1,
    ).toBe(2)
  })

  test('h8/H0 wraps createRoot render with ce(storageV5) Provider', () => {
    const src = readFileSync(join(import.meta.dir, '../../inkRoot.ts'), 'utf8')
    expect(src).toContain('wrapWithSessionServices(node, storageV5)')
    expect(src).toContain('createRoot as createInkRoot')
    expect(src).toContain("'storageV5' in options")
    const main = readFileSync(
      join(import.meta.dir, '../../../main.tsx'),
      'utf8',
    )
    expect(main).toContain("import('./utils/inkRoot.js')")
    expect(main).not.toContain("import('@anthropic/ink'),")
  })

  test('SendFeedback leftover bodies are wired including /config + sr drafts panel', () => {
    const tool = readFileSync(
      join(
        import.meta.dir,
        '../../../../packages/builtin-tools/src/tools/SendFeedbackTool/SendFeedbackTool.ts',
      ),
      'utf8',
    )
    const tools = readFileSync(
      join(import.meta.dir, '../../../tools.ts'),
      'utf8',
    )
    const gates = readFileSync(
      join(import.meta.dir, '../../feedbackDrafts/gates.ts'),
      'utf8',
    )
    const schema = readFileSync(
      join(import.meta.dir, '../../settings/types.ts'),
      'utf8',
    )
    const command = readFileSync(
      join(import.meta.dir, '../../../commands/feedback/index.ts'),
      'utf8',
    )
    const bugCommand = readFileSync(
      join(import.meta.dir, '../../../commands/bug/index.ts'),
      'utf8',
    )
    const commandsRegistry = readFileSync(
      join(import.meta.dir, '../../../commands.ts'),
      'utf8',
    )
    const submitDraft = readFileSync(
      join(import.meta.dir, '../../feedbackDrafts/submitDraft.ts'),
      'utf8',
    )
    const parseDraft = readFileSync(
      join(
        import.meta.dir,
        '../../feedbackDrafts/parseDraftTranscriptMessages.ts',
      ),
      'utf8',
    )
    const feedbackUi = readFileSync(
      join(import.meta.dir, '../../../components/Feedback.tsx'),
      'utf8',
    )
    expect(tools).toContain('SendFeedbackTool')
    expect(tools).not.toContain("feature('SEND_FEEDBACK')")
    expect(tool).toContain('name: SEND_FEEDBACK_TOOL_NAME')
    expect(tool).toContain('isSendFeedbackEnabled()')
    expect(tool).toContain('tryConsumeSendFeedbackCall()')
    expect(tool).toContain("trigger: 'model_judgment'")
    expect(gates).toContain(
      'getFeedbackDraftsSettingLayers()[0] ?? FEEDBACK_DRAFTS_DEFAULT',
    )
    expect(gates).toContain(
      "getFeatureValue_CACHED_MAY_BE_STALE('tengu_juniper_relay', false)",
    )
    expect(gates).toContain(
      '/feedback has been disabled via the DISABLE_FEEDBACK_COMMAND environment variable',
    )
    expect(schema).toContain(
      'Model-drafted feedback (the SendFeedback tool). "notify" (default) shows a one-line notice when a draft is queued; "quiet" shows only the footer counter; "off" disables the tool entirely so drafts are never queued.',
    )
    expect(command).toContain('getFeedbackCommandAvailability()')
    expect(command).toContain(".kind === 'post'")
    expect(command).toContain(
      "description: 'Send feedback to Anthropic or report a bug'",
    )
    expect(command).not.toContain('aliases')
    expect(bugCommand).toContain("name: 'bug'")
    expect(bugCommand).toContain(
      "description: 'Report a bug or share your conversation'",
    )
    expect(bugCommand).not.toContain('aliases')
    expect(commandsRegistry).toContain(
      "import bug from './commands/bug/index.js'",
    )
    expect(feedbackUi).not.toContain('SendFeedback')
    expect(feedbackUi).not.toContain('card_send_as_is')
    const notice = readFileSync(
      join(import.meta.dir, '../../feedbackDrafts/notice.ts'),
      'utf8',
    )
    const card = readFileSync(
      join(import.meta.dir, '../../../components/FeedbackDraftNotice.tsx'),
      'utf8',
    )
    const footer = readFileSync(
      join(
        import.meta.dir,
        '../../../components/PromptInput/PromptInputFooterLeftSide.tsx',
      ),
      'utf8',
    )
    const repl = readFileSync(
      join(import.meta.dir, '../../../screens/REPL.tsx'),
      'utf8',
    )
    expect(notice).toContain('function markFeedbackNoticeShown')
    expect(notice).toContain('function tryStartFeedbackDraftSeed')
    expect(notice).toContain('function canShowFeedbackTurnOffPrompt')
    expect(notice).toContain('function setSeededSessionDraftCount')
    expect(notice).toContain('function decrementSessionDraftCount')
    expect(card).toContain('Turn off Claude-drafted feedback?')
    expect(card).toContain('Send without reviewing')
    expect(card).toContain('card_send_as_is')
    expect(footer).toContain('key="feedback-drafts"')
    expect(footer).toContain('FeedbackDraftFooter')
    expect(repl).toContain('FeedbackDraftNotice')
    expect(repl).toContain('onOpenFeedback={handleSurveyRequestFeedback}')
    const config = readFileSync(
      join(import.meta.dir, '../../../components/Settings/Config.tsx'),
      'utf8',
    )
    const draftsPanel = readFileSync(
      join(import.meta.dir, '../../../components/FeedbackDrafts.tsx'),
      'utf8',
    )
    const feedbackCommand = readFileSync(
      join(import.meta.dir, '../../../commands/feedback/feedback.tsx'),
      'utf8',
    )
    const bugUi = readFileSync(
      join(import.meta.dir, '../../../commands/bug/bug.tsx'),
      'utf8',
    )
    expect(config).toContain("id: 'feedbackDrafts'")
    expect(config).toContain("label: 'Claude-drafted feedback'")
    expect(config).toContain('isSendFeedbackSessionEnabled()')
    expect(config).toContain("via: 'config'")
    expect(draftsPanel).toContain('title="Feedback drafts"')
    expect(draftsPanel).toContain('+ Write new feedback')
    expect(draftsPanel).toContain(
      'Turn off Claude-drafted feedback anytime in /config.',
    )
    expect(draftsPanel).toContain('submitQueuedFeedbackDraft')
    expect(draftsPanel).toContain('setSeededSessionDraftCount')
    expect(draftsPanel).not.toContain('seedSessionDraftCount(')
    expect(feedbackCommand).not.toContain('isSendFeedbackSessionEnabled()')
    expect(feedbackCommand).toContain('isSendFeedbackEnabled()')
    expect(feedbackCommand).toContain('isFeedbackCallHt()')
    expect(feedbackCommand).toContain("args?.trim() === 'public'")
    expect(feedbackCommand).toContain('onWriteNew')
    expect(feedbackCommand).toContain('FeedbackDrafts')
    expect(bugUi).toContain('callLegacyFeedbackDialog')
    expect(bugUi).not.toContain('FeedbackDrafts')
    expect(parseDraft).toContain('function sessionMessagesToDraftTranscript')
    expect(submitDraft).toContain(
      'transcript = sessionMessagesToDraftTranscript(currentSessionMessages)',
    )
    expect(submitDraft).toContain('resolveDraftTranscriptPath')
    expect(submitDraft).toContain('readTranscriptTail')
    expect(submitDraft).toContain('dropTornTranscriptHead')
    expect(submitDraft).toContain('transcriptContentCorroboratesDraft')
    expect(submitDraft).toContain(
      'if (fromThisSession) decrementSessionDraftCount(1)',
    )
    expect(submitDraft).toContain(
      'checkAndRefreshOAuthTokenIfNeeded(0, false, credentials, storageV5)',
    )
    expect(submitDraft).toContain('isZdrOrg')
    expect(submitDraft).toContain(
      'Feedback collection is not available for organizations with custom data retention policies.',
    )
    expect(submitDraft).toContain("leftoverIe('feedback_draft_submit')")
    expect(submitDraft).toContain('leftoverAe(')
    expect(submitDraft).toContain("posted.failureReason ?? 'network_error'")
    expect(card).toContain('submitQueuedFeedbackDraft')
    expect(card).toContain("via: 'card_send_as_is'")
    expect(card).toContain('credentials')
    expect(card).toContain('includeTranscript: false')
    const writeDraft = readFileSync(
      join(import.meta.dir, '../../feedbackDrafts/writeDraft.ts'),
      'utf8',
    )
    expect(writeDraft).toContain('function resolveDraftTranscriptPath')
    expect(writeDraft).toContain('getTranscriptPathForSession')
    expect(writeDraft).toContain('project_dir_key')
    expect(writeDraft).toContain('function readTranscriptTail')
    expect(writeDraft).toContain('function transcriptAbsPathToStorageKey')
    expect(writeDraft).toContain('validateStorageKey')
    expect(writeDraft).toContain(
      'validateStorageKey(key) === undefined ? key : undefined',
    )
    expect(writeDraft).toContain('FEEDBACK_TRANSCRIPT_AVAIL_TAIL_BYTES')
    expect(gates).toContain('function isFeedbackCallHt')
  })

  test('lre leftover spills hook stdout/context via persistHookOutput', () => {
    const persist = readFileSync(
      join(import.meta.dir, '../../hooks/persistHookOutput.ts'),
      'utf8',
    )
    const hooks = readFileSync(join(import.meta.dir, '../../hooks.ts'), 'utf8')
    const userInput = readFileSync(
      join(import.meta.dir, '../../processUserInput/processUserInput.ts'),
      'utf8',
    )
    const addDir = readFileSync(
      join(import.meta.dir, '../../../commands/add-dir/add-dir.tsx'),
      'utf8',
    )
    expect(persist).toContain(
      'persistToolResult(output, `hook-${id}-${source}`)',
    )
    expect(persist).toContain('tengu_hook_output_persisted')
    expect(persist).toContain('persist-to-disk failed')
    expect(persist).toContain('truncatedFallback')
    expect(hooks).toContain('persistHookOutput(')
    expect(hooks).toContain('result.stdout.trim()')
    expect(hooks).toContain("'additionalContext'")
    expect(hooks).toContain("'initialUserMessage'")
    expect(hooks).not.toContain('persistHookOutput(result.stderr')
    expect(userInput).not.toContain('MAX_HOOK_OUTPUT_LENGTH')
    expect(userInput).not.toContain('output truncated - exceeded')
    expect(userInput).toContain(
      "attachment.type !== 'hook_success' || attachment.content",
    )
    expect(addDir).toContain(
      "persistHookOutput(sm, `add-dir-${seed}-${index}`, 'systemMessage')",
    )
  })

  test('Us wraps ce(storageV5) Provider; We() is useContext', () => {
    const app = readFileSync(
      join(import.meta.dir, '../../../components/App.tsx'),
      'utf8',
    )
    expect(app).toContain('wrapWithSessionServices(tree, storageV5)')
    const ctx = readFileSync(
      join(import.meta.dir, '../../../context/sessionServices.tsx'),
      'utf8',
    )
    expect(ctx).toContain('sessionServicesFor(storageV5)')
    expect(ctx).toContain('if (storageV5 === undefined) return children')
    expect(ctx).toContain('useContext(SessionServicesContext)')
    expect(ctx).toContain('Object.freeze({})')
  })
})
