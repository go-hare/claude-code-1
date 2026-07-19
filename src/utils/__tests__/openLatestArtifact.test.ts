import { afterEach, describe, expect, mock, test } from 'bun:test'

const openBrowserMock = mock(async (_url: string) => true)
const logEventMock = mock((_name: string, _meta: object) => {})

mock.module('../../services/analytics/index.js', () => ({
  logEvent: logEventMock,
  logEventAsync: async () => {},
  attachAnalyticsSink: () => {},
  stripProtoFields: <T>(x: T) => x,
}))

mock.module('../browser.js', () => ({
  openBrowser: openBrowserMock,
  openPath: async () => true,
}))

// Import after mocks
const { openLatestArtifact } = await import('../openArtifactShortcut.js')
import type { Message } from '../../types/message.js'

function assistantArtifact(
  id: string,
  filePath: string,
  resultText: string,
  isError = false,
): Message[] {
  return [
    {
      type: 'assistant',
      uuid: `a-${id}`,
      timestamp: new Date().toISOString(),
      message: {
        id: `m-${id}`,
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id,
            name: 'artifact',
            input: { file_path: filePath },
          },
        ],
      },
    } as unknown as Message,
    {
      type: 'user',
      uuid: `u-${id}`,
      timestamp: new Date().toISOString(),
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: id,
            content: resultText,
            is_error: isError,
          },
        ],
      },
    } as unknown as Message,
  ]
}

describe('openLatestArtifact', () => {
  afterEach(() => {
    openBrowserMock.mockClear()
    logEventMock.mockClear()
  })

  test('returns false when no artifacts', async () => {
    expect(await openLatestArtifact([])).toBe(false)
    expect(openBrowserMock).not.toHaveBeenCalled()
  })

  test('opens newest non-error artifact with via=banner_open', async () => {
    const older = assistantArtifact(
      't1',
      '/tmp/a.html',
      'url: https://host/a.html id: aaa',
    )
    const newer = assistantArtifact(
      't2',
      '/tmp/b.html',
      'https://host/b.html\nid: bbb',
    )
    // extractArtifacts walks messages and reverses → newest first;
    // push older then newer so reverse yields newer first.
    const messages = [...older, ...newer]
    expect(await openLatestArtifact(messages)).toBe(true)
    expect(openBrowserMock).toHaveBeenCalledTimes(1)
    const url = openBrowserMock.mock.calls[0]![0] as string
    expect(url).toContain('https://host/b.html')
    expect(url).toContain('via=banner_open')
    expect(logEventMock).toHaveBeenCalledWith('frame_link_open', {})
  })

  test('prefers AppState frameUrls map over transcript scan', async () => {
    const messages = assistantArtifact(
      't1',
      '/tmp/a.html',
      'https://host/from-transcript.html',
    )
    const map = {
      '/tmp/x.html': {
        url: 'https://host/from-map.html',
        updatedAt: 1,
      },
    }
    expect(await openLatestArtifact(messages, map)).toBe(true)
    const url = openBrowserMock.mock.calls[0]![0] as string
    expect(url).toContain('from-map.html')
    expect(url).not.toContain('from-transcript')
  })

  test('skips error artifacts', async () => {
    const err = assistantArtifact(
      'e1',
      '/tmp/e.html',
      'https://host/e.html',
      true,
    )
    const ok = assistantArtifact('ok1', '/tmp/ok.html', 'https://host/ok.html')
    // reverse → ok first if ok is later in array... extractArtifacts
    // reverses the push order so last scanned is first. Push err then ok.
    expect(await openLatestArtifact([...err, ...ok])).toBe(true)
    const url = openBrowserMock.mock.calls[0]![0] as string
    expect(url).toContain('ok.html')
  })
})
