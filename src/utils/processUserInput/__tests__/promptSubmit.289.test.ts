import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { Command } from '../../../types/command.js'
import type { QueuedCommand } from '../../../types/textInputTypes.js'
import type { PastedContent } from '../../config.js'
import {
  ensureQueuedCommandHistoryEntry,
  mergeHandedBackPastedContents,
  queuedCommandRestoreText,
  queuedCommandsNeedSessionStartWait,
  queuedCommandWasPasteExpanded,
  queuedPastedContentsToRestore,
} from '../../handlePromptSubmit.js'
import { extractImagesFromValue } from '../../messageQueueManager.js'
import {
  collectPromptSubmitAttachments,
  createArrivedLatch,
  promptScreenNeedsReplay,
  promptScreenPluginsChanged,
  raceArrived,
  resolvePromptSubmitPayloadOrigin,
  rewritePromptSubmitContent,
  rewritePromptSubmitUserMessage,
  wrapQueuedSettle,
} from '../promptSubmit.js'
import { createUserMessage } from '../../messages.js'
import {
  beginSessionStartLatch,
  getPromptSubmitLatch,
} from '../promptSubmitEntries.js'

const ROOT = join(import.meta.dir, '../../../..')

describe('densable 2.1.289 Unn CLt/vLt/Ios/RNe', () => {
  test('CLt perform resolves arrived; vLt prefers arrived', async () => {
    const latch = createArrivedLatch('not submitted')
    const answered = latch.perform({ text: 'hi' })
    const raced = await raceArrived(latch, answered)
    expect(raced).toBeDefined()
    if (!raced) throw new Error('expected raced to be defined')
    expect('arrived' in raced).toBe(true)
    if ('arrived' in raced) expect(raced.arrived.text).toBe('hi')
    latch.done({ text: 'hi' })
    await answered
  })

  test('vLt takes answered when perform never runs', async () => {
    const latch = createArrivedLatch('not submitted')
    const raced = await raceArrived(latch, Promise.resolve({ drop: 'blocked' }))
    expect(raced).toBeDefined()
    if (!raced) throw new Error('expected raced to be defined')
    expect('answered' in raced).toBe(true)
    if ('answered' in raced) expect(raced.answered).toEqual({ drop: 'blocked' })
  })

  test('Ios dispose settles drop only once', () => {
    const seen: unknown[] = []
    {
      using queued = wrapQueuedSettle({
        settle(result) {
          seen.push(result)
        },
      })
      queued.settle({ text: 'ok' })
    }
    expect(seen).toEqual([{ text: 'ok' }])
  })

  test('Pos is plugins-only; $nn includes hooks and permissionMode', () => {
    const a = {
      permissionMode: 'default',
      hooks: 'UserPromptSubmit',
      plugins: '',
      hooksSkippedByTrust: false,
    }
    const pluginsChanged = { ...a, plugins: 'prompt.submit' }
    const hooksChanged = { ...a, hooks: '' }
    const modeChanged = { ...a, permissionMode: 'acceptEdits' }
    expect(promptScreenPluginsChanged(a, pluginsChanged)).toBe(true)
    expect(promptScreenPluginsChanged(a, hooksChanged)).toBe(false)
    expect(promptScreenNeedsReplay(a, hooksChanged)).toBe(true)
    expect(promptScreenNeedsReplay(a, modeChanged)).toBe(true)
    expect(promptScreenNeedsReplay(a, { ...a })).toBe(false)
    expect(
      promptScreenNeedsReplay(
        { ...a, hooks: '' },
        { ...a, hooks: '', permissionMode: 'acceptEdits' },
      ),
    ).toBe(false)
  })

  test('jq latch begins then clears on complete', async () => {
    const latch = beginSessionStartLatch()
    const pending = getPromptSubmitLatch()
    expect(pending).toBeInstanceOf(Promise)
    latch.complete()
    await pending
    expect(getPromptSubmitLatch()).toBeUndefined()
  })

  test('Art hosts pass wait/promptSubmitted/entries into Unn', () => {
    const processUserInput = readFileSync(
      join(ROOT, 'src/utils/processUserInput/processUserInput.ts'),
      'utf8',
    )
    expect(processUserInput).toContain('runPromptSubmit')
    expect(processUserInput).toContain('promptSubmitted')
    expect(processUserInput).toContain('shouldWait: wait === true')
    expect(processUserInput).toContain('takePromptSubmitWait')
    expect(processUserInput).toContain('wrapQueuedSettle')
    const handle = readFileSync(
      join(ROOT, 'src/utils/handlePromptSubmit.ts'),
      'utf8',
    )
    expect(handle).toContain('createPromptSubmitEntries')
    expect(handle).toContain('promptSubmitEntries.handedOff()')
    expect(handle).toContain('screeningPending')
    expect(handle).toContain('settleScreening')
    expect(handle).toContain('runPromptSubmit')
    expect(handle).toContain('queryGuard.isRunning')
    expect(handle).toContain('takeIdeSelectionForQueue')
    expect(handle).toContain('recordIdeSelectionConsumedBy')
    expect(handle).toContain('onPromptHandedBack')
    expect(handle).toContain('shouldHandBackIdeSelection')
    expect(handle).toContain('promptSubmitIdleHooksDrainOnly')
    expect(handle).toContain('drainOnlyIdleHooks')
    expect(handle).toContain('restoreHandedBackPrompt')
    expect(handle).toContain('joinHandedBackPrompt')
    expect(handle).toContain('restoreHandedBack(')
    expect(handle).toContain('awaitSessionStartHooks')
    const queueUi = readFileSync(
      join(ROOT, 'src/components/PromptInput/PromptInputQueuedCommands.tsx'),
      'utf8',
    )
    expect(queueUi).toContain('canShowQueueSendNowHint')
    expect(queueUi).toContain('send now')
    expect(queueUi).toContain('formatQueuedIdeSelection')
    expect(queueUi).toContain('shouldHideQueuedIdeSelectionPreview')
    const messages = readFileSync(join(ROOT, 'src/utils/messages.ts'), 'utf8')
    expect(messages).toContain("case 'plugin':")
    expect(messages).toContain('originObj.asUser === true')
    expect(messages).toContain('wrapPluginOriginText')
    expect(messages).toContain('{ midTurn: true }')
    const hooks = readFileSync(
      join(ROOT, 'src/utils/plugins/functionHooksModules.ts'),
      'utf8',
    )
    expect(hooks).toContain('input.asUser === true')
    expect(hooks).toContain('asUser: true')
    const unn = readFileSync(
      join(ROOT, 'src/utils/processUserInput/promptSubmit.ts'),
      'utf8',
    )
    expect(unn).toContain("hasMatchingFunctionHook('prompt.submit')")
    expect(unn).toContain('shouldSkipHookDueToTrust')
    expect(unn).toContain('buildPromptSubmitPayload')
    expect(unn).toContain('isMeta: true')
    expect(processUserInput).toContain('packPromptSubmitContext')
    expect(processUserInput).toContain('rewritePromptSubmitUserMessage')
    expect(processUserInput).toContain('applyPromptSubmitProceeds')
    expect(processUserInput).toContain('PROMPT_SUBMIT_MENTION_TYPES')
    expect(processUserInput).toContain('inputMentionsOnly')
    const attachments = readFileSync(
      join(ROOT, 'src/utils/attachments.ts'),
      'utf8',
    )
    expect(attachments).toContain('inputMentionsOnly?: boolean')
    const deferred = readFileSync(
      join(ROOT, 'src/hooks/useDeferredHookMessages.ts'),
      'utf8',
    )
    expect(deferred).toContain('takeInitialUserMessage')
    const assistant = readFileSync(
      join(ROOT, 'src/components/messages/AssistantTextMessage.tsx'),
      'utf8',
    )
    expect(assistant).toContain('evaluateUiRender')
    const fillHost = readFileSync(
      join(ROOT, 'src/utils/plugins/functionHooksModules.ts'),
      'utf8',
    )
    expect(fillHost).toContain('return runPromptFill(rec ?? {}, plugin)')
    expect(fillHost).toContain('createHeldPressStore')
    expect(fillHost).toContain('heldPressCount')
    expect(fillHost).toContain('holdDrawing')
    const permissions = readFileSync(
      join(ROOT, 'src/utils/permissions/permissions.ts'),
      'utf8',
    )
    expect(permissions).toContain(
      'hookAllowVouch: context.hookAllowVouched === true',
    )
    const sessionStart = readFileSync(
      join(ROOT, 'src/utils/sessionStart.ts'),
      'utf8',
    )
    expect(sessionStart).toContain('beginSessionStartLatch')
    expect(handle).toContain('queuedCommandsNeedSessionStartWait')
    expect(handle).toContain('queuedPastedContentsToRestore')
    expect(handle).toContain('mergeHandedBackPastedContents')
    expect(handle).toContain("admissionExempt: 'resurrected'")
    expect(handle).toContain('{ ahead: true }')
    const collapse = readFileSync(
      join(ROOT, 'src/utils/collapseReadSearch.ts'),
      'utf8',
    )
    expect(collapse).toContain('leftoverQrrInstallClientData')
    expect(collapse).toContain('leftoverQrrInstallStrictReadGate')
    expect(collapse).toContain('leftoverQrrInstallOverride')
    expect(collapse).toContain('leftoverQrrInstallStaleMatch')
    expect(collapse).toContain('export function leftoverQrrStrict')
    const bootstrap = readFileSync(
      join(ROOT, 'src/services/api/bootstrap.ts'),
      'utf8',
    )
    expect(bootstrap).toContain('leftoverQrrInstallClientData()')
    const vscode = readFileSync(
      join(ROOT, 'src/services/mcp/vscodeIdeBridgeCallbacks.ts'),
      'utf8',
    )
    expect(vscode).toContain('leftoverQrrStrict()?.meadow_lantern === true')
    const init = readFileSync(join(ROOT, 'src/entrypoints/init.ts'), 'utf8')
    expect(init).toContain('leftoverQrrInstallClientData')
    expect(handle).toContain('getMainThreadTurn')
    expect(handle).toContain('batchPromptSubmitWaitGuard')
    const query = readFileSync(join(ROOT, 'src/query.ts'), 'utf8')
    expect(query).toContain('bindMainThreadTurn')
    expect(query).toContain('releaseMainThreadTurn')
    expect(query).toContain('consumeFromQueue')
    expect(query).toContain('keepQueuedCommandsUntilFirstDroppedPrompt')
    expect(hooks).toContain('getLiveHookEvent')
    expect(hooks).toContain('markTurnHookQueuedPrompt')
    expect(hooks).toContain('recordCommandRunWait')
    expect(hooks).toContain("priority: 'later'")
    expect(hooks).not.toContain('return { queued: true, value: slash }')
    const slash = readFileSync(
      join(ROOT, 'src/utils/processUserInput/processSlashCommand.tsx'),
      'utf8',
    )
    expect(slash).toContain('wrapCommandRunWait')
    expect(slash).toContain('takeCommandRunWait')
    expect(handle).toContain('createUserInterruptionMessage')
    expect(handle).toContain('ensureQueuedCommandHistoryEntry')
    expect(handle).toContain('historyInterrupted')
    expect(handle).toContain('extractImagesFromValue')
    expect(handle).not.toContain('needs applyMessageOp — KEEP')
  })
})

