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
    expect(slice).toContain('!isTranscriptMode && !verbose')
    expect(slice).toContain('return null')
    expect(slice).toContain('lastThinkingBlockId.has')
  })

  test('Messages does not paint live Ss from streamingThinking', async () => {
    const src = await Bun.file(join(ROOT, 'src/components/Messages.tsx')).text()
    expect(src).not.toContain('streamingThinking.thinking')
    expect(src).not.toContain('isStreamingThinkingVisible')
    expect(src).not.toContain('AssistantThinkingMessage')
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
    expect(src).toContain('const effectiveHint = displayedHint')
    expect(src).not.toContain('thinkingSummary ?? displayedHint')
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
})
