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
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
const events: Array<[string, Record<string, unknown>]> = []
let popAnalyticsLogEvent: (() => void) | undefined
mock.module('src/services/analytics/index.js', analyticsMock)

import * as realApproval from '../../../services/mcpServerApproval.js'

const approvalSnap = snapshotModuleExports(realApproval)
let pendingServers: string[] = []
let skipNotice: { key: string; text: string } | undefined

mock.module('src/services/mcpServerApproval.js', () => ({
  ...approvalSnap,
  collectPendingMcpApprovalsForCd: async () => ({
    pendingServers,
    pluginServerNames: new Set<string>(),
    skipNotice,
  }),
}))

beforeAll(() => {
  popAnalyticsLogEvent = pushAnalyticsLogEvent((name, meta) => {
    events.push([name, (meta ?? {}) as Record<string, unknown>])
  })
})

afterAll(() => {
  popAnalyticsLogEvent?.()
  mock.module('src/services/mcpServerApproval.js', () => ({
    ...approvalSnap,
  }))
})

const { acceptTrustForDirectory, call, isDirectoryTrusted, resolveCdTarget } =
  await import('../cdCommand.js')
const { CdPendingMcpApproval } = await import(
  '../../../services/mcpServerApproval.js'
)
const { CdUntrustedMoveFlow } = await import('../CdUntrustedMoveFlow.js')
const {
  getSessionId,
  getSessionProjectDir,
  setCwdState,
  setOriginalCwd,
  switchSession,
} = await import('../../../bootstrap/state.js')
const { getProjectPathForConfig } = await import('../../../utils/config.js')

const temps: string[] = []
const suiteCwd = process.cwd()
// relocateSessionCwd leaves sessionProjectDir on temp paths — restore like cdCommand.218.
const suiteSessionId = getSessionId()
const suiteSessionProjectDir = getSessionProjectDir()

afterEach(() => {
  pendingServers = []
  skipNotice = undefined
  events.length = 0
  try {
    process.chdir(suiteCwd)
  } catch {
    // ignore
  }
  setCwdState(suiteCwd)
  setOriginalCwd(suiteCwd)
  switchSession(suiteSessionId, suiteSessionProjectDir)
  // relocateSessionCwd memoizes the config key — clear so later suites
  // (headersHelper) do not write trust under a stale temp path.
  getProjectPathForConfig.cache?.clear?.()
})

function makeContext(opts?: { strictMcpConfig?: boolean }) {
  return {
    getAppState: () => ({
      toolPermissionContext: getEmptyToolPermissionContext(),
    }),
    reloadPlugins: async () => {},
    strictMcpConfig: opts?.strictMcpConfig,
  } as Parameters<typeof call>[1]
}

async function trustResolved(path: string): Promise<string> {
  const resolved = await resolveCdTarget(path)
  if (resolved.result !== 'ok') {
    throw new Error(`expected ok, got ${resolved.result}`)
  }
  acceptTrustForDirectory(resolved.directory)
  expect(isDirectoryTrusted(resolved.directory)).toBe(true)
  return resolved.directory
}

