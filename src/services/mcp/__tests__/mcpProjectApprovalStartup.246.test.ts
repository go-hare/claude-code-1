import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'

import {
  analyticsMock,
  pushAnalyticsLogEvent,
} from '../../../../tests/mocks/analytics.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import * as realLatch from '../../../utils/permissions/projectGrantsGate.js'
import * as realHte from '../../../utils/settings/localSettingsGitTracked.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

const latchSnap = snapshotModuleExports(realLatch)
const hteSnap = snapshotModuleExports(realHte)

const events: Array<[string, Record<string, unknown>]> = []
let popAnalyticsLogEvent: (() => void) | undefined
let latched = true
let tracked = false

mock.module('src/services/analytics/index.js', analyticsMock)

mock.module('src/utils/permissions/projectGrantsGate.js', () => ({
  ...latchSnap,
  isCurrentProjectTrustLatched: () => latched,
}))

mock.module('src/utils/settings/localSettingsGitTracked.js', () => ({
  ...hteSnap,
  isLocalSettingsGitTracked: () => tracked,
}))

beforeAll(() => {
  popAnalyticsLogEvent = pushAnalyticsLogEvent((name, meta) => {
    events.push([name, (meta ?? {}) as Record<string, unknown>])
  })
})

afterAll(() => {
  popAnalyticsLogEvent?.()
  mock.module('src/utils/permissions/projectGrantsGate.js', () => ({
    ...latchSnap,
  }))
  mock.module('src/utils/settings/localSettingsGitTracked.js', () => ({
    ...hteSnap,
  }))
  mock.module('src/services/analytics/index.js', analyticsMock)
})

const { getProjectPathForConfig } = await import('../../../utils/config.js')
const {
  finishMcpProjectApprovalStartup,
  handleMcpjsonServerApprovals,
  mcpProjectApprovalSkippedNotice,
} = await import('../../mcpServerApproval.js')
const {
  approveSessionMcpServers,
  getSessionApprovedMcpServers,
  getSessionRejectedMcpServers,
  rejectSessionMcpServers,
  resetSessionApprovedMcpServersForTests,
} = await import('../mcpSessionApprovedServers.js')

afterEach(() => {
  events.length = 0
  latched = true
  tracked = false
  resetSessionApprovedMcpServersForTests()
})

