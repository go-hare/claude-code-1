import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clearPendingHistoryEntries,
  getHistory,
  removeLastFromHistory,
  resetPasteIdAllocatorForTests,
} from '../../history.js'
import type { Command } from '../../types/command.js'
import { ControlStreamClosedError } from '../../utils/errors.js'
import {
  consume,
  consumeCancelPending,
  enqueue,
  getCommandQueue,
  getCommandQueueLength,
  holdBack,
  letHeldBackGo,
  MessageQueueInstance,
  popAllEditable,
  popEditableAt,
  queueAfterTurn,
  registerFoldInFlight,
  releaseQueuedAfterTurn,
  requeueTaken,
  resetCommandQueue,
  startRequeueWindow,
  unregisterFoldInFlight,
  wasPutBack,
} from '../../utils/messageQueueManager.js'
import { processSlashCommand } from '../../utils/processUserInput/processSlashCommand.js'
import { processUserInput } from '../../utils/processUserInput/processUserInput.js'
import {
  beginSessionStartLatch,
  markAheadOfSessionStart,
} from '../../utils/processUserInput/promptSubmitEntries.js'
import { processQueueIfReady } from '../../utils/queueProcessor.js'
import {
  buildHeadlessInterruptReceipt,
  handleHeadlessCancelAsyncMessage,
  handleIncomingControlCancelRequest,
  interruptAndWaitForRewindSettlement,
  PrintTextResults,
} from '../print.js'
import { StructuredIO } from '../structuredIO.js'

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function makeBaseContext(overrides: Record<string, unknown> = {}) {
  let appState: Record<string, unknown> = {
    endedByModel: false,
    fastMode: false,
    storedImagePaths: new Map<number, string>(),
    mcp: { clients: [], commands: [], tools: [], resources: {} },
    toolPermissionContext: {
      mode: 'default',
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      additionalWorkingDirectories: new Map(),
      isBypassPermissionsModeAvailable: false,
    },
    ...(overrides.appState as Record<string, unknown> | undefined),
  }
  const setAppState = (
    updater: (prev: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    appState = updater(appState)
  }
  const abortController = new AbortController()
  return {
    getAppState: () => appState,
    setAppState,
    setToolPermissionContext: () => {},
    abortController,
    readFileState: new Map(),
    messages: [],
    nestedMemoryAttachmentTriggers: new Set<string>(),
    options: {
      commands: [],
      tools: [],
      isNonInteractiveSession: false,
      mainLoopModel: 'claude-sonnet-4-6',
      verbose: false,
      debug: false,
      maxThinkingTokens: 0,
      ...(overrides.options as Record<string, unknown> | undefined),
    },
    ...overrides,
  } as any
}

beforeEach(() => {
  resetCommandQueue()
  resetPasteIdAllocatorForTests()
})

afterEach(() => {
  resetCommandQueue()
  clearPendingHistoryEntries()
  resetPasteIdAllocatorForTests()
  mock.restore()
})

// ============================================================================
// Group 1: processUserInput / processUserInputBase (P0-11, P1-1, P1-2, P2)
// ============================================================================
describe('Group 1: processUserInputBase (P0-11, P1-1, P1-2, P2)', () => {
  test('P0-11: skipAttachments true/"all" and poll-event/task-notification emit no ambient attachments', async () => {
    const ideSelection = {
      text: 'const x = 1',
      filePath: '/tmp/foo.ts',
      lineCount: 1,
    }
    for (const skip of [true, 'all'] as const) {
      const ctx = makeBaseContext()
      const res = await processUserInput({
        input: 'hello @nonexistent.ts',
        mode: 'prompt',
        setToolJSX: () => {},
        context: ctx,
        ideSelection,
        skipAttachments: skip,
        skipSubmissionHooks: true,
      })
      const attachments = res.messages.filter(m => m.type === 'attachment')
      expect(attachments).toHaveLength(0)
    }

    for (const mode of ['poll-event', 'task-notification'] as const) {
      const ctx = makeBaseContext()
      const res = await processUserInput({
        input: '<task-notification/>',
        mode,
        setToolJSX: () => {},
        context: ctx,
        ideSelection,
        skipSubmissionHooks: true,
      })
      const attachments = res.messages.filter(m => m.type === 'attachment')
      expect(attachments).toHaveLength(0)
    }
  })

  test('P0-11: slash command does not extract prompt/ambient attachments in processUserInputBase', async () => {
    const localCmd: Command = {
      type: 'local',
      name: 'noop-test',
      description: 'noop',
      supportsNonInteractive: true,
      load: async () => ({
        call: async () => ({ type: 'text' as const, value: 'ok' }),
      }),
    } as Command
    const ctx = makeBaseContext({
      options: { commands: [localCmd] },
    })
    const res = await processUserInput({
      input: '/noop-test',
      mode: 'prompt',
      setToolJSX: () => {},
      context: ctx,
      ideSelection: {
        text: 'selected line',
        filePath: '/tmp/a.ts',
        lineCount: 1,
      },
      skipSubmissionHooks: true,
    })
    expect(res.shouldQuery).toBe(false)
    expect(res.messages.some(m => m.type === 'attachment')).toBe(false)
  })

  test('P0-11: skipAttachments "mentions" delivers owed ambient attachments at most once (no double collection)', async () => {
    const src = readFileSync(
      join(import.meta.dir, '../../utils/processUserInput/processUserInput.ts'),
      'utf8',
    )
    // Verify processUserInputBase returns [] when !shouldExtractAttachments
    // instead of falling back to getAttachmentMessages(null, ...)
    const baseIdx = src.indexOf(
      'const attachmentMessages = shouldExtractAttachments',
    )
    expect(baseIdx).toBeGreaterThan(0)
    const slice = src.slice(baseIdx, baseIdx + 700)
    expect(slice).toContain(': []')
    expect(slice).not.toContain('deliveredTurnStart: true')

    // And runtime check: skipAttachments:'mentions' skips ideSelection/@mentions
    const ctx = makeBaseContext()
    const res = await processUserInput({
      input: 'check @package.json',
      mode: 'prompt',
      setToolJSX: () => {},
      context: ctx,
      ideSelection: {
        text: 'selected',
        filePath: '/tmp/b.ts',
        lineCount: 1,
      },
      skipAttachments: 'mentions',
      skipSubmissionHooks: true,
    })
    expect(res.shouldQuery).toBe(true)
    const ideAttachments = res.messages.filter(
      m =>
        m.type === 'attachment' &&
        m.attachment.type === 'selected_lines_in_ide',
    )
    expect(ideAttachments).toHaveLength(0)
  })

  test('P1-1: bash mode dispatches BEFORE getAttachmentMessages and skips submission hooks', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../utils/processUserInput/processUserInput.ts'),
      'utf8',
    )
    const bashIdx = src.indexOf("if (inputString !== null && mode === 'bash')")
    const attachIdx = src.indexOf(
      'const attachmentMessages = shouldExtractAttachments',
    )
    expect(bashIdx).toBeGreaterThan(0)
    expect(attachIdx).toBeGreaterThan(bashIdx)
    // Outer hook gate explicitly skips mode === 'bash'
    expect(src).toContain("mode === 'bash' ||")
  })

  test('P1-2: shouldQuery:false + queryHeldForNextTurn:true preserves wasShouldQuery for submission hooks', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../utils/processUserInput/processUserInput.ts'),
      'utf8',
    )
    const wasIdx = src.indexOf(
      'const wasShouldQuery = queryHeldForNextTurn === true && result.shouldQuery',
    )
    const forceFalseIdx = src.indexOf('result.shouldQuery = false', wasIdx)
    const hookGateIdx = src.indexOf('(!result.shouldQuery && !wasShouldQuery)')
    expect(wasIdx).toBeGreaterThan(0)
    expect(forceFalseIdx).toBeGreaterThan(wasIdx)
    expect(hookGateIdx).toBeGreaterThan(forceFalseIdx)
  })

  test('P2: inline array image blocks are persisted via storeImages with metadata & imagePasteIds', async () => {
    const ctx = makeBaseContext()
    const res = await processUserInput({
      input: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: ONE_PIXEL_PNG_BASE64,
          },
        },
        { type: 'text', text: 'describe this pixel' },
      ],
      mode: 'prompt',
      setToolJSX: () => {},
      context: ctx,
      skipAttachments: 'all',
      skipSubmissionHooks: true,
    })
    expect(res.shouldQuery).toBe(true)
    const userMsg = res.messages.find(m => m.type === 'user' && !m.isMeta)
    expect(userMsg).toBeDefined()
    expect(
      (userMsg as { imagePasteIds?: number[] }).imagePasteIds?.length,
    ).toBeGreaterThan(0)
    const storedPaths = ctx.getAppState().storedImagePaths as Map<
      number,
      string
    >
    expect(storedPaths.size).toBeGreaterThan(0)
    const metaMsg = res.messages.find(
      m =>
        m.type === 'user' &&
        m.isMeta === true &&
        (m as { turnCompanion?: boolean }).turnCompanion === true,
    )
    expect(metaMsg).toBeDefined()
    const metaText = JSON.stringify(metaMsg)
    const firstStoredPath = storedPaths.values().next().value as string
    expect(metaText).toContain(firstStoredPath)
  })
})

