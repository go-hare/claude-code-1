/**
 * densable 2.1.289 Skt / bHo / Bhe — focus-fold holds streaming preview.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isStreamingPreviewOnScreen,
  isVisibleQueuedPromptAttachment,
  messagesHoldFocusFold,
  resolveFocusFoldHoldsPreview,
  resolveStreamingPreviewHold,
  streamingRawHasCompletedLine,
} from '../streamingUiGate.js'

const ROOT = join(import.meta.dir, '../../..')

function assistantToolUse(): {
  type: 'assistant'
  message: { content: Array<{ type: string }> }
} {
  return { type: 'assistant', message: { content: [{ type: 'tool_use' }] } }
}

function assistantText(): {
  type: 'assistant'
  message: { content: Array<{ type: string }> }
} {
  return { type: 'assistant', message: { content: [{ type: 'text' }] } }
}

function userText(): {
  type: 'user'
  isMeta?: boolean
  message: { content: Array<{ type: string }> }
} {
  return { type: 'user', message: { content: [{ type: 'text' }] } }
}

function userToolResult(): {
  type: 'user'
  message: { content: Array<{ type: string }> }
} {
  return { type: 'user', message: { content: [{ type: 'tool_result' }] } }
}

describe('densable Bhe isVisibleQueuedPromptAttachment', () => {
  test('queued_command prompt + human origin is a turn boundary', () => {
    expect(
      isVisibleQueuedPromptAttachment({
        type: 'attachment',
        attachment: {
          type: 'queued_command',
          commandMode: 'prompt',
          origin: { kind: 'human' },
        },
      }),
    ).toBe(true)
  })

  test('channel / peer / slack-ping origin are kept even if meta', () => {
    expect(
      isVisibleQueuedPromptAttachment({
        type: 'attachment',
        attachment: {
          type: 'queued_command',
          commandMode: 'prompt',
          isMeta: true,
          origin: { kind: 'channel' },
        },
      }),
    ).toBe(true)
    expect(
      isVisibleQueuedPromptAttachment({
        type: 'attachment',
        attachment: {
          type: 'queued_command',
          commandMode: 'prompt',
          isMeta: true,
          origin: { kind: 'peer' },
        },
      }),
    ).toBe(true)
  })

  test('non-prompt queued_command is not Bhe', () => {
    expect(
      isVisibleQueuedPromptAttachment({
        type: 'attachment',
        attachment: {
          type: 'queued_command',
          commandMode: 'task-notification',
          origin: { kind: 'human' },
        },
      }),
    ).toBe(false)
  })
})

describe('densable bHo messagesHoldFocusFold', () => {
  test('trailing assistant tool_use holds', () => {
    expect(messagesHoldFocusFold([userText(), assistantToolUse()])).toBe(true)
  })

  test('trailing real user text does not hold', () => {
    expect(messagesHoldFocusFold([assistantToolUse(), userText()])).toBe(false)
  })

  test('user tool_result then assistant tool_use still holds', () => {
    expect(
      messagesHoldFocusFold([
        assistantToolUse(),
        userToolResult(),
        assistantToolUse(),
      ]),
    ).toBe(true)
  })

  test('Bhe queued prompt is a turn boundary (false)', () => {
    expect(
      messagesHoldFocusFold([
        assistantToolUse(),
        {
          type: 'attachment',
          attachment: {
            type: 'queued_command',
            commandMode: 'prompt',
            origin: { kind: 'human' },
          },
        },
      ]),
    ).toBe(false)
  })

  test('assistant text-only does not hold', () => {
    expect(messagesHoldFocusFold([userText(), assistantText()])).toBe(false)
  })

  test('empty history does not hold', () => {
    expect(messagesHoldFocusFold([])).toBe(false)
  })
})

describe('densable Skt resolveFocusFoldHoldsPreview', () => {
  const base = {
    isLoading: true,
    briefTranscript: true,
    screen: 'prompt',
    fullscreen: true,
    tailBlank: false,
    streamingToolUseCount: 0,
    messages: [] as ReturnType<typeof assistantToolUse>[],
  }

  test('all AND gates required', () => {
    expect(resolveFocusFoldHoldsPreview({ ...base, tailBlank: true })).toBe(
      true,
    )
    expect(
      resolveFocusFoldHoldsPreview({
        ...base,
        tailBlank: true,
        isLoading: false,
      }),
    ).toBe(false)
    expect(
      resolveFocusFoldHoldsPreview({
        ...base,
        tailBlank: true,
        briefTranscript: false,
      }),
    ).toBe(false)
    expect(
      resolveFocusFoldHoldsPreview({
        ...base,
        tailBlank: true,
        screen: 'transcript',
      }),
    ).toBe(false)
    expect(
      resolveFocusFoldHoldsPreview({
        ...base,
        tailBlank: true,
        fullscreen: false,
      }),
    ).toBe(false)
  })

  test('holds on tailBlank or streaming tools or bHo', () => {
    expect(resolveFocusFoldHoldsPreview(base)).toBe(false)
    expect(resolveFocusFoldHoldsPreview({ ...base, tailBlank: true })).toBe(
      true,
    )
    expect(
      resolveFocusFoldHoldsPreview({ ...base, streamingToolUseCount: 1 }),
    ).toBe(true)
    expect(
      resolveFocusFoldHoldsPreview({
        ...base,
        messages: [assistantToolUse()],
      }),
    ).toBe(true)
  })
})

describe('REPL wires Skt Ve + spinner yu', () => {
  test('source-locks focusFoldHoldsPreview on Messages + spinner', () => {
    const repl = readFileSync(join(ROOT, 'src/screens/REPL.tsx'), 'utf8')
    expect(repl).toContain('resolveFocusFoldHoldsPreview')
    expect(repl).toContain('focusFoldHoldsPreview')
    expect(repl).toContain(
      'hasStreamingText={isLoading && !viewedAgentTask && hasStreamingText && !focusFoldHoldsPreview}',
    )
    expect(repl).toContain(
      'isLoading && !viewedAgentTask && showStreamingText && !focusFoldHoldsPreview',
    )
    expect(repl).toContain('isBriefOnly ||')
    expect(repl).toContain('focusFoldHoldsPreview);')
  })
})

describe('densable Jfr resolveStreamingPreviewHold', () => {
  test('transcript or briefOnly is hidden', () => {
    expect(
      resolveStreamingPreviewHold('transcript', false, true, 'fullscreen'),
    ).toBe('hidden')
    expect(
      resolveStreamingPreviewHold('prompt', true, true, 'fullscreen'),
    ).toBe('hidden')
  })

  test('brief+fullscreen is focus else none', () => {
    expect(
      resolveStreamingPreviewHold('prompt', false, true, 'fullscreen'),
    ).toBe('focus')
    expect(resolveStreamingPreviewHold('prompt', false, true, 'default')).toBe(
      'none',
    )
    expect(
      resolveStreamingPreviewHold('prompt', false, false, 'fullscreen'),
    ).toBe('none')
  })
})

describe('densable xSe _previewOnScreen', () => {
  test('det requires a completed non-empty line', () => {
    expect(streamingRawHasCompletedLine(null)).toBe(false)
    expect(streamingRawHasCompletedLine('hello')).toBe(false)
    expect(streamingRawHasCompletedLine('hello\n')).toBe(true)
    expect(streamingRawHasCompletedLine('\nworld')).toBe(false)
    expect(streamingRawHasCompletedLine(' \nworld')).toBe(false)
  })

  test('none true / hidden false / focus needs det and no tools', () => {
    expect(isStreamingPreviewOnScreen('a\n', 'none', true, 9)).toBe(true)
    expect(isStreamingPreviewOnScreen('a\n', 'hidden', false, 0)).toBe(false)
    expect(isStreamingPreviewOnScreen('a\n', 'focus', false, 0)).toBe(true)
    expect(isStreamingPreviewOnScreen('a\n', 'focus', true, 0)).toBe(false)
    expect(isStreamingPreviewOnScreen('a\n', 'focus', false, 1)).toBe(false)
    expect(isStreamingPreviewOnScreen('hello', 'focus', false, 0)).toBe(false)
  })
})

describe('CLI analog hosts for Drop rows (not Desktop Fco / not ASe)', () => {
  test('PromptInput footerItemSelected + isModalOverlayActive exist', () => {
    const prompt = readFileSync(
      join(ROOT, 'src/components/PromptInput/PromptInput.tsx'),
      'utf8',
    )
    expect(prompt).toContain('footerItemSelected')
    expect(prompt).toContain('isModalOverlayActive')
    const overlay = readFileSync(
      join(ROOT, 'src/context/promptOverlayContext.tsx'),
      'utf8',
    )
    expect(overlay).toContain('useSetPromptOverlay')
    expect(overlay).not.toContain('ui_attach')
    expect(overlay).not.toContain('function Fco')
  })

  test('FEe usePaneToastHold drains processQueue (gold yo analog)', () => {
    const panes = readFileSync(
      join(ROOT, 'src/components/PluginRasterPanes.tsx'),
      'utf8',
    )
    expect(panes).toContain('const { processQueue } = useNotifications()')
    expect(panes).toContain('processQueue()')
    expect(panes).toContain('paneHoldsToasts')
  })

  test('xargs peel stays denylist; CHILD is sdk_default_off only', () => {
    const xargs = readFileSync(
      join(ROOT, 'src/utils/shell/readOnlyCommandValidation.ts'),
      'utf8',
    )
    expect(xargs).toContain("commandName === 'xargs'")
    expect(xargs).toContain('xargsTargetCommands')
    const gates = readFileSync(join(ROOT, 'src/utils/artifactGates.ts'), 'utf8')
    expect(gates).toContain('CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT')
    expect(gates).toContain('never a general ASe/cobalt ON')
  })
})
