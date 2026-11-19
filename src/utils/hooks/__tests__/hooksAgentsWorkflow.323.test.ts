import { afterEach, describe, expect, test } from 'bun:test'
import { formatSubagentSafeguardsGuidance } from '@claude-code/builtin-tools/tools/AgentTool/agentToolUtils.js'
import { convertHtmlToMarkdown } from '@claude-code/builtin-tools/tools/WebFetchTool/utils.js'
import {
  AGENT_SUMMARY_REQUEST_TIMEOUT_MS,
  isAgentProgressSummariesDisabled,
} from '../../../services/AgentSummary/agentSummary.js'
import { upsertPublishedFrameRow } from '../../../services/artifactAutoReact/conversationBoundary.js'
import { ARTIFACT_ASSET_CONTENT_TYPES } from '../../../services/artifactAutoReact/outDirPaths.js'
import { isPostToolUseOutputRewriteProtected } from '../../../services/tools/toolHooks.js'
import {
  isBrowserMcpToolName,
  validateBrowserToolInput,
} from '../../claudeInChrome/chromeCallPermission.js'
import {
  MACOS_SYSTEM_KEY_COMBOS,
  assertSafeKeyChord,
} from '../../computerUse/keyChordSafety.js'
import {
  classifyTeammateMailboxEntries,
  generateTeamLeadKeyPair,
  resetTeamLeadVerificationOnSessionBoundary,
  signTeamLeadMailboxEntry,
} from '../../teammateMailbox.js'
import {
  DEFAULT_HOOK_HEARTBEAT_INTERVAL_MS,
  HookProgressHeartbeat,
  setHookHeartbeatTurn,
} from '../hookHeartbeat.js'