// ============================================================================
// Group 2: processSlashCommand (P1-3, P2)
// ============================================================================
describe('Group 2: processSlashCommand (P1-3, P2)', () => {
  test('P1-3: -p unknown /foo falls back to model query with unknown_command_fallback + extractPromptAttachments', async () => {
    const promptSkill: Command = {
      type: 'prompt',
      name: 'foobar',
      description: 'test skill',
      progressMessage: 'running',
      contentLength: 10,
      source: 'userSettings',
      getPromptForCommand: async () => [{ type: 'text', text: 'body' }],
    } as Command
    const ctx = makeBaseContext({
      options: {
        isNonInteractiveSession: true,
        commands: [promptSkill],
      },
    })
    const res = await processSlashCommand(
      '/foobaz hello',
      [],
      [],
      [],
      ctx,
      () => {},
    )
    expect(res.shouldQuery).toBe(true)
    expect(res.extractPromptAttachments).toBe(true)
    const fallbackAtt = res.messages.find(
      m =>
        m.type === 'attachment' &&
        (m.attachment as { type: string }).type === 'unknown_command_fallback',
    )
    expect(fallbackAtt).toBeDefined()
    const payload = (
      fallbackAtt as unknown as {
        attachment: {
          commandName?: string
          suggestion?: string
          availableCommandNames: string[]
          availableCommandCount: number
        }
      }
    ).attachment
    expect(payload.commandName).toBe('foobaz')
    expect(payload.suggestion).toBe('foobar')
    expect(payload.availableCommandNames).toContain('foobar')
    expect(payload.availableCommandCount).toBe(1)
  })

  test('P1-3: -p unparseable leading "/" falls back to regular prompt with shouldQuery: true', async () => {
    const ctx = makeBaseContext({
      options: { isNonInteractiveSession: true, commands: [] },
    })
    const res = await processSlashCommand('/   ', [], [], [], ctx, () => {})
    expect(res.shouldQuery).toBe(true)
    expect(res.extractPromptAttachments).toBe(true)
    const userMsg = res.messages.find(m => m.type === 'user')
    expect(userMsg).toBeDefined()
  })

  test('P1-3: space-separated colon subcommands (/ns sub arg) resolve to ns:sub', async () => {
    let receivedArgs = ''
    const subCmd: Command = {
      type: 'local',
      name: 'ns:sub',
      description: 'namespaced subcommand',
      supportsNonInteractive: true,
      load: async () => ({
        call: async (args: string) => {
          receivedArgs = args
          return { type: 'text' as const, value: `ran:${args}` }
        },
      }),
    } as Command
    const ctx = makeBaseContext({
      options: { commands: [subCmd] },
    })
    const res = await processSlashCommand(
      '/ns sub hello world',
      [],
      [],
      [],
      ctx,
      () => {},
    )
    expect(receivedArgs).toBe('hello world')
    expect(res.shouldQuery).toBe(false)
    expect(res.resultText).toBe('ran:hello world')
  })

  test('P1-3: non-command /path fallback preserves permissionMode, isMeta, origin, taskDelivery and extractPromptAttachments', async () => {
    const ctx = makeBaseContext({ options: { commands: [] } })
    const res = await processSlashCommand(
      '/--not-a-cmd check this',
      [],
      [],
      [],
      ctx,
      () => {},
      'uuid-path-1',
      false,
      undefined,
      undefined,
      undefined,
      { kind: 'human' },
      undefined,
      undefined,
      undefined,
      [],
      {
        permissionMode: 'plan',
        isMeta: true,
        taskDelivery: { taskId: 't-1' },
      },
    )
    expect(res.shouldQuery).toBe(true)
    expect(res.extractPromptAttachments).toBe(true)
    const userMsg = res.messages[0] as {
      type: string
      permissionMode?: string
      isMeta?: boolean
      origin?: { kind?: string }
      taskDelivery?: unknown
    }
    expect(userMsg.type).toBe('user')
    expect(userMsg.permissionMode).toBe('plan')
    expect(userMsg.isMeta).toBe(true)
    expect(userMsg.origin).toEqual({ kind: 'human' })
    expect(userMsg.taskDelivery).toEqual({ taskId: 't-1' })
  })

  test('P1-3: headless local-jsx short-circuits BEFORE command.load()', async () => {
    let loaded = false
    const jsxCmd: Command = {
      type: 'local-jsx',
      name: 'panel-demo',
      description: 'interactive panel',
      load: async () => {
        loaded = true
        throw new Error('must not be called in headless mode')
      },
    } as Command
    const ctx = makeBaseContext({
      options: {
        isNonInteractiveSession: true,
        commands: [jsxCmd],
      },
    })
    const res = await processSlashCommand(
      '/panel-demo',
      [],
      [],
      [],
      ctx,
      () => {},
    )
    expect(loaded).toBe(false)
    expect(res.shouldQuery).toBe(false)
    expect(res.resultText).toContain(
      "/panel-demo opens an interactive panel and isn't available in this environment.",
    )
  })

  test('P2: getMessagesForPromptSlashCommand passes non-diff ideSelection and preserves planSlugSeed', async () => {
    const promptCmd: Command = {
      type: 'prompt',
      name: 'review-ide',
      description: 'prompt cmd',
      progressMessage: 'reviewing',
      contentLength: 10,
      source: 'userSettings',
      getPromptForCommand: async () => [{ type: 'text', text: 'review code' }],
    } as Command
    const connectedIdeClient = {
      name: 'ide',
      type: 'connected',
      config: { type: 'ws-ide', ideName: 'VS Code', url: 'ws://127.0.0.1:0' },
    }
    const ctx = makeBaseContext({
      options: { commands: [promptCmd], mcpClients: [connectedIdeClient] },
    })
    const res = await processSlashCommand(
      '/review-ide my-slug-arg',
      [],
      [],
      [],
      ctx,
      () => {},
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
      {
        ideSelection: {
          text: 'const answer = 42',
          filePath: '/tmp/sample.ts',
          lineStart: 10,
          lineCount: 1,
        },
      },
    )
    expect(res.shouldQuery).toBe(true)
    const ideAtt = res.messages.find(
      m =>
        m.type === 'attachment' &&
        m.attachment.type === 'selected_lines_in_ide',
    )
    expect(ideAtt).toBeDefined()

    // Diff selection must be filtered out (official `k?.source === "diff" ? void 0 : k`)
    const diffRes = await processSlashCommand(
      '/review-ide my-slug-arg',
      [],
      [],
      [],
      ctx,
      () => {},
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
      {
        ideSelection: {
          text: '+added',
          filePath: '/tmp/sample.ts',
          lineStart: 10,
          lineCount: 1,
          source: 'diff',
        },
      },
    )
    const diffIdeAtt = diffRes.messages.find(
      m =>
        m.type === 'attachment' &&
        m.attachment.type === 'selected_lines_in_ide',
    )
    expect(diffIdeAtt).toBeUndefined()

    const slashSrc = readFileSync(
      join(
        import.meta.dir,
        '../../utils/processUserInput/processSlashCommand.tsx',
      ),
      'utf8',
    )
    expect(slashSrc).toContain('planSlugSeed: args')
  })
})

