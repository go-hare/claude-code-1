import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

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
mock.module('../../proxy.js', proxyStub)

const {
  getInlinePlugins,
  getInlinePluginsNoMcp,
  getOriginalCwd,
  setInlinePlugins,
  setInlinePluginsNoMcp,
} = await import('../../../bootstrap/state.js')
const { convertToSandboxRuntimeConfig, getInlinePluginRoots } = await import(
  '../sandbox-adapter.js'
)
const { WSL_WINDOWS_MANAGED_PATH } = await import(
  '../../settings/managedPath.js'
)

describe('sandbox 2.1.299 alignment (#591, #598)', () => {
  const prevInline = getInlinePlugins()
  const prevInlineNoMcp = getInlinePluginsNoMcp()
  const tempDirs: string[] = []

  afterEach(() => {
    setInlinePlugins(prevInline)
    setInlinePluginsNoMcp(prevInlineNoMcp)
    for (const d of tempDirs.splice(0)) {
      rmSync(d, { recursive: true, force: true })
    }
  })

  test('#591 getInlinePluginRoots resolves and deduplicates --plugin-dir and --plugin-dir-no-mcp', () => {
    const base = '/tmp/project-base'
    setInlinePlugins(['./plug-a', '/abs/plug-b'])
    setInlinePluginsNoMcp(['./plug-a', './plug-c'])
    expect(getInlinePluginRoots(base)).toEqual([
      resolve(base, './plug-a'),
      '/abs/plug-b',
      resolve(base, './plug-c'),
    ])
  })

  test('#591 convertToSandboxRuntimeConfig adds --plugin-dir roots to denyWrite unless cwd is under them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sandbox-591-'))
    tempDirs.push(dir)
    const pluginDir = join(dir, 'my-plugin')
    mkdirSync(pluginDir)

    setInlinePlugins([pluginDir])
    setInlinePluginsNoMcp([])

    const cfg = convertToSandboxRuntimeConfig({
      permissions: { allow: [], deny: [], ask: [] },
      sandbox: { enabled: true },
    } as any)
    expect(cfg.filesystem.denyWrite).toContain(pluginDir)

    // If originalCwd itself is passed as pluginDir, pc() skips denying it
    setInlinePlugins([getOriginalCwd()])
    const cfgSelf = convertToSandboxRuntimeConfig({
      permissions: { allow: [], deny: [], ask: [] },
      sandbox: { enabled: true },
    } as any)
    expect(cfgSelf.filesystem.denyWrite).not.toContain(getOriginalCwd())
  })

  test('#598 WSL_WINDOWS_MANAGED_PATH matches official OH constant', () => {
    expect(WSL_WINDOWS_MANAGED_PATH).toBe('/mnt/c/Program Files/ClaudeCode')
  })
})