describe('densable 2.1.289 WZe Ln/Stt/qLr/pde', () => {
  const localHelp = { name: 'help', type: 'local' } as Command
  const promptHelp = { name: 'help', type: 'prompt' } as Command

  test('Ln waits unless every prompt cmd is a known local slash', () => {
    expect(
      queuedCommandsNeedSessionStartWait(
        [{ value: 'hello', mode: 'prompt' }],
        [],
      ),
    ).toBe(true)
    expect(
      queuedCommandsNeedSessionStartWait([{ value: 'ls', mode: 'bash' }], []),
    ).toBe(false)
    expect(
      queuedCommandsNeedSessionStartWait(
        [{ value: '/help', mode: 'prompt' }],
        [localHelp],
      ),
    ).toBe(false)
    expect(
      queuedCommandsNeedSessionStartWait(
        [{ value: '/help', mode: 'prompt' }],
        [promptHelp],
      ),
    ).toBe(true)
    expect(
      queuedCommandsNeedSessionStartWait(
        [
          {
            value: '/help',
            mode: 'prompt',
            skipSlashCommands: true,
          },
        ],
        [localHelp],
      ),
    ).toBe(true)
    expect(
      queuedCommandsNeedSessionStartWait(
        [{ value: '/unknown', mode: 'prompt' }],
        [localHelp],
      ),
    ).toBe(true)
  })

  test('Stt/fun restore preExpansionValue when paste-expanded', () => {
    const expanded = {
      value: 'expanded',
      mode: 'prompt',
      skipSlashCommands: true,
      preExpansionValue: 'raw',
    } as QueuedCommand
    expect(queuedCommandWasPasteExpanded(expanded)).toBe(true)
    expect(queuedCommandRestoreText(expanded)).toBe('raw')
    expect(
      queuedCommandWasPasteExpanded({
        value: 'expanded',
        mode: 'prompt',
        pasteTagged: true,
        preExpansionValue: 'x',
      } as QueuedCommand),
    ).toBe(true)
    expect(
      queuedCommandWasPasteExpanded({
        value: 'expanded',
        mode: 'prompt',
        skipSlashCommands: true,
        preExpansionValue: '  ',
      } as QueuedCommand),
    ).toBe(false)
    expect(queuedCommandRestoreText({ value: 'plain', mode: 'prompt' })).toBe(
      'plain',
    )
  })

  test('qLr restores image/inline or all pastes when Stt', () => {
    const image: PastedContent = { id: 1, type: 'image', content: 'i' }
    const inline: PastedContent = {
      id: 2,
      type: 'text',
      content: 't',
      inline: true,
    }
    const keep: PastedContent = { id: 3, type: 'text', content: 'keep' }
    expect(
      queuedPastedContentsToRestore({
        value: 'x',
        mode: 'prompt',
        pastedContents: { 1: image, 2: inline, 3: keep },
      }),
    ).toEqual([image, inline])
    expect(
      queuedPastedContentsToRestore({
        value: 'x',
        mode: 'prompt',
        skipSlashCommands: true,
        preExpansionValue: 'raw',
        pastedContents: { 3: keep },
      }),
    ).toEqual([keep])
  })

  test('pde assigns negative ids to inline pastes and keeps positive keys', () => {
    const next = mergeHandedBackPastedContents(
      { 1: { id: 1, type: 'text', content: 'a' } },
      [
        { id: 1, type: 'text', content: 'inline', inline: true },
        { id: 5, type: 'image', content: 'img' },
        { id: 0, type: 'text', content: 'skip' },
      ],
    )
    expect(next[-1]).toEqual({
      id: -1,
      type: 'text',
      content: 'inline',
      inline: true,
    })
    expect(next[5]).toEqual({ id: 5, type: 'image', content: 'img' })
    expect(next[0]).toBeUndefined()
    expect(next[1]).toEqual({ id: 1, type: 'text', content: 'a' })
  })
})