// ============================================================================
// Group 3: messageQueueManager & queueProcessor (P1-4, P2)
// ============================================================================
describe('Group 3: messageQueueManager & queueProcessor (P1-4, P2)', () => {
  test('P1-4: interrupt requeue window resurrects mid-turn absorbed prompt within window, respects expiry and forgoRequeue', () => {
    let now = 1000
    const q = new MessageQueueInstance({ now: () => now })
    const cmd = {
      value: 'follow up prompt',
      mode: 'prompt' as const,
      uuid: '00000000-0000-4000-8000-0000000000a1' as any,
      requeueIfInterruptedWithinMs: 5000,
    }
    q.enqueue(cmd)
    const queuedRef = q.getCommands()[0]!
    q.consume([queuedRef], { reason: 'absorbed_mid_turn' })
    expect(q.getLength()).toBe(0)
    expect(q.foldCopyFate(cmd.uuid)).toBe('wait')

    q.startRequeueWindow()
    expect(q.requeueWindowLeftMs()).toBe(5000)

    now = 3500
    expect(q.requeueWindowLeftMs()).toBe(2500)
    const resurrected = q.requeueTaken()
    expect(resurrected?.uuid).toBe(cmd.uuid)
    expect(q.wasPutBack(cmd.uuid)).toBe(true)
    expect(q.foldCopyFate(cmd.uuid)).toBe('drop')
    expect(q.getLength()).toBe(1)
    const back = q.getCommands()[0]!
    expect(back.drainOnly).toBe(true)
    expect(back.runsAlone).toBe(true)
    expect(back.admissionExempt).toBe('resurrected')

    q.settleTaken({ turnEnded: true })
    expect(q.wasPutBack(cmd.uuid)).toBe(false)

    // Expired window returns undefined
    const cmd2 = {
      value: 'expired',
      mode: 'prompt' as const,
      uuid: '00000000-0000-4000-8000-0000000000a2' as any,
      requeueIfInterruptedWithinMs: 1000,
    }
    q.enqueue(cmd2)
    q.consume([q.getCommands().find(c => c.uuid === cmd2.uuid)!], {
      reason: 'absorbed_mid_turn',
    })
    q.startRequeueWindow()
    now += 2000
    expect(q.requeueTaken()).toBeUndefined()

    // forgoRequeue cancels eligibility
    const cmd3 = {
      value: 'forgone',
      mode: 'prompt' as const,
      uuid: '00000000-0000-4000-8000-0000000000a3' as any,
      requeueIfInterruptedWithinMs: 5000,
    }
    q.enqueue(cmd3)
    q.consume([q.getCommands().find(c => c.uuid === cmd3.uuid)!], {
      reason: 'absorbed_mid_turn',
    })
    q.forgoRequeue(cmd3.uuid)
    expect(q.requeueTaken()).toBeUndefined()
  })

  test('P1-4: holdBack / letHeldBackGo and queueAfterTurn / releaseQueuedAfterTurn', () => {
    enqueue({
      value: 'held-1',
      mode: 'prompt',
      uuid: '00000000-0000-4000-8000-0000000000b1' as any,
    })
    const release = holdBack(cmd => cmd.mode === 'prompt')
    expect(getCommandQueue()[0]?.passive).toBe(true)

    enqueue({
      value: 'held-2',
      mode: 'prompt',
      uuid: '00000000-0000-4000-8000-0000000000b2' as any,
    })
    expect(getCommandQueue()[1]?.passive).toBe(true)

    // Double holdBack throws
    expect(() => holdBack(() => true)).toThrow(/already has a hold/)

    // letHeldBackGo releases only matching subset
    expect(
      letHeldBackGo(cmd => cmd.uuid === '00000000-0000-4000-8000-0000000000b1'),
    ).toBe(1)
    expect(getCommandQueue()[0]?.passive).toBeUndefined()
    expect(getCommandQueue()[1]?.passive).toBe(true)

    // Final release frees remaining
    expect(release()).toBe(1)
    expect(getCommandQueue().every(c => c.passive !== true)).toBe(true)

    // queueAfterTurn / releaseQueuedAfterTurn preserves FIFO ahead
    resetCommandQueue()
    enqueue({ value: 'existing', mode: 'prompt' })
    queueAfterTurn({ value: 'after-1', mode: 'prompt' })
    queueAfterTurn({ value: 'after-2', mode: 'prompt' })
    releaseQueuedAfterTurn()
    expect(getCommandQueue().map(c => c.value)).toEqual([
      'after-1',
      'after-2',
      'existing',
    ])

    // Dropped when a 'now' priority command is waiting
    resetCommandQueue()
    enqueue({ value: 'urgent', mode: 'prompt', priority: 'now' })
    queueAfterTurn({ value: 'should-drop', mode: 'prompt' })
    releaseQueuedAfterTurn()
    expect(getCommandQueue().map(c => c.value)).toEqual(['urgent'])
  })

  test('P2: popAllEditable / popEditableAt use preExpansionValue, remap colliding paste IDs, fix empty-draft cursorOffset, and log history', async () => {
    const prevChild = process.env.CLAUDE_CODE_CHILD_SESSION
    delete process.env.CLAUDE_CODE_CHILD_SESSION
    try {
      // 1) preExpansionValue + empty-draft cursorOffset (no off-by-1!)
      enqueue({
        value: 'expanded text body',
        preExpansionValue: 'see [Pasted text #1]',
        pasteTagged: true,
        mode: 'prompt',
        pastedContents: {
          1: { id: 1, type: 'text', content: 'expanded text body' },
        },
      })
      const poppedEmpty = popAllEditable('', 0)
      expect(poppedEmpty?.text).toBe('see [Pasted text #1]')
      expect(poppedEmpty?.cursorOffset).toBe('see [Pasted text #1]'.length)
      expect(poppedEmpty?.images).toHaveLength(1)
      expect(poppedEmpty?.images[0]?.id).toBe(1)

      // 2) Paste-ID collision remapping against currentPastedContents
      resetCommandQueue()
      enqueue({
        value: 'expanded body',
        preExpansionValue: 'queued [Pasted text #1]',
        pasteTagged: true,
        mode: 'prompt',
        pastedContents: {
          1: { id: 1, type: 'text', content: 'expanded body' },
        },
      })
      const poppedCollision = popAllEditable('draft [Pasted text #1]', 5, {
        1: { id: 1, type: 'text', content: 'draft paste' },
      })
      expect(poppedCollision?.text).toMatch(
        /^queued \[Pasted text #(\d+)\]\ndraft \[Pasted text #1\]$/,
      )
      expect(poppedCollision?.images[0]?.id).not.toBe(1)
      expect(poppedCollision?.text).toContain(
        `[Pasted text #${poppedCollision?.images[0]?.id}]`,
      )
      expect(poppedCollision?.cursorOffset).toBe(
        `queued [Pasted text #${poppedCollision?.images[0]?.id}]`.length +
          1 +
          5,
      )

      // 3) popEditableAt records history with armUndo: false & exact cursorOffset
      resetCommandQueue()
      enqueue({
        value: 'pop-one-history-check',
        mode: 'prompt',
      })
      const poppedOne = popEditableAt(0, '', 0)
      expect(poppedOne?.text).toBe('pop-one-history-check')
      expect(poppedOne?.cursorOffset).toBe('pop-one-history-check'.length)
      removeLastFromHistory()
      const entries: string[] = []
      for await (const entry of getHistory()) {
        entries.push(entry.display)
        if (entries.length >= 5) break
      }
      expect(entries).toContain('pop-one-history-check')
    } finally {
      if (prevChild === undefined) delete process.env.CLAUDE_CODE_CHILD_SESSION
      else process.env.CLAUDE_CODE_CHILD_SESSION = prevChild
    }
  })

  test('P1-4: queueProcessor SessionStart barrier, promptSubmitted/@-mention splitting, and last-block isSlashCommand', () => {
    // 1) SessionStart barrier blocks normal prompts until complete(), allows ahead-of-session-start
    const latch = beginSessionStartLatch()
    try {
      const normalUuid = '00000000-0000-4000-8000-0000000000c1' as any
      const aheadUuid = '00000000-0000-4000-8000-0000000000c2' as any
      enqueue({ value: 'wait-for-start', mode: 'prompt', uuid: normalUuid })
      const executed: string[][] = []
      expect(
        processQueueIfReady({
          executeInput: async cmds => {
            executed.push(cmds.map(c => String(c.value)))
          },
        }).processed,
      ).toBe(false)

      enqueue({ value: 'ahead-prompt', mode: 'prompt', uuid: aheadUuid })
      markAheadOfSessionStart(aheadUuid)
      expect(
        processQueueIfReady({
          executeInput: async cmds => {
            executed.push(cmds.map(c => String(c.value)))
          },
        }).processed,
      ).toBe(true)
      expect(executed).toEqual([['ahead-prompt']])
    } finally {
      latch.complete()
    }

    // After latch completes, waiting prompt drains
    const afterLatch: string[][] = []
    expect(
      processQueueIfReady({
        executeInput: async cmds => {
          afterLatch.push(cmds.map(c => String(c.value)))
        },
      }).processed,
    ).toBe(true)
    expect(afterLatch).toEqual([['wait-for-start']])

    // 2) promptSubmitted fresh coalescing + `@`-mention split guard + stale/stopped split
    resetCommandQueue()
    const freshUnder = {
      permissionMode: 'default',
      hooks: 'h1',
      plugins: 'p1',
      hooksSkippedByTrust: false,
    }
    enqueue({
      value: 'first screened',
      mode: 'prompt',
      promptSubmitted: { text: 'first screened', under: freshUnder },
    })
    enqueue({
      value: 'second screened',
      mode: 'prompt',
      promptSubmitted: { text: 'second screened', under: freshUnder },
    })
    enqueue({
      value: 'third with @file.ts',
      mode: 'prompt',
      promptSubmitted: { text: 'third with @file.ts', under: freshUnder },
    })
    const batches: string[][] = []
    processQueueIfReady({
      screeningStale: () => false,
      executeInput: async cmds => {
        batches.push(cmds.map(c => String(c.value)))
      },
    })
    expect(batches).toEqual([['first screened', 'second screened']])
    expect(getCommandQueueLength()).toBe(1)

    // Stopped prompt splits solo
    resetCommandQueue()
    enqueue({
      value: 'stopped-one',
      mode: 'prompt',
      promptSubmitted: {
        text: 'stopped-one',
        under: freshUnder,
        stopped: 'blocked by hook',
      },
    })
    enqueue({
      value: 'after-stopped',
      mode: 'prompt',
      promptSubmitted: { text: 'after-stopped', under: freshUnder },
    })
    const stoppedBatches: string[][] = []
    processQueueIfReady({
      screeningStale: () => false,
      executeInput: async cmds => {
        stoppedBatches.push(cmds.map(c => String(c.value)))
      },
    })
    expect(stoppedBatches).toEqual([['stopped-one']])
    expect(getCommandQueueLength()).toBe(1)

    // 3) isSlashCommand checks LAST block of ContentBlockParam[]
    resetCommandQueue()
    enqueue({
      value: [
        { type: 'text', text: 'context prefix' },
        { type: 'text', text: '/help' },
      ],
      mode: 'prompt',
    })
    enqueue({ value: 'regular follow-up', mode: 'prompt' })
    const slashBatches: number[] = []
    processQueueIfReady({
      executeInput: async cmds => {
        slashBatches.push(cmds.length)
      },
    })
    // First item ends with `/help` -> dispatched individually (length 1)
    expect(slashBatches).toEqual([1])
    expect(getCommandQueueLength()).toBe(1)

    resetCommandQueue()
    enqueue({
      value: [
        { type: 'text', text: '/help' },
        { type: 'text', text: 'actually plain text' },
      ],
      mode: 'prompt',
    })
    enqueue({ value: 'regular follow-up', mode: 'prompt' })
    const nonSlashBatches: number[] = []
    processQueueIfReady({
      executeInput: async cmds => {
        nonSlashBatches.push(cmds.length)
      },
    })
    // Last block is NOT a slash command -> batched together (length 2)
    expect(nonSlashBatches).toEqual([2])
  })
})

// ============================================================================
// Group 4: print.ts, QueryEngine.ts & structuredIO.ts (P0-15/16/17, P1-7, P2)
// ============================================================================
describe('Group 4: Headless print.ts, QueryEngine.ts & structuredIO.ts', () => {
  test('P0-15: buildHeadlessInterruptReceipt honors cancel_queued:true, requeueTaken(), and returns official receipt', () => {
    const lifecycle: Array<[string, string]> = []
    const u1 = '00000000-0000-4000-8000-0000000000d1' as any
    const u2 = '00000000-0000-4000-8000-0000000000d2' as any
    const u3 = '00000000-0000-4000-8000-0000000000d3' as any

    // Case A: cancel_queued: false resurrects mid-turn absorbed prompt & returns still_queued + put_back + turn
    enqueue({
      value: 'absorbed-prompt',
      mode: 'prompt',
      uuid: u1,
      requeueIfInterruptedWithinMs: 10_000,
    })
    consume([getCommandQueue()[0]!], { reason: 'absorbed_mid_turn' })
    startRequeueWindow()
    enqueue({ value: 'still-waiting', mode: 'prompt', uuid: u2 })

    const receiptKeep = buildHeadlessInterruptReceipt({
      cancelQueued: false,
      turnOutcome: 'stopped',
      onCommandLifecycle: (id, state) => lifecycle.push([id, state]),
    })
    expect(receiptKeep.turn).toBe('stopped')
    expect(receiptKeep.still_queued).toEqual([u1, u2])
    expect(receiptKeep.put_back).toEqual([u1])
    expect(wasPutBack(u1)).toBe(true)
    expect(lifecycle).toEqual([[u1, 'queued']])

    // Case B: cancel_queued: true clears queue, emits cancelled lifecycle, spares userStopNotice, does not resurrect
    lifecycle.length = 0
    resetCommandQueue()
    enqueue({
      value: 'absorbed-should-settle',
      mode: 'prompt',
      uuid: u1,
      requeueIfInterruptedWithinMs: 10_000,
    })
    consume([getCommandQueue()[0]!], { reason: 'absorbed_mid_turn' })
    enqueue({ value: 'queued-to-cancel', mode: 'prompt', uuid: u2 })
    enqueue({
      value: 'stop-notice',
      mode: 'prompt',
      uuid: u3,
      userStopNotice: true,
    })

    const receiptCancel = buildHeadlessInterruptReceipt({
      cancelQueued: true,
      turnOutcome: 'idle',
      onCommandLifecycle: (id, state) => lifecycle.push([id, state]),
    })
    expect(receiptCancel).toEqual({
      still_queued: [],
      cancelled: [u2],
      turn: 'idle',
    })
    expect(lifecycle).toEqual([[u2, 'cancelled']])
    expect(getCommandQueue().map(c => c.uuid)).toEqual([u3])
    expect(wasPutBack(u1)).toBe(false)

    // Verify print.ts checks spare_background_tasks before sweeping background agents
    const printSrc = readFileSync(join(import.meta.dir, '../print.ts'), 'utf8')
    expect(printSrc).toContain('interruptReq.spare_background_tasks === true')
    expect(printSrc).toContain('if (!spareBackgroundTasks)')
  })

  test('P0-16: interruptAndWaitForRewindSettlement aborts active turn and awaits settlement before splice', async () => {
    const controller = new AbortController()
    let running = true
    let resolveTurn!: () => void
    const settlingPromise = new Promise<void>(resolve => {
      resolveTurn = resolve
    })
    const events: string[] = []
    controller.signal.addEventListener('abort', () => {
      events.push('aborted')
      setTimeout(() => {
        events.push('turn-settled')
        running = false
        resolveTurn()
      }, 15)
    })

    const res = await interruptAndWaitForRewindSettlement({
      getAbortController: () => controller,
      isRunning: () => running,
      getSettlingPromise: () => settlingPromise,
      timeoutMs: 1000,
    })
    events.push('after-settlement')
    expect(res.settled).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(events).toEqual(['aborted', 'turn-settled', 'after-settlement'])
  })

  test('P0-17: StructuredIO passes control_cancel_request through and handleIncomingControlCancelRequest aborts matching request_id', async () => {
    const lines = [
      JSON.stringify({
        type: 'control_cancel_request',
        request_id: 'req-cancel-1',
      }) + '\n',
    ]
    const io = new StructuredIO(
      (async function* () {
        for (const l of lines) yield l
      })(),
    )
    const received: unknown[] = []
    for await (const msg of io.structuredInput) {
      received.push(msg)
    }
    expect(received).toEqual([
      { type: 'control_cancel_request', request_id: 'req-cancel-1' },
    ])

    const inFlight = new Map<string, AbortController>()
    const ac = new AbortController()
    inFlight.set('req-cancel-1', ac)
    expect(handleIncomingControlCancelRequest(inFlight, 'req-missing')).toBe(
      false,
    )
    expect(ac.signal.aborted).toBe(false)
    expect(handleIncomingControlCancelRequest(inFlight, 'req-cancel-1')).toBe(
      true,
    )
    expect(ac.signal.aborted).toBe(true)
  })

  test('P0-17: handleHeadlessCancelAsyncMessage respects isFoldInFlight, forgoRequeue, markCancelPending & lifecycle', () => {
    const lifecycle: Array<[string, string]> = []
    const uFold = '00000000-0000-4000-8000-0000000000e1' as any
    const uQueued = '00000000-0000-4000-8000-0000000000e2' as any
    const uAbsorbed = '00000000-0000-4000-8000-0000000000e3' as any

    // 1) In-flight fold refuses cancellation and does not mark cancelPending
    enqueue({ value: 'folding', mode: 'prompt', uuid: uFold })
    registerFoldInFlight([{ uuid: uFold }])
    const foldRes = handleHeadlessCancelAsyncMessage({
      targetUuid: uFold,
      onCommandLifecycle: (id, st) => lifecycle.push([id, st]),
    })
    expect(foldRes).toEqual({ cancelled: false })
    expect(getCommandQueue().some(c => c.uuid === uFold)).toBe(true)
    expect(consumeCancelPending(uFold)).toBe(false)
    unregisterFoldInFlight([{ uuid: uFold }])

    // 2) Queued non-folding command cancels, emits lifecycle, echoes message_uuid
    enqueue({ value: 'cancel-me', mode: 'prompt', uuid: uQueued })
    const queuedRes = handleHeadlessCancelAsyncMessage({
      targetUuid: uQueued,
      onCommandLifecycle: (id, st) => lifecycle.push([id, st]),
    })
    expect(queuedRes).toEqual({ cancelled: true, message_uuid: uQueued })
    expect(lifecycle).toEqual([[uQueued, 'cancelled']])

    // 3) Already absorbed prompt: calls forgoRequeue + markCancelPending
    enqueue({
      value: 'absorbed-cancel',
      mode: 'prompt',
      uuid: uAbsorbed,
      requeueIfInterruptedWithinMs: 10_000,
    })
    consume([getCommandQueue().find(c => c.uuid === uAbsorbed)!], {
      reason: 'absorbed_mid_turn',
    })
    const absorbedRes = handleHeadlessCancelAsyncMessage({
      targetUuid: uAbsorbed,
    })
    expect(absorbedRes).toEqual({ cancelled: false })
    expect(requeueTaken()).toBeUndefined()
    expect(consumeCancelPending(uAbsorbed)).toBe(true)
  })

  test('P1-7: StructuredIO.createHookCallback converts seconds to ms, enforces deadline with abort, and propagates ControlStreamClosedError', async () => {
    const io = new StructuredIO(
      (async function* () {
        await new Promise(resolve => setTimeout(resolve, 250))
      })(),
    )
    const sentRequests: Array<{
      request: Record<string, unknown>
      signal?: AbortSignal
    }> = []
    const origSend = (
      io as unknown as {
        sendRequest: (
          req: Record<string, unknown>,
          schema: unknown,
          signal?: AbortSignal,
        ) => Promise<unknown>
      }
    ).sendRequest.bind(io)

    // 1) Verify seconds -> ms conversion (`timeout: 2` => `deadline_ms: 2000`) & combined signal
    ;(
      io as unknown as {
        sendRequest: (
          req: Record<string, unknown>,
          schema: unknown,
          signal?: AbortSignal,
        ) => Promise<unknown>
      }
    ).sendRequest = async (req, _schema, signal) => {
      sentRequests.push({ request: req, signal })
      return {}
    }
    const callerAbort = new AbortController()
    const hookCb = io.createHookCallback('cb-1', 2)
    await hookCb.callback({} as any, 'tu-1', callerAbort.signal)
    expect(sentRequests[0]?.request.deadline_ms).toBe(2000)
    // Combined signal must NOT be raw callerAbort.signal alone (it combines timeout)
    expect(sentRequests[0]?.signal).not.toBe(callerAbort.signal)

    // 2) Deadline fires even when an un-aborted caller signal is passed
    ;(
      io as unknown as {
        sendRequest: (
          req: Record<string, unknown>,
          schema: unknown,
          signal?: AbortSignal,
        ) => Promise<unknown>
      }
    ).sendRequest = async (_req, _schema, signal) =>
      await new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        })
      })
    const shortHook = io.createHookCallback('cb-timeout', 0.03)
    const timedOutRes = await shortHook.callback(
      {} as any,
      null,
      new AbortController().signal,
    )
    expect(timedOutRes).toEqual({})

    // 3) ControlStreamClosedError propagates instead of returning {}
    ;(
      io as unknown as {
        sendRequest: () => Promise<unknown>
      }
    ).sendRequest = async () => {
      throw new ControlStreamClosedError('stream closed')
    }
    const closedHook = io.createHookCallback('cb-closed', 5)
    await expect(
      closedHook.callback({} as any, null, undefined),
    ).rejects.toBeInstanceOf(ControlStreamClosedError)

    // Restore original sendRequest (avoid unused var lint)
    void origSend
  })

  test('P1-7: QueryEngine mid-loop error_max_structured_output_retries & print.ts noteTurnStart members:batch', () => {
    const qeSrc = readFileSync(
      join(import.meta.dir, '../../QueryEngine.ts'),
      'utf8',
    )
    const idx = qeSrc.indexOf("subtype: 'error_max_structured_output_retries'")
    expect(idx).toBeGreaterThan(0)
    const before = qeSrc.slice(Math.max(0, idx - 800), idx)
    const block = qeSrc.slice(idx, idx + 1200)
    expect(before).toContain('await recordTranscript(this.mutableMessages)')
    expect(block).toContain(
      "terminal_reason: 'structured_output_retry_exhausted'",
    )
    expect(block).toContain('fast_mode_disabled_reason')
    expect(block).toContain('origin: options.origin')

    const printSrc = readFileSync(join(import.meta.dir, '../print.ts'), 'utf8')
    expect(printSrc).toContain(
      'rapidFollowupPreempt.noteTurnStart({\n            command: cmd,\n            members: batch,\n          })',
    )
  })

  test('P2: PrintTextResults -p error strings match official 2.1.328 (no Tip/dollar prefix)', () => {
    const written: string[] = []
    const printer = new PrintTextResults(
      { maxTurns: 7, maxBudgetUsd: 2.5 },
      text => written.push(text),
      () => false,
      () => {},
      () => false,
    )
    printer.printAtExit({ type: 'result', subtype: 'error_max_turns' })
    expect(written.join('')).toBe('Error: Reached max turns (7)')

    const written2: string[] = []
    const printer2 = new PrintTextResults(
      { maxTurns: 7, maxBudgetUsd: 2.5 },
      text => written2.push(text),
      () => false,
      () => {},
      () => false,
    )
    printer2.printAtExit({ type: 'result', subtype: 'error_max_budget_usd' })
    expect(written2.join('')).toBe('Error: Exceeded USD budget (2.5)')
  })
})
