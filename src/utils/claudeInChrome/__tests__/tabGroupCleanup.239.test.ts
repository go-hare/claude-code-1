/**
 * densable 2.1.239 #54 — `jrl` / `ENS` / `SNS` / `iDn` / `/clear` onlyIfEmpty.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resetChromeInstallSessionState } from '../sessionState.js'
import {
  CHROME_TAB_GROUP_CLOSE_CAP,
  closeSessionTabGroup,
  hasPreservedLiveAgentTasks,
  isHumanSubmissionOrigin,
  isTabsCloseSuccess,
  parseTabsContextResult,
  shouldForceCloseChromeTabGroupOnClear,
} from '../tabGroupCleanup.js'

afterEach(() => {
  delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  resetChromeInstallSessionState()
})

function tabsContext(
  tabs: Array<{ tabId: number; url: string }>,
  tabGroupId = 7,
) {
  return {
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ availableTabs: tabs, tabGroupId }),
        },
      ],
    },
  }
}

function closeOk() {
  return { result: { isError: false } }
}

function mockClient(opts: {
  tabs: Array<{ tabId: number; url: string }>
  close?: (tabId: number) => unknown
  connected?: boolean
}) {
  const closed: number[] = []
  return {
    closed,
    isConnected: () => opts.connected !== false,
    callTool: async (name: string, args: Record<string, unknown>) => {
      if (name === 'tabs_context_mcp') {
        expect(args.createIfEmpty).toBe(false)
        return tabsContext(opts.tabs)
      }
      if (name === 'tabs_close_mcp') {
        const tabId = args.tabId as number
        closed.push(tabId)
        return opts.close?.(tabId) ?? closeOk()
      }
      throw new Error(`unexpected tool ${name}`)
    },
  }
}

describe('isHumanSubmissionOrigin densable bve', () => {
  test('only kind===human', () => {
    expect(isHumanSubmissionOrigin(undefined)).toBe(false)
    expect(isHumanSubmissionOrigin({ kind: 'auto-continuation' })).toBe(false)
    expect(isHumanSubmissionOrigin({ kind: 'human' })).toBe(true)
  })
})

describe('hasPreservedLiveAgentTasks densable ZPl', () => {
  test('foreground-killed agent is ignored', () => {
    expect(
      hasPreservedLiveAgentTasks({
        a: { type: 'local_agent', status: 'running', isBackgrounded: false },
      }),
    ).toBe(false)
  })

  test('preserved running agent is live', () => {
    expect(
      hasPreservedLiveAgentTasks({
        a: { type: 'local_agent', status: 'running' },
      }),
    ).toBe(true)
  })

  test('terminal preserved agent is not live', () => {
    expect(
      hasPreservedLiveAgentTasks({
        a: { type: 'dream', status: 'completed' },
      }),
    ).toBe(false)
  })

  test('bash tasks are not the agent family', () => {
    expect(
      hasPreservedLiveAgentTasks({
        a: { type: 'local_bash', status: 'running' },
      }),
    ).toBe(false)
  })
})

describe('shouldForceCloseChromeTabGroupOnClear densable WGw o', () => {
  test('human + no live agents → force close', () => {
    expect(shouldForceCloseChromeTabGroupOnClear({ kind: 'human' }, {})).toBe(
      true,
    )
  })

  test('human + live agent → onlyIfEmpty', () => {
    expect(
      shouldForceCloseChromeTabGroupOnClear(
        { kind: 'human' },
        { a: { type: 'in_process_teammate', status: 'running' } },
      ),
    ).toBe(false)
  })

  test('non-human → onlyIfEmpty', () => {
    expect(shouldForceCloseChromeTabGroupOnClear(undefined, {})).toBe(false)
  })
})

describe('parseTabsContextResult densable iDn', () => {
  test('reads first text block with availableTabs', () => {
    expect(
      parseTabsContextResult(
        tabsContext([{ tabId: 3, url: 'https://example.com' }], 9),
      ),
    ).toEqual({
      tabId: 3,
      tabGroupId: 9,
      json: JSON.stringify({
        availableTabs: [{ tabId: 3, url: 'https://example.com' }],
        tabGroupId: 9,
      }),
    })
  })

  test('empty when no content', () => {
    expect(parseTabsContextResult({})).toEqual({})
    expect(parseTabsContextResult({ result: { content: 'nope' } })).toEqual({})
  })
})

describe('isTabsCloseSuccess densable SNS', () => {
  test('success when result.isError is not true', () => {
    expect(isTabsCloseSuccess({ result: {} })).toBe(true)
    expect(isTabsCloseSuccess({ result: { isError: false } })).toBe(true)
    expect(isTabsCloseSuccess({ result: { isError: true } })).toBe(false)
    expect(isTabsCloseSuccess(null)).toBe(false)
  })
})

describe('closeSessionTabGroup densable jrl/ENS', () => {
  test('remote session is disabled', async () => {
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'remote-1'
    const client = mockClient({
      tabs: [{ tabId: 1, url: 'chrome://newtab/' }],
    })
    await expect(
      closeSessionTabGroup({
        sessionId: 's1',
        clientOverride: client,
      }),
    ).resolves.toEqual({ status: 'disabled' })
    expect(client.closed).toEqual([])
  })

  test('not_connected when client is down', async () => {
    const client = mockClient({
      tabs: [{ tabId: 1, url: 'chrome://newtab/' }],
      connected: false,
    })
    await expect(
      closeSessionTabGroup({
        sessionId: 's1',
        clientOverride: client,
      }),
    ).resolves.toEqual({ status: 'not_connected' })
  })

  test('onlyIfEmpty keeps a group with content', async () => {
    const client = mockClient({
      tabs: [{ tabId: 1, url: 'https://docs.anthropic.com' }],
    })
    await expect(
      closeSessionTabGroup({
        sessionId: 's1',
        onlyIfEmpty: true,
        clientOverride: client,
      }),
    ).resolves.toEqual({ status: 'kept', tabs: 1 })
    expect(client.closed).toEqual([])
  })

  test('onlyIfEmpty closes chrome://newtab/ and about:blank', async () => {
    const client = mockClient({
      tabs: [
        { tabId: 2, url: 'about:blank' },
        { tabId: 1, url: 'chrome://newtab/' },
      ],
    })
    await expect(
      closeSessionTabGroup({
        sessionId: 's1',
        onlyIfEmpty: true,
        clientOverride: client,
      }),
    ).resolves.toEqual({ status: 'closed', closed: 2, failed: 0 })
    expect(client.closed).toEqual([1, 2])
  })

  test('human /clear closes content tabs last-to-first', async () => {
    const client = mockClient({
      tabs: [
        { tabId: 10, url: 'https://a.example' },
        { tabId: 11, url: 'https://b.example' },
      ],
    })
    await expect(
      closeSessionTabGroup({
        sessionId: 's1',
        onlyIfEmpty: false,
        clientOverride: client,
      }),
    ).resolves.toEqual({ status: 'closed', closed: 2, failed: 0 })
    expect(client.closed).toEqual([11, 10])
  })

  test('stops at the first failed close', async () => {
    const client = mockClient({
      tabs: [
        { tabId: 1, url: 'https://a.example' },
        { tabId: 2, url: 'https://b.example' },
      ],
      close: tabId => (tabId === 2 ? { result: { isError: true } } : closeOk()),
    })
    await expect(
      closeSessionTabGroup({
        sessionId: 's1',
        onlyIfEmpty: false,
        clientOverride: client,
      }),
    ).resolves.toEqual({ status: 'closed', closed: 0, failed: 1 })
    expect(client.closed).toEqual([2])
  })

  test('over-cap keeps the group', async () => {
    const tabs = Array.from(
      { length: CHROME_TAB_GROUP_CLOSE_CAP + 1 },
      (_, i) => ({
        tabId: i + 1,
        url: 'chrome://newtab/',
      }),
    )
    const client = mockClient({ tabs })
    await expect(
      closeSessionTabGroup({
        sessionId: 's1',
        onlyIfEmpty: false,
        clientOverride: client,
      }),
    ).resolves.toEqual({ status: 'kept', tabs: tabs.length })
    expect(client.closed).toEqual([])
  })
})

describe('official call sites', () => {
  const root = join(import.meta.dir, '../../../..')

  test('/clear WGw captures session id then closeSessionTabGroup', () => {
    const src = readFileSync(join(root, 'src/commands/clear/clear.ts'), 'utf8')
    expect(src).toContain('const sessionId = getSessionId()')
    expect(src).toContain('await clearConversation(context)')
    expect(src).toContain('onlyIfEmpty: !forceClose')
    expect(src).toContain('closeSessionTabGroup')
  })

  test('slash local call threads submissionOrigin', () => {
    const src = readFileSync(
      join(root, 'src/utils/processUserInput/processSlashCommand.tsx'),
      'utf8',
    )
    expect(src).toContain('submissionOrigin')
    expect(src).toContain('...context,')
  })

  test('in-process Chrome MCP sets binding then ANS', () => {
    const src = readFileSync(join(root, 'src/services/mcp/client.ts'), 'utf8')
    expect(src).toContain('createChromeSocketClient')
    expect(src).toContain('setChromeBinding(context, socketClient)')
    expect(src).toContain('registerChromeTabGroupCleanup()')
    expect(src).toContain(
      'createClaudeForChromeMcpServer(context, socketClient)',
    )
  })
})
