import { afterEach, describe, expect, mock, test } from 'bun:test'

const proxyStub = () => ({
  disableKeepAlive: () => {},
  getAddressFamily: () => 0,
  getProxyUrl: () => undefined,
  getNoProxy: () => undefined,
  shouldBypassProxy: () => false,
  createAxiosInstance: () => ({}),
  getProxyAgent: () => undefined,
  getWebSocketProxyAgent: () => undefined,
  getWebSocketProxyUrl: () => undefined,
  shouldDisableFetchTimeoutForBodyIdle: () => false,
  getProxyFetchOptions: () => ({}),
  getFetchOptions: () => ({}),
  configureGlobalAgents: () => {},
  AWS_SDK_REQUEST_TIMEOUT_MS: 30_000,
  getAwsSdkProxyRequestHandler: async () => undefined,
  getAWSClientProxyConfig: async () => ({}),
  clearProxyCache: () => {},
})
mock.module('src/utils/proxy.js', proxyStub)
mock.module('../proxy.js', proxyStub)

const {
  HELD_FOR_QUEUED_MESSAGE_DECISION_REASON,
  HELD_FOR_QUEUED_MESSAGE_TOOL_RESULT,
  askIsHeldForQueuedMessage,
  isCoworkCloudAutoHookAllowBlocked,
} = await import('./permissions.js')

describe('permissions 2.1.299 & 2.1.301 alignment (#727, #861)', () => {
  const origEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT

  afterEach(() => {
    if (origEntrypoint === undefined) {
      delete process.env.CLAUDE_CODE_ENTRYPOINT
    } else {
      process.env.CLAUDE_CODE_ENTRYPOINT = origEntrypoint
    }
  })

  test('#727 isCoworkCloudAutoHookAllowBlocked blocks Bash/PowerShell/Agent in remote_cowork auto mode only', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'remote_cowork'
    expect(isCoworkCloudAutoHookAllowBlocked('Bash', 'auto')).toBe(true)
    expect(isCoworkCloudAutoHookAllowBlocked('PowerShell', 'auto')).toBe(true)
    expect(isCoworkCloudAutoHookAllowBlocked('Agent', 'auto')).toBe(true)
    expect(isCoworkCloudAutoHookAllowBlocked('Read', 'auto')).toBe(false)
    expect(isCoworkCloudAutoHookAllowBlocked('Bash', 'default')).toBe(false)

    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    expect(isCoworkCloudAutoHookAllowBlocked('Bash', 'auto')).toBe(false)
  })

  test('#861 askIsHeldForQueuedMessage returns false for subagents, virtual messages, forceDecision, or interactive tools', () => {
    expect(HELD_FOR_QUEUED_MESSAGE_DECISION_REASON.reason).toBe(
      'tool permission request held back for a queued message',
    )
    expect(HELD_FOR_QUEUED_MESSAGE_TOOL_RESULT).toContain(
      'a message from the user arrived first',
    )

    const tool = { name: 'Bash' } as any
    const assistantMsg = {
      type: 'assistant',
      message: {
        id: 'msg-1',
        content: [{ type: 'tool_use', id: 'tu-1' }],
      },
    } as any

    // Subagent
    expect(
      askIsHeldForQueuedMessage(
        { tool, toolUseContext: { agentId: 'sub-1' } as any },
        'tu-1',
        assistantMsg,
      ),
    ).toBe(false)

    // Virtual message
    expect(
      askIsHeldForQueuedMessage({ tool, toolUseContext: {} as any }, 'tu-1', {
        ...assistantMsg,
        isVirtual: true,
      }),
    ).toBe(false)

    // forceDecision present
    expect(
      askIsHeldForQueuedMessage(
        {
          tool,
          toolUseContext: {} as any,
          forceDecision: { behavior: 'ask', message: 'ask' } as any,
        },
        'tu-1',
        assistantMsg,
      ),
    ).toBe(false)

    // requiresUserInteraction
    expect(
      askIsHeldForQueuedMessage(
        {
          tool: {
            name: 'AskUserQuestion',
            requiresUserInteraction: () => true,
          } as any,
          toolUseContext: {} as any,
        },
        'tu-1',
        assistantMsg,
      ),
    ).toBe(false)
  })
})