describe('densable 2.1.246 /cd MCP V', () => {
  test('trusted move with pending project servers returns V', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-246-v-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-246-v-b-'))
    temps.push(a, b)
    setCwdState(a)
    setOriginalCwd(a)
    process.chdir(a)
    const dest = await trustResolved(b)
    pendingServers = ['cd-246-v']
    const messages: string[] = []
    const node = await call(
      msg => {
        if (msg !== undefined) messages.push(msg)
      },
      makeContext(),
      dest,
    )
    expect(node).toEqual(
      expect.objectContaining({ type: CdPendingMcpApproval }),
    )
    expect(messages).toEqual([])
  })

  test('trusted move with settings-error skipNotice appends the us doctor sentence', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-246-skip-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-246-skip-b-'))
    temps.push(a, b)
    setCwdState(a)
    setOriginalCwd(a)
    process.chdir(a)
    const dest = await trustResolved(b)
    pendingServers = []
    skipNotice = {
      key: 'mcp-approval-skipped',
      text: 'skipping .mcp.json server approval (settings errors in settings.json) · run `claude doctor` to list them, fix them, then restart',
    }
    const messages: string[] = []
    const node = await call(
      msg => {
        if (msg !== undefined) messages.push(msg)
      },
      makeContext(),
      dest,
    )
    expect(node).toBeNull()
    expect(messages[0]).toContain('Moved to')
    expect(messages[0]).toContain('skipping .mcp.json server approval')
    expect(messages[0]).toContain('settings.json')
    expect(messages[0]).toContain('claude doctor')
    expect(events.some(([name]) => name === 'tengu_feature_ok')).toBe(false)
    expect(events.some(([name]) => name === 'tengu_feature_bad')).toBe(false)
  })

  test('trusted move with no pending servers finishes immediately', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-246-empty-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-246-empty-b-'))
    temps.push(a, b)
    setCwdState(a)
    setOriginalCwd(a)
    process.chdir(a)
    const dest = await trustResolved(b)
    pendingServers = []
    const messages: string[] = []
    const node = await call(
      msg => {
        if (msg !== undefined) messages.push(msg)
      },
      makeContext(),
      dest,
    )
    expect(node).toBeNull()
    expect(messages[0]).toContain('Moved to')
    expect(messages[0]).not.toContain('could not be saved')
    expect(events.some(([name]) => name === 'tengu_feature_ok')).toBe(false)
    expect(events.some(([name]) => name === 'tengu_feature_bad')).toBe(false)
  })

  test('V persistFailed appends the save-failed sentence and logs feature_bad', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-246-pf-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-246-pf-b-'))
    temps.push(a, b)
    setCwdState(a)
    setOriginalCwd(a)
    process.chdir(a)
    const dest = await trustResolved(b)
    pendingServers = ['cd-246-pf']
    let resolveDone!: (msg: string) => void
    const done = new Promise<string>(r => {
      resolveDone = r
    })
    const node = await call(
      msg => {
        if (msg !== undefined) resolveDone(msg)
      },
      makeContext(),
      dest,
    )
    expect(node).toEqual(
      expect.objectContaining({ type: CdPendingMcpApproval }),
    )
    const el = node as {
      props: { onComplete: (r: { persistFailed: boolean }) => void }
    }
    el.props.onComplete({ persistFailed: true })
    const msg = await done
    expect(msg).toContain('Moved to')
    expect(msg).toContain(
      'One or more of your MCP server choices could not be saved',
    )
    expect(msg).toContain('.claude/settings.local.json')
    expect(msg).toContain('next time')
    expect(events).toContainEqual([
      'tengu_feature_bad',
      {
        feature_name: 'mcp_project_approval_dialog',
        error_code: 'mcp_approval_persist_failed',
      },
    ])
  })

  test('V persist success logs feature_ok without the save-failed sentence', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-246-ok-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-246-ok-b-'))
    temps.push(a, b)
    setCwdState(a)
    setOriginalCwd(a)
    process.chdir(a)
    const dest = await trustResolved(b)
    pendingServers = ['cd-246-ok']
    let resolveDone!: (msg: string) => void
    const done = new Promise<string>(r => {
      resolveDone = r
    })
    const node = await call(
      msg => {
        if (msg !== undefined) resolveDone(msg)
      },
      makeContext(),
      dest,
    )
    const el = node as {
      props: { onComplete: (r: { persistFailed: boolean }) => void }
    }
    el.props.onComplete({ persistFailed: false })
    const msg = await done
    expect(msg).toContain('Moved to')
    expect(msg).not.toContain('could not be saved')
    expect(events).toContainEqual([
      'tengu_feature_ok',
      { feature_name: 'mcp_project_approval_dialog' },
    ])
  })

  test('untrusted target returns CdUntrustedMoveFlow', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-246-lo-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-246-lo-b-'))
    temps.push(a, b)
    setCwdState(a)
    setOriginalCwd(a)
    process.chdir(a)
    const node = await call(() => {}, makeContext(), b)
    expect(node).toEqual(expect.objectContaining({ type: CdUntrustedMoveFlow }))
  })

  test('trusted parent + gated child grants returns ae backstop', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'cd-246-ae-p-'))
    const child = join(parent, 'nested')
    mkdirSync(child)
    mkdirSync(join(child, '.claude'), { recursive: true })
    writeFileSync(
      join(child, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(echo *)'] } }),
    )
    temps.push(parent)
    setCwdState(parent)
    setOriginalCwd(parent)
    process.chdir(parent)
    acceptTrustForDirectory(parent)
    expect(isDirectoryTrusted(child)).toBe(true)
    pendingServers = []
    const node = await call(() => {}, makeContext(), child)
    expect(node).toEqual(expect.objectContaining({ type: CdUntrustedMoveFlow }))
  })
})
