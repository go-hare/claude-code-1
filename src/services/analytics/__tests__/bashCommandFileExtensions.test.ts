/**
 * densable z5n / Wkc residual helpers for tool success analytics.
 */
import { describe, expect, test } from 'bun:test'
import {
  bashCommandFileExtensionsForAnalytics,
  toolResultAttachmentBytesFromMessages,
} from '../metadata'

const asStr = (v: unknown): string | undefined => v as string | undefined

describe('bashCommandFileExtensionsForAnalytics densable z5n', () => {
  test('no dot → undefined', () => {
    expect(bashCommandFileExtensionsForAnalytics('echo hi')).toBeUndefined()
  })

  test('harvests sorted unique doc extensions', () => {
    expect(
      asStr(
        bashCommandFileExtensionsForAnalytics(
          'cat notes.MD && cp a.pdf b.PDF && echo x.txt',
        ),
      ),
    ).toBe('md,pdf,txt')
  })

  test('unknown extensions ignored', () => {
    expect(
      bashCommandFileExtensionsForAnalytics('rm foo.ts && ls bar.js'),
    ).toBeUndefined()
  })

  test('docx/xlsx variants densable g2h', () => {
    expect(
      asStr(
        bashCommandFileExtensionsForAnalytics('open report.docx sheet.xlsx'),
      ),
    ).toBe('docx,xlsx')
  })
})

describe('toolResultAttachmentBytesFromMessages densable Wkc', () => {
  test('null/empty → 0', () => {
    expect(toolResultAttachmentBytesFromMessages(undefined)).toBe(0)
    expect(toolResultAttachmentBytesFromMessages(null)).toBe(0)
    expect(toolResultAttachmentBytesFromMessages([])).toBe(0)
  })

  test('sums document/image blocks only', () => {
    const messages = [
      {
        type: 'user',
        message: {
          content: [
            { type: 'text', text: 'hi' },
            { type: 'image', source: { type: 'base64', data: 'abc' } },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'document', source: { data: 'xyz' } }],
        },
      },
      {
        type: 'progress',
        message: {
          content: [{ type: 'image', source: { data: 'skip' } }],
        },
      },
    ]
    const n = toolResultAttachmentBytesFromMessages(messages)
    expect(n).toBeGreaterThan(0)
    // text + progress image excluded; only image+document on user/assistant
    const onlyImgDoc = toolResultAttachmentBytesFromMessages([
      {
        type: 'user',
        message: {
          content: [{ type: 'image', source: { type: 'base64', data: 'abc' } }],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'document', source: { data: 'xyz' } }],
        },
      },
    ])
    expect(n).toBe(onlyImgDoc)
  })
})