describe('densable 2.1.289 WZe abort lr/XLr/R1e', () => {
  const png: ContentBlockParam = {
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/png',
      data: 'abc',
    },
  }

  test('XLr extracts base64 images and skips strings', () => {
    expect(extractImagesFromValue('plain', 10)).toEqual([])
    expect(extractImagesFromValue([png], 10)).toEqual([
      {
        id: 10,
        type: 'image',
        content: 'abc',
        mediaType: 'image/png',
        filename: 'image1',
      },
    ])
    expect(
      extractImagesFromValue(
        [
          { type: 'text', text: 'hi' },
          png,
          {
            type: 'image',
            source: { type: 'url', url: 'https://example.com/x.png' },
          },
        ],
        20,
      ),
    ).toEqual([
      {
        id: 20,
        type: 'image',
        content: 'abc',
        mediaType: 'image/png',
        filename: 'image1',
      },
    ])
  })

  test('lr map keeps historyEntry else fun display + XLr images', () => {
    const existing = {
      value: 'kept',
      mode: 'prompt' as const,
      historyEntry: {
        display: 'shown',
        pastedContents: { 1: { id: 1, type: 'text' as const, content: 't' } },
      },
    }
    expect(ensureQueuedCommandHistoryEntry(existing)).toBe(
      existing.historyEntry,
    )

    const expanded = {
      value: 'expanded',
      mode: 'prompt' as const,
      skipSlashCommands: true,
      preExpansionValue: 'raw',
      pastedContents: { 3: { id: 3, type: 'text' as const, content: 'keep' } },
    }
    expect(ensureQueuedCommandHistoryEntry(expanded, 99)).toEqual({
      display: 'raw',
      pastedContents: { 3: { id: 3, type: 'text', content: 'keep' } },
    })

    expect(
      ensureQueuedCommandHistoryEntry(
        { value: [png], mode: 'prompt', pastedContents: {} },
        50,
      ),
    ).toEqual({
      display: '',
      pastedContents: {
        50: {
          id: 50,
          type: 'image',
          content: 'abc',
          mediaType: 'image/png',
          filename: 'image1',
        },
      },
    })
  })
})