describe('Wave 323 Group 3: Hooks, Artifacts, Agents, WebFetch, Chrome, ComputerUse', () => {
  afterEach(() => {
    delete process.env.CLAUDE_CODE_DISABLE_AGENT_PROGRESS_SUMMARIES
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    delete process.env.CLAUDE_CODE_RESTRICT_PERSONAL_CONFIG
    setHookHeartbeatTurn(0)
  })

  test('#1970: hook heartbeat defaults to 30s and emits tool_progress heartbeat frames', async () => {
    expect(DEFAULT_HOOK_HEARTBEAT_INTERVAL_MS).toBe(30_000)
    setHookHeartbeatTurn(7)
    const events: unknown[] = []
    const hb = new HookProgressHeartbeat(
      'PreToolUse',
      'toolu_1',
      7,
      undefined,
      1000,
      ev => events.push(ev),
      15,
    )
    await new Promise(resolve => setTimeout(resolve, 45))
    hb.stop()
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect((events[0] as { heartbeat: boolean }).heartbeat).toBe(true)
  })

  test('#1971: Artifact asset content types include .docx', () => {
    expect(ARTIFACT_ASSET_CONTENT_TYPES.get('.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  })

  test('#1976 & #2082: CLAUDE_CODE_DISABLE_AGENT_PROGRESS_SUMMARIES=1 disables summaries and timeout is 20s', () => {
    expect(AGENT_SUMMARY_REQUEST_TIMEOUT_MS).toBe(20_000)
    expect(isAgentProgressSummariesDisabled()).toBe(false)
    process.env.CLAUDE_CODE_DISABLE_AGENT_PROGRESS_SUMMARIES = '1'
    expect(isAgentProgressSummariesDisabled()).toBe(true)
  })

  test('#2056 & #2157: WebFetch preserves empty table cells and handles deeply nested HTML cleanly', async () => {
    const md = await convertHtmlToMarkdown(
      '<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead><tbody><tr><td>1</td><td></td><td>3</td></tr></tbody></table>',
    )
    expect(md).toContain('| 1 |  | 3 |')

    const nested = '<ul>'.repeat(20) + '<li>deep</li>' + '</ul>'.repeat(20)
    const nestedMd = await convertHtmlToMarkdown(nested)
    expect(nestedMd).toContain('deep')
  })

  test('#2071: upsertPublishedFrameRow moves republished slug to the end so latest preview opens', () => {
    const updated = upsertPublishedFrameRow(
      {
        'attached:first': {
          url: 'https://claude.ai/a/first',
          updatedAt: 10,
        },
        'attached:second': {
          url: 'https://claude.ai/a/second',
          updatedAt: 20,
        },
      },
      {
        slug: 'first',
        url: 'https://claude.ai/a/first',
      },
    )
    expect(Object.keys(updated)).toEqual(['attached:second', 'attached:first'])
  })

  test('#2079: safeguards guidance omits auto-switch notice when model has no fallback target', () => {
    const msg = formatSubagentSafeguardsGuidance(
      {
        type: 'assistant',
        message: {
          model: 'claude-3-5-haiku-20241022',
          stop_reason: 'refusal',
          content: [],
        },
      } as never,
      false,
    )
    expect(msg).not.toContain('automatic model switching is off')
  })

  test('#2195: teammate mailbox verifies Ed25519 lead signature, refuses outlived lead and post-clear plan approvals', () => {
    const keys = generateTeamLeadKeyPair()
    resetTeamLeadVerificationOnSessionBoundary(Date.now() - 5000)

    const signed = signTeamLeadMailboxEntry(
      {
        from: 'team-lead',
        text: JSON.stringify({
          type: 'plan_approval_response',
          approved: true,
        }),
        timestamp: new Date().toISOString(),
        read: false,
      },
      keys.privateKeyPem,
      'msg-1',
    )
    const liveResult = classifyTeammateMailboxEntries([signed], {
      leadVerifyKey: keys.publicKeyBase64,
      leadAlive: true,
    })
    expect(liveResult.get(signed)).toBe('verified')

    // Outlived lead -> forged
    const deadSigned = signTeamLeadMailboxEntry(
      {
        from: 'team-lead',
        text: 'do work',
        timestamp: new Date().toISOString(),
        read: false,
      },
      keys.privateKeyPem,
      'msg-2',
    )
    const deadResult = classifyTeammateMailboxEntries([deadSigned], {
      leadVerifyKey: keys.publicKeyBase64,
      leadAlive: false,
    })
    expect(deadResult.get(deadSigned)).toBe('forged')

    // Session boundary (/clear or /resume) -> stale timestamp plan approval refused
    const beforeBoundary = new Date(Date.now() - 10_000).toISOString()
    resetTeamLeadVerificationOnSessionBoundary(Date.now())
    const stalePlan = signTeamLeadMailboxEntry(
      {
        from: 'team-lead',
        text: JSON.stringify({
          type: 'plan_approval_response',
          approved: true,
        }),
        timestamp: beforeBoundary,
        read: false,
      },
      keys.privateKeyPem,
      'msg-3',
    )
    const staleResult = classifyTeammateMailboxEntries([stalePlan], {
      leadVerifyKey: keys.publicKeyBase64,
      leadAlive: true,
    })
    expect(staleResult.get(stalePlan)).toBe('forged')
  })

  test('#2198: browser MCP tool validator refuses JSON-text and escaped control inputs with respelling guidance', () => {
    expect(isBrowserMcpToolName('mcp__claude-in-chrome__javascript_tool')).toBe(
      true,
    )
    expect(isBrowserMcpToolName('Bash')).toBe(false)

    const jsonTextRes = validateBrowserToolInput(
      { name: 'mcp__claude-in-chrome__computer' },
      { actions: '[{"action":"click"}]' },
    )
    expect(jsonTextRes?.errorCode).toBe('BROWSER_INPUT_JSON_TEXT')

    const escapeRes = validateBrowserToolInput(
      { name: 'mcp__claude-in-chrome__navigate' },
      { url: 'https://exam\\u0070le.com' },
    )
    expect(escapeRes?.errorCode).toBe('BROWSER_INPUT_ESCAPE')

    const okRes = validateBrowserToolInput(
      { name: 'mcp__claude-in-chrome__navigate' },
      { url: 'https://example.com' },
    )
    expect(okRes).toBeNull()
  })

  test('#2200: macOS computer use refuses Control/Option+Space and expanded system shortcuts', () => {
    expect(MACOS_SYSTEM_KEY_COMBOS.has('ctrl+f2')).toBe(true)
    expect(MACOS_SYSTEM_KEY_COMBOS.has('ctrl+meta+q')).toBe(true)
    expect(() =>
      assertSafeKeyChord(['ctrl', 'space'], 'Key chord', {
        platform: 'darwin',
        allowSystemKeyCombos: true,
      }),
    ).toThrow(/Space/i)
    expect(() =>
      assertSafeKeyChord(['ctrl', 'f2'], 'Key chord', {
        platform: 'darwin',
        allowSystemKeyCombos: false,
      }),
    ).toThrow()
  })

  test('#2208: protects ExitPlanMode output from PostToolUse rewrite in cloud scheduled tasks', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'remote_trigger'
    expect(
      isPostToolUseOutputRewriteProtected({ name: 'ExitPlanMode' } as never),
    ).toBe(true)
    expect(isPostToolUseOutputRewriteProtected({ name: 'Bash' } as never)).toBe(
      false,
    )
  })
})
