import { describe, expect, mock, test } from 'bun:test'
import { AbortError } from 'src/utils/errors.js'
import { ReadMcpResourceTool } from '../ReadMcpResourceTool.js'

describe('ReadMcpResourceTool AbortSignal forwarding (#1226)', () => {
  test('passes abortController.signal to client.readResource and throws AbortError when aborted', async () => {
    const abortController = new AbortController()
    let receivedSignal: AbortSignal | undefined

    const readResource = mock(
      async (_params: { uri: string }, options?: { signal?: AbortSignal }) => {
        receivedSignal = options?.signal
        abortController.abort()
        throw new Error('Request cancelled')
      },
    )

    const fakeContext = {
      abortController,
      options: {
        mcpClients: [
          {
            type: 'connected' as const,
            name: 'test-server',
            capabilities: { resources: {} },
            config: { type: 'sdk' as const, name: 'test-server' },
            client: { readResource },
          },
        ],
      },
    } as unknown as Parameters<typeof ReadMcpResourceTool.call>[1]

    await expect(
      ReadMcpResourceTool.call(
        { server: 'test-server', uri: 'file:///slow' },
        fakeContext,
      ),
    ).rejects.toBeInstanceOf(AbortError)

    expect(receivedSignal).toBe(abortController.signal)
    expect(readResource).toHaveBeenCalledTimes(1)
  })
})
