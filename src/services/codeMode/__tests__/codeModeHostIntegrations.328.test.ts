import { afterEach, describe, expect, test } from 'bun:test'
import {
  resetCodeModeOptInStateForTests,
  setCodeModeAccepted,
  settleCodeModeOptIn,
} from '../optIn.js'
import {
  buildCodeModeMcpStatusDelta,
  buildLeanSimpleSystemPrompt,
  CODE_MODE_STATIC_MCP_GUIDANCE,
} from '../../../utils/simpleSystemPrompt.js'
import { isReplStreamingPreviewEnabled } from '../../../utils/streamingToolJsonPreview.js'
import { shouldEnableClaudeInChrome } from '../../../utils/claudeInChrome/setup.js'
import { getChicagoEnabled } from '../../../utils/computerUse/gates.js'
import {
  to1PEventFormat,
  type EventMetadata,
} from '../../analytics/metadata.js'

function enableCodeModeForTest(): void {
  setCodeModeAccepted(true)
  settleCodeModeOptIn({ state: 'on', source: 'shell' })
}

afterEach(() => {
  resetCodeModeOptInStateForTests()
})

describe('Code Mode host integrations (2.1.328)', () => {
  test('CODE_MODE_STATIC_MCP_GUIDANCE and delta omit nonexistent WaitForMcpServers', () => {
    expect(CODE_MODE_STATIC_MCP_GUIDANCE).not.toContain('WaitForMcpServers')
    expect(CODE_MODE_STATIC_MCP_GUIDANCE).toContain('searchTools')

    const delta = buildCodeModeMcpStatusDelta({
      pendingServers: ['github'],
      addedServers: ['slack'],
      removedServers: ['jira'],
    })
    expect(delta).not.toBeNull()
    expect(delta).not.toContain('WaitForMcpServers')
    expect(delta).toContain('github')
    expect(delta).toContain('searchTools')
    expect(delta).toContain('slack')
    expect(delta).toContain('jira')
  })

  test('buildLeanSimpleSystemPrompt defaults codeModeActive from isCodeModeEnabled()', () => {
    const offPrompt = buildLeanSimpleSystemPrompt({
      cyberRiskInstruction: 'Be safe.',
    })
    expect(offPrompt).not.toContain(CODE_MODE_STATIC_MCP_GUIDANCE)

    enableCodeModeForTest()
    const onPrompt = buildLeanSimpleSystemPrompt({
      cyberRiskInstruction: 'Be safe.',
    })
    expect(onPrompt).toContain(CODE_MODE_STATIC_MCP_GUIDANCE)
  })

  test('isReplStreamingPreviewEnabled honors Code Mode when CLAUDE_REPL_VERBOSE is set', () => {
    expect(isReplStreamingPreviewEnabled({ CLAUDE_REPL_VERBOSE: '1' })).toBe(
      false,
    )

    enableCodeModeForTest()
    expect(isReplStreamingPreviewEnabled({ CLAUDE_REPL_VERBOSE: '1' })).toBe(
      true,
    )
    expect(isReplStreamingPreviewEnabled({ CLAUDE_REPL_VERBOSE: '0' })).toBe(
      false,
    )
  })

  test('Chrome and Computer Use are disabled when Code Mode is active', () => {
    enableCodeModeForTest()
    expect(shouldEnableClaudeInChrome(true)).toBe(false)
    expect(getChicagoEnabled()).toBe(false)
  })

  test('to1PEventFormat merges codeModeTelemetryFields into additional metadata', () => {
    enableCodeModeForTest()

    const fakeMetadata: EventMetadata = {
      model: 'claude-sonnet-4-6',
      sessionId: 'sess-1',
      userType: 'external',
      envContext: {
        platform: 'darwin',
        platformRaw: 'darwin',
        arch: 'arm64',
        nodeVersion: '22.0.0',
        terminal: 'ghostty',
        packageManagers: '',
        runtimes: '',
        isRunningWithBun: true,
        isCi: false,
        isClaubbit: false,
        isClaudeCodeRemote: false,
        isLocalAgentMode: false,
        isConductor: false,
        isGithubAction: false,
        isClaudeCodeAction: false,
        isClaudeAiAuth: false,
        version: '2.1.328',
        buildTime: '',
        deploymentEnvironment: '',
      },
      isInteractive: 'true',
      clientType: 'cli',
      sweBenchRunId: '',
      sweBenchInstanceId: '',
      sweBenchTaskId: '',
    }

    const formatted = to1PEventFormat(fakeMetadata, {
      deviceId: 'test-device',
      sessionId: 'test-session',
      appVersion: '2.1.328',
      platform: 'darwin',
    })
    expect(formatted.additional.is_repl_mode).toBe(true)
    expect(formatted.additional.repl_mode_decision).toBe('opt_in_shell')
  })
})