describe('densable 2.1.246 us() startup MCP approval', () => {
  test('persistFailed wins with next-startup · banner and tengu_feature_bad', () => {
    const warning = finishMcpProjectApprovalStartup({ persistFailed: true })
    expect(warning).toEqual({
      key: 'mcp-approval-persist-failed',
      text: 'one or more of your MCP server choices could not be saved (check permissions on .claude/settings.local.json) · you will be asked again next startup',
    })
    expect(events).toContainEqual([
      'tengu_feature_bad',
      {
        feature_name: 'mcp_project_approval_dialog',
        error_code: 'mcp_approval_persist_failed',
      },
    ])
  })

  test('gated when session approved + !se + Hte tracked', () => {
    approveSessionMcpServers(getProjectPathForConfig(), ['gated-srv'])
    latched = false
    tracked = true
    const warning = finishMcpProjectApprovalStartup({ persistFailed: false })
    expect(warning).toEqual({
      key: 'mcp-approval-persist-gated',
      text: 'your MCP server choices apply to this session only (workspace not explicitly trusted; .claude/settings.local.json is gated) · to persist, add them to enabledMcpjsonServers in ~/.claude/settings.json',
    })
    expect(events).toContainEqual([
      'tengu_feature_sad',
      {
        feature_name: 'mcp_project_approval_dialog',
        error_code: 'mcp_approval_persist_gated',
      },
    ])
  })

  test('trusted workspace logs feature_ok and no banner', () => {
    approveSessionMcpServers(getProjectPathForConfig(), ['ok-srv'])
    latched = true
    tracked = true
    expect(finishMcpProjectApprovalStartup({ persistFailed: false })).toBeNull()
    expect(events).toContainEqual([
      'tengu_feature_ok',
      { feature_name: 'mcp_project_approval_dialog' },
    ])
  })

  test('skipped notice uniq files + doctor restart sentence', () => {
    const warning = mcpProjectApprovalSkippedNotice([
      { file: 'a.json' },
      { file: 'a.json' },
      { file: 'b.json' },
    ])
    expect(warning.key).toBe('mcp-approval-skipped')
    expect(warning.text).toBe(
      'skipping .mcp.json server approval (settings errors in a.json, b.json) · run `claude doctor` to list them, fix them, then restart',
    )
    expect(events).toContainEqual([
      'tengu_feature_sad',
      {
        feature_name: 'mcp_project_approval_dialog',
        error_code: 'mcp_project_approval_skipped_settings_errors',
      },
    ])
  })

  test('skipped notice without file names keeps the settings-errors clause', () => {
    const warning = mcpProjectApprovalSkippedNotice([{}])
    expect(warning.text).toBe(
      'skipping .mcp.json server approval (settings errors) · run `claude doctor` to list them, fix them, then restart',
    )
  })

  test('approveServers dedups name+workspaceKey', () => {
    const key = getProjectPathForConfig()
    approveSessionMcpServers(key, ['alpha', 'alpha'])
    approveSessionMcpServers(key, ['alpha', 'beta'])
    approveSessionMcpServers('other-ws', ['alpha'])
    expect(getSessionApprovedMcpServers()).toEqual([
      { name: 'alpha', workspaceKey: key },
      { name: 'beta', workspaceKey: key },
      { name: 'alpha', workspaceKey: 'other-ws' },
    ])
  })

  test('rejectServers dedups and is workspace-keyed', () => {
    const key = getProjectPathForConfig()
    rejectSessionMcpServers(key, ['alpha', 'alpha'])
    rejectSessionMcpServers(key, ['alpha', 'beta'])
    rejectSessionMcpServers('other-ws', ['alpha'])
    expect(getSessionRejectedMcpServers()).toEqual([
      { name: 'alpha', workspaceKey: key },
      { name: 'beta', workspaceKey: key },
      { name: 'alpha', workspaceKey: 'other-ws' },
    ])
  })

  test('approval dialogs record session reject on no / Esc', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const single = readFileSync(
      join(import.meta.dir, '../../../components/MCPServerApprovalDialog.tsx'),
      'utf8',
    )
    const multi = readFileSync(
      join(
        import.meta.dir,
        '../../../components/MCPServerMultiselectDialog.tsx',
      ),
      'utf8',
    )
    expect(single).toContain(
      'rejectSessionMcpServers(getProjectPathForConfig(), [serverName])',
    )
    expect(multi).toContain(
      'rejectSessionMcpServers(getProjectPathForConfig(), rejectedServers)',
    )
    expect(multi).toContain(
      'rejectSessionMcpServers(getProjectPathForConfig(), serverNames)',
    )
  })

  test('strict-mcp-config still skips the dialog and returns null', async () => {
    const root = {
      render() {
        throw new Error('strict-mcp-config must not open MCP approval')
      },
    }
    await expect(
      handleMcpjsonServerApprovals(root as never, { strictMcpConfig: true }),
    ).resolves.toBeNull()
  })

  test('qs reattach early return still calls us()', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const qs = readFileSync(
      join(import.meta.dir, '../../../interactiveHelpers.tsx'),
      'utf8',
    )
    const reattachIdx = qs.indexOf(
      'if (isBgSession() || process.env.CLAUDE_BRIDGE_REATTACH_SESSION)',
    )
    const usIdx = qs.indexOf('handleMcpjsonServerApprovals', reattachIdx)
    expect(reattachIdx).toBeGreaterThan(-1)
    expect(usIdx).toBeGreaterThan(reattachIdx)
    expect(
      qs.indexOf('return setupScreensResult(false, mcpApprovalSkipWarning)'),
    ).toBeGreaterThan(usIdx)
  })
})
