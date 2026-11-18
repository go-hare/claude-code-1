import { describe, expect, mock, test } from 'bun:test'
import fs from 'fs'
import path from 'path'
import type { Message } from '../../types/message.js'

mock.module('../proxy.js', () => ({
  getFetchOptions: () => ({}),
  getProxyFetchOptions: () => ({}),
  getProxyUrl: () => undefined,
  getNoProxy: () => undefined,
  shouldBypassProxy: () => false,
  clearProxyCache: () => {},
  getAWSClientProxyConfig: async () => ({}),
  getAwsSdkProxyRequestHandler: async () => undefined,
  configureGlobalAgents: () => {},
  getProxyAgent: () => undefined,
  getWebSocketProxyAgent: () => undefined,
  getWebSocketProxyUrl: () => undefined,
  createAxiosInstance: () => ({}),
  disableKeepAlive: () => {},
  _resetKeepAliveForTesting: () => {},
  getAddressFamily: () => 0,
  shouldDisableFetchTimeoutForBodyIdle: () => false,
  AWS_SDK_REQUEST_TIMEOUT_MS: 30_000,
}))

const { stripImagesFromMessages } = await import(
  '../../services/compact/compact.js'
)
const { getFullDiskSaveCode } = await import('../config.js')
const { normalizeAttachmentForAPI } = await import('../messages.js')
const { collectPromptSubmitAttachments, rewritePromptSubmitUserMessage } =
  await import('../processUserInput/promptSubmit.js')

describe('2.1.299-301 alignment (#600, #630, #654, #679, #807, #851)', () => {
  test('#600 rewritePromptSubmitUserMessage rewrites prompt even with image or degraded image placeholder blocks', () => {
    const degradedPlaceholder = {
      type: 'text' as const,
      text: '[Image failed to resize]',
    }
    const msgWithPlaceholder = {
      type: 'user' as const,
      uuid: 'u-1',
      message: {
        role: 'user' as const,
        content: [
          degradedPlaceholder,
          { type: 'text' as const, text: 'original prompt' },
        ],
      },
    }
    const rewritten = rewritePromptSubmitUserMessage(
      [msgWithPlaceholder as never],
      'original prompt',
      'rewritten prompt',
    )
    expect(rewritten).toBeDefined()
    expect(msgWithPlaceholder.message.content).toEqual([
      { type: 'text', text: 'rewritten prompt' },
    ])

    const msgImageOnly = {
      type: 'user' as const,
      uuid: 'u-2',
      message: {
        role: 'user' as const,
        content: [
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: 'image/png' as const,
              data: 'abc',
            },
          },
        ],
      },
    }
    const rewrittenImgOnly = rewritePromptSubmitUserMessage(
      [msgImageOnly as never],
      '',
      'added by hook',
    )
    expect(rewrittenImgOnly).toBeDefined()
    expect(msgImageOnly.message.content as unknown[]).toEqual([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'abc' },
      },
      { type: 'text', text: 'added by hook' },
    ])
  })

  test('#600 collectPromptSubmitAttachments marks empty pasted image as unreadable', () => {
    const pasted: Record<
      number,
      {
        id: number
        type: 'image'
        content: string
        mediaType: string
        filename: string
      }
    > = {
      1: {
        id: 1,
        type: 'image',
        content: '',
        mediaType: 'image/png',
        filename: 'empty.png',
      },
    }
    const atts = collectPromptSubmitAttachments(
      'hello',
      pasted as unknown as Parameters<typeof collectPromptSubmitAttachments>[1],
    )
    expect(atts).toEqual([
      {
        type: 'image',
        mediaType: 'image/png',
        filename: 'empty.png',
        unreadable: 'the pasted image is empty',
      },
    ])
  })

  test('#630 stripImagesFromMessages strips queued_command and file attachment media', () => {
    const messages = [
      {
        type: 'attachment',
        uuid: 'a-1',
        attachment: {
          type: 'queued_command',
          prompt: [
            { type: 'text', text: 'hi' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'xxx' },
            },
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: 'yyy',
              },
            },
          ],
        },
      },
      {
        type: 'attachment',
        uuid: 'a-2',
        attachment: {
          type: 'file',
          filename: '/tmp/foo.png',
          content: {
            type: 'image',
            file: { base64: 'zzz', type: 'image/png', originalSize: 10 },
          },
        },
      },
    ] as unknown as Message[]

    const stripped = stripImagesFromMessages(messages)
    expect(
      (stripped[0] as unknown as { attachment: { prompt: unknown[] } })
        .attachment.prompt,
    ).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'text', text: '[image]' },
      { type: 'text', text: '[document]' },
    ])
    expect(
      (
        stripped[1] as unknown as {
          attachment: { content: { type: string; file: { content: string } } }
        }
      ).attachment.content,
    ).toMatchObject({
      type: 'text',
      file: { filePath: '/tmp/foo.png', content: '[image]' },
    })
  })

  test('#654 pdf.ts and execFileNoThrow.ts wire inheritFd for /proc/self/fd', () => {
    const pdfSrc = fs.readFileSync(path.resolve(__dirname, '../pdf.ts'), 'utf8')
    const execSrc = fs.readFileSync(
      path.resolve(__dirname, '../execFileNoThrow.ts'),
      'utf8',
    )
    expect(pdfSrc).toContain("'/proc/self/fd/3'")
    expect(pdfSrc).toContain('inheritFd: procFdHandle.fd')
    expect(execSrc).toContain('inheritFd?: number')
    expect(execSrc).toContain('finalInheritFd as unknown as')
  })

  test('#679 processUserInput wires deliveredTurnStart for skipped-attachment turns', () => {
    const puiSrc = fs.readFileSync(
      path.resolve(__dirname, '../processUserInput/processUserInput.ts'),
      'utf8',
    )
    const attSrc = fs.readFileSync(
      path.resolve(__dirname, '../attachments.ts'),
      'utf8',
    )
    expect(puiSrc).toContain('deliveredTurnStart: true')
    expect(attSrc).toContain(
      'options?.isRegularUserPrompt || options?.deliveredTurnStart',
    )
  })

  test('#807 normalizeAttachmentForAPI formats Claude 3 wholeRefusedByModel pdf_reference note', () => {
    const msgs = normalizeAttachmentForAPI({
      type: 'pdf_reference',
      filename: '/tmp/spec.pdf',
      pageCount: 4,
      fileSize: 2048,
      displayPath: 'spec.pdf',
      wholeRefusedByModel: true,
      modelReadsByPage: true,
    })
    const text = String(
      (msgs[0] as { message: { content: string } }).message.content,
    )
    expect(text).toContain(
      'This model cannot be sent a PDF file, only its pages as images; pages: "1-4" reads all of it.',
    )
    expect(text).not.toContain('This PDF is too large to read all at once.')
    expect(text).not.toContain('Start by reading the first few pages')
  })

  test('#851 getFullDiskSaveCode is exported and defaults to undefined', () => {
    expect(getFullDiskSaveCode()).toBeUndefined()
  })
})