describe('densable 2.1.289 Jun / mn / oe remainder', () => {
  test('Jun replaces string content and last text block', () => {
    expect(rewritePromptSubmitContent('hello', 'world')).toBe('world')
    expect(rewritePromptSubmitContent('hello', '   ')).toBe('')
    expect(
      rewritePromptSubmitContent(
        [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'x' },
          },
          { type: 'text', text: 'hello' },
        ],
        'world',
      ),
    ).toEqual([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'x' },
      },
      { type: 'text', text: 'world' },
    ])
  })

  test('mn rewrites the first non-meta user message', () => {
    const user = createUserMessage({ content: 'typed' })
    const found = rewritePromptSubmitUserMessage([user], 'typed', 'rewritten')
    expect(found).toBe(user)
    expect(user.message.content).toBe('rewritten')
  })

  test('oe attachments collect image pastes', () => {
    expect(
      collectPromptSubmitAttachments('hi', {
        1: {
          id: 1,
          type: 'image',
          content: 'abc',
          mediaType: 'image/png',
          filename: 'a.png',
        },
      }),
    ).toEqual([{ type: 'image', mediaType: 'image/png', filename: 'a.png' }])
  })

  test('iOo maps sdk promptSource and wakeup', () => {
    expect(resolvePromptSubmitPayloadOrigin({ promptSource: 'sdk' })).toEqual({
      kind: 'sdk',
    })
    expect(resolvePromptSubmitPayloadOrigin({ wakeupSource: 'loop' })).toEqual({
      kind: 'scheduled-trigger',
    })
  })
})
