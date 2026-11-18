import { describe, expect, mock, test } from 'bun:test'
import sharp from 'sharp'

mock.module('../../utils/proxy.js', () => ({
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

const {
  isHeadlessCronLoading,
  reportHeadlessSettingsValidationErrors,
  resizeInboundImageBlocks,
} = await import('../print.js')

describe('2.1.299 print alignment (#599, #632, #640)', () => {
  test('#599 isHeadlessCronLoading allows wakeups during waiting_for_agents', () => {
    expect(
      isHeadlessCronLoading({
        running: true,
        runPhase: 'querying',
        inputClosed: false,
      }),
    ).toBe(true)

    expect(
      isHeadlessCronLoading({
        running: true,
        runPhase: 'waiting_for_agents',
        inputClosed: false,
      }),
    ).toBe(false)

    expect(
      isHeadlessCronLoading({
        running: false,
        runPhase: 'idle',
        inputClosed: true,
        hasPendingWakeup: false,
      }),
    ).toBe(true)

    expect(
      isHeadlessCronLoading({
        running: true,
        runPhase: 'waiting_for_agents',
        inputClosed: true,
        hasPendingWakeup: true,
      }),
    ).toBe(false)
  })

  test('#632 resizeInboundImageBlocks downsamples oversized base64 image blocks', async () => {
    const bigPng = await sharp({
      create: {
        width: 2400,
        height: 2400,
        channels: 3,
        background: { r: 120, g: 180, b: 220 },
      },
    })
      .png()
      .toBuffer()

    const blocks = [
      { type: 'text' as const, text: 'check this' },
      {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: 'image/png' as const,
          data: bigPng.toString('base64'),
        },
      },
    ]

    const out = await resizeInboundImageBlocks(blocks)
    expect(Array.isArray(out)).toBe(true)
    const arr = out as typeof blocks
    expect(arr[0]).toEqual({ type: 'text', text: 'check this' })
    const outImg = arr[1]!
    expect(outImg.type).toBe('image')
    if (outImg.type === 'image' && outImg.source.type === 'base64') {
      const meta = await sharp(
        Buffer.from(outImg.source.data, 'base64'),
      ).metadata()
      expect(meta.width).toBeLessThanOrEqual(2000)
      expect(meta.height).toBeLessThanOrEqual(2000)
    }
  })

  test('#632 resizeInboundImageBlocks falls back gracefully on invalid base64', async () => {
    const blocks = [
      {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: 'image/png' as const,
          data: '',
        },
      },
    ]
    const out = await resizeInboundImageBlocks(blocks)
    expect(out).toEqual(blocks)
  })

  test('#640 reportHeadlessSettingsValidationErrors does not emit stderr in json/stream-json mode', () => {
    const writes: string[] = []
    reportHeadlessSettingsValidationErrors('json', s => writes.push(s))
    reportHeadlessSettingsValidationErrors('stream-json', s => writes.push(s))
    expect(writes).toEqual([])
  })
})
