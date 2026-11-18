import { describe, expect, test } from 'bun:test'
import {
  CcrWorkerStateUploader,
  trimMcpImageToolResult,
  trimMediaToolResult,
  trimmedToolResult,
  withholdWholeFileToolResult,
} from '../ccrClient.js'

describe('#1004 CcrWorkerStateUploader requeueMetadata & requeueStatus', () => {
  test('requeueStatus and requeueMetadata recover after refused combined patch', async () => {
    const sent: Array<Record<string, unknown>> = []
    let uploader: CcrWorkerStateUploader
    uploader = new CcrWorkerStateUploader({
      send: async body => {
        await Promise.resolve()
        sent.push(body)
        if ('worker_status' in body && 'external_metadata' in body) {
          uploader.requeueMetadata({
            external_metadata: body.external_metadata,
          })
          uploader.requeueStatus({ worker_status: body.worker_status })
          return true
        }
        return true
      },
      baseDelayMs: 1,
      maxDelayMs: 5,
      jitterMs: 1,
    })

    uploader.enqueue({
      worker_status: 'idle',
      external_metadata: { title: 'hello' },
    })

    await uploader.flush()
    expect(sent).toEqual([
      { worker_status: 'idle', external_metadata: { title: 'hello' } },
      { worker_status: 'idle' },
      { external_metadata: { title: 'hello' } },
    ])
  })

  test('withoutStatus keeps only ridesAStatus keys', () => {
    const uploader = new CcrWorkerStateUploader({
      send: async () => true,
      baseDelayMs: 1,
      maxDelayMs: 5,
      jitterMs: 1,
      ridesAStatus: ['reply_degraded', 'card_turn_stamp'],
      deleteOutlivesStatus: ['card_turn_stamp'],
    })

    expect(
      uploader.withoutStatus({
        worker_status: 'running',
        internal_metadata: { reply_degraded: true, other: 123 },
      }),
    ).toEqual({ internal_metadata: { reply_degraded: true } })

    expect(
      uploader.withoutStatus({
        worker_status: 'running',
        internal_metadata: { card_turn_stamp: null },
      }),
    ).toBeNull()
  })
})

describe('#1102 trimmedToolResult / image & PDF stripping', () => {
  test('trimMediaToolResult blanks base64 on image and pdf when media=true', () => {
    const img = {
      type: 'image',
      file: { base64: 'AAAABBBB', mimeType: 'image/png' },
    }
    expect(trimMediaToolResult(img, { media: false })).toBe(img)
    expect(trimMediaToolResult(img, { media: true })).toEqual({
      type: 'image',
      file: { base64: '', mimeType: 'image/png' },
    })

    const pdf = {
      type: 'pdf',
      file: { base64: 'JVBERi0x', mimeType: 'application/pdf' },
    }
    expect(trimMediaToolResult(pdf, { media: true })).toEqual({
      type: 'pdf',
      file: { base64: '', mimeType: 'application/pdf' },
    })
  })

  test('trimMcpImageToolResult blanks duplicate base64 data when mcp_images=true', () => {
    const toolUseResult = {
      content: [
        { type: 'text', text: 'ok' },
        { type: 'image', source: { type: 'base64', data: 'IMG_DATA' } },
      ],
    }
    const message = {
      content: [
        {
          type: 'tool_result',
          content: [
            { type: 'text', text: 'ok' },
            { type: 'image', source: { type: 'base64', data: 'IMG_DATA' } },
          ],
        },
      ],
    }

    expect(
      trimMcpImageToolResult(toolUseResult, message, { mcp_images: false }),
    ).toBe(toolUseResult)
    expect(
      trimmedToolResult(toolUseResult, message, {
        media: true,
        mcp_images: true,
      }),
    ).toEqual({
      content: [
        { type: 'text', text: 'ok' },
        { type: 'image', source: { type: 'base64', data: '' } },
      ],
    })
  })

  test('withholdWholeFileToolResult strips originalFile and structuredPatch', () => {
    const res = withholdWholeFileToolResult({
      type: 'update',
      content: 'new',
      originalFile: 'old',
      structuredPatch: [{ oldStart: 1 }],
    })
    expect(res).toEqual({
      type: 'update',
      content: 'new',
      originalFile: null,
      structuredPatch: [],
    })
  })
})
