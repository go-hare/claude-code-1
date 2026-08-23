/**
 * densable 2.1.238 MCP headersHelper — trust gate (#38) + clean env (#39).
 *
 * Do not mock marketplaceHeadersHelper (scrub implementation under test).
 * Do not mock src/services/mcp/headersHelper.ts itself.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { logMock } from '../../../../tests/mocks/log.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import * as realExec from '../../../utils/execFileNoThrow.js'

const execSnap = snapshotModuleExports(realExec)

const execMock = mock(
  async (
    _file: string,
    _args: string[],
    _opts?: Record<string, unknown>,
  ): Promise<{ stdout: string; stderr: string; code: number }> => ({
    stdout: '{"Authorization":"Bearer minted"}',
    stderr: '',
    code: 0,
  }),
)

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/execFileNoThrow.ts', () => ({
  ...execSnap,
  execFileNoThrow: execMock,
  execFileNoThrowWithCwd: execMock,
}))
mock.module('src/utils/execFileNoThrow.js', () => ({
  ...execSnap,
  execFileNoThrow: execMock,
  execFileNoThrowWithCwd: execMock,
}))

import {
  getGlobalConfig,
  getProjectPathForConfig,
  saveGlobalConfig,
} from '../../../utils/config.js'

const originalProjects = structuredClone(getGlobalConfig().projects ?? {})

afterAll(() => {
  saveGlobalConfig(current => ({
    ...current,
    projects: originalProjects,
  }))
  mock.module('src/utils/execFileNoThrow.ts', () => ({ ...execSnap }))
  mock.module('src/utils/execFileNoThrow.js', () => ({ ...execSnap }))
})
import {
  formatMcpHeadersHelperMissingTrustMessage,
  getMcpHeadersFromHelper,
  isRepoResidentMcpHeadersHelper,
  shouldScrubMcpHeadersHelperEnv,
  type McpRemoteHeadersConfig,
} from '../headersHelper.js'
import type { ConfigScope } from '../types.js'

type HttpHelperConfig = McpRemoteHeadersConfig & {
  scope: ConfigScope
  pluginSource?: string
  pluginPath?: string
  agentSource?: string
  declaredIn?: string
}

function httpConfig(
  scope: ConfigScope,
  extra: Partial<HttpHelperConfig> = {},
): HttpHelperConfig {
  return {
    type: 'http',
    url: 'https://example.com/mcp',
    headersHelper: 'mint-headers',
    scope,
    ...extra,
  }
}

function setPersistedTrust(accepted: boolean): void {
  const key = getProjectPathForConfig()
  saveGlobalConfig(current => ({
    ...current,
    projects: {
      ...current.projects,
      [key]: {
        allowedTools: current.projects?.[key]?.allowedTools ?? [],
        mcpContextUris: current.projects?.[key]?.mcpContextUris ?? [],
        projectOnboardingSeenCount:
          current.projects?.[key]?.projectOnboardingSeenCount ?? 0,
        hasCompletedProjectOnboarding:
          current.projects?.[key]?.hasCompletedProjectOnboarding ?? false,
        ...current.projects?.[key],
        hasTrustDialogAccepted: accepted,
      },
    },
  }))
}

describe('MCP headersHelper densable 2.1.238', () => {
  const prevKey = process.env.ANTHROPIC_API_KEY
  const prevPlugin = process.env.CLAUDE_PLUGIN_ROOT

  beforeEach(() => {
    execMock.mockClear()
    execMock.mockImplementation(async () => ({
      stdout: '{"Authorization":"Bearer minted"}',
      stderr: '',
      code: 0,
    }))
    process.env.ANTHROPIC_API_KEY = 'sk-secret-value'
    delete process.env.CLAUDE_PLUGIN_ROOT
    setPersistedTrust(false)
  })

  afterEach(() => {
    setPersistedTrust(false)
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = prevKey
    if (prevPlugin === undefined) delete process.env.CLAUDE_PLUGIN_ROOT
    else process.env.CLAUDE_PLUGIN_ROOT = prevPlugin
  })

  test('repo-resident: project/local OR repo agentSource; not bare dynamic', () => {
    expect(isRepoResidentMcpHeadersHelper(httpConfig('project'))).toBe(true)
    expect(isRepoResidentMcpHeadersHelper(httpConfig('local'))).toBe(true)
    expect(isRepoResidentMcpHeadersHelper(httpConfig('dynamic'))).toBe(false)
    expect(
      isRepoResidentMcpHeadersHelper(
        httpConfig('dynamic', { pluginSource: 'demo@marketplace' }),
      ),
    ).toBe(false)
    expect(
      isRepoResidentMcpHeadersHelper(
        httpConfig('dynamic', { agentSource: 'projectSettings' }),
      ),
    ).toBe(true)
    expect(isRepoResidentMcpHeadersHelper(httpConfig('user'))).toBe(false)
    expect(isRepoResidentMcpHeadersHelper(httpConfig('enterprise'))).toBe(false)
  })

  test('scrub: project / absolute pluginPath / non-operator agentSource; not local', () => {
    expect(shouldScrubMcpHeadersHelperEnv(httpConfig('project'))).toBe(true)
    expect(shouldScrubMcpHeadersHelperEnv(httpConfig('local'))).toBe(false)
    expect(shouldScrubMcpHeadersHelperEnv(httpConfig('dynamic'))).toBe(false)
    expect(
      shouldScrubMcpHeadersHelperEnv(
        httpConfig('dynamic', { pluginSource: 'demo@marketplace' }),
      ),
    ).toBe(false)
    expect(
      shouldScrubMcpHeadersHelperEnv(
        httpConfig('dynamic', { pluginPath: '/plugins/demo' }),
      ),
    ).toBe(true)
    expect(
      shouldScrubMcpHeadersHelperEnv(
        httpConfig('dynamic', { agentSource: 'plugin' }),
      ),
    ).toBe(true)
    expect(shouldScrubMcpHeadersHelperEnv(httpConfig('user'))).toBe(false)
    expect(shouldScrubMcpHeadersHelperEnv(httpConfig('enterprise'))).toBe(false)
  })

  test('missing-trust copy starts with SEA prefix', () => {
    expect(formatMcpHeadersHelperMissingTrustMessage()).toContain(
      'headersHelper not run: this workspace has no persisted trust;',
    )
  })

  test('#38 project untrusted does not exec (including -p)', async () => {
    const headers = await getMcpHeadersFromHelper(
      'proj-mcp',
      httpConfig('project'),
    )
    expect(headers).toBeNull()
    expect(execMock).not.toHaveBeenCalled()
  })

  test('#38 project trusted execs helper', async () => {
    setPersistedTrust(true)
    const headers = await getMcpHeadersFromHelper(
      'proj-mcp',
      httpConfig('project'),
    )
    expect(headers).toEqual({ Authorization: 'Bearer minted' })
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  test('#38 user scope execs without persisted trust', async () => {
    const headers = await getMcpHeadersFromHelper(
      'user-mcp',
      httpConfig('user'),
    )
    expect(headers).toEqual({ Authorization: 'Bearer minted' })
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  test('#38 plugin-dynamic execs without persisted trust', async () => {
    const headers = await getMcpHeadersFromHelper(
      'plugin-mcp',
      httpConfig('dynamic', { pluginSource: 'demo@marketplace' }),
    )
    expect(headers).toEqual({ Authorization: 'Bearer minted' })
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  test('#38 bare dynamic without agentSource execs without persisted trust', async () => {
    const headers = await getMcpHeadersFromHelper(
      'agent-mcp',
      httpConfig('dynamic'),
    )
    expect(headers).toEqual({ Authorization: 'Bearer minted' })
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  test('#38 repo agentSource untrusted does not exec', async () => {
    const headers = await getMcpHeadersFromHelper(
      'agent-mcp',
      httpConfig('dynamic', { agentSource: 'projectSettings' }),
    )
    expect(headers).toBeNull()
    expect(execMock).not.toHaveBeenCalled()
  })

  test('#39 project child env scrubs ANTHROPIC_API_KEY and sets MCP overlay', async () => {
    setPersistedTrust(true)
    await getMcpHeadersFromHelper('proj-mcp', httpConfig('project'))
    const opts = execMock.mock.calls[0]?.[2] as {
      extendEnv?: boolean
      env?: NodeJS.ProcessEnv
      timeout?: number
      maxBuffer?: number
      shell?: boolean
    }
    expect(opts.extendEnv).toBe(false)
    expect(opts.shell).toBe(true)
    expect(opts.timeout).toBe(10_000)
    expect(opts.maxBuffer).toBe(1_000_000)
    expect(opts.env?.ANTHROPIC_API_KEY).toBeUndefined()
    expect(opts.env?.CLAUDE_CODE_MCP_SERVER_NAME).toBe('proj-mcp')
    expect(opts.env?.CLAUDE_CODE_MCP_SERVER_URL).toBe('https://example.com/mcp')
  })

  test('#39 user child env keeps credentials', async () => {
    await getMcpHeadersFromHelper('user-mcp', httpConfig('user'))
    const opts = execMock.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv }
    expect(opts.env?.ANTHROPIC_API_KEY).toBe('sk-secret-value')
    expect(opts.env?.CLAUDE_CODE_MCP_SERVER_NAME).toBe('user-mcp')
  })

  test('#39 plugin overlay injects CLAUDE_PLUGIN_ROOT from absolute pluginPath only', async () => {
    process.env.CLAUDE_PLUGIN_ROOT = '/process/env/should-not-copy'
    await getMcpHeadersFromHelper(
      'plugin-mcp',
      httpConfig('dynamic', {
        pluginSource: 'demo@marketplace',
        pluginPath: '/plugins/demo',
      }),
    )
    const opts = execMock.mock.calls[0]?.[2] as {
      env?: NodeJS.ProcessEnv
      cwd?: string
    }
    expect(opts.env?.CLAUDE_PLUGIN_ROOT).toBe('/plugins/demo')
    expect(opts.cwd).toBe('/plugins/demo')
    expect(opts.env?.ANTHROPIC_API_KEY).toBeUndefined()
  })

  test('#39 local does not scrub credentials', async () => {
    setPersistedTrust(true)
    await getMcpHeadersFromHelper('local-mcp', httpConfig('local'))
    const opts = execMock.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv }
    expect(opts.env?.ANTHROPIC_API_KEY).toBe('sk-secret-value')
  })
})
