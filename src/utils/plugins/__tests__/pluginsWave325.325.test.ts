import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPluginDownloadProxyOptions } from '../fetchTelemetry.js'
import {
  buildSparseCheckoutCommands,
  checkReservedOfficialMarketplaceCommitShaRef,
  checkUppercaseCommitShaRefError,
  isAuthenticationError,
  isFullLowercaseCommitSha,
  isGitSparseConeSetSupported,
  parseGitVersionTuple,
} from '../marketplaceManager.js'
import { getMcpbCacheDir } from '../mcpbHandler.js'
import {
  KnownMarketplaceSchema,
  validateOfficialNameSource,
} from '../schemas.js'
import {
  checkPluginEntryPathSafety,
  isPluginPathInMcpbCache,
  PLUGIN_MCPB_CACHE_SEGMENT,
  scanPluginUnsafePathsAndLinks,
} from '../validatePlugin.js'

describe('Wave 325 Group 3 — Plugins & Marketplaces', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#2282 plugin eval --output-dir "" exits with clear error message', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/cli/handlers/pluginEval.ts'),
      'utf8',
    )
    expect(src).toContain(
      '--output-dir was given an empty path; pass a directory, or omit it to use the default results directory',
    )
  })

  test('#2310 git 2.34 sparse-checkout compatibility preserves root files via core.sparseCheckoutCone', () => {
    const v234 = parseGitVersionTuple('git version 2.34.1')
    const v235 = parseGitVersionTuple('git version 2.35.0.windows.1')
    expect(v234).toEqual({ major: 2, minor: 34 })
    expect(v235).toEqual({ major: 2, minor: 35 })
    expect(isGitSparseConeSetSupported(v234)).toBe(false)
    expect(isGitSparseConeSetSupported(v235)).toBe(true)
    expect(isGitSparseConeSetSupported({ major: 2, minor: 43 })).toBe(true)

    const oldCmds = buildSparseCheckoutCommands(
      ['plugins/alpha', 'plugins/beta'],
      false,
    )
    expect(oldCmds).toEqual([
      [
        '-c',
        'core.sparseCheckout=true',
        '-c',
        'core.sparseCheckoutCone=true',
        'sparse-checkout',
        'set',
        '--',
        'plugins/alpha',
        'plugins/beta',
      ],
      ['sparse-checkout', 'init', '--cone'],
    ])

    const newCmds = buildSparseCheckoutCommands(['plugins/alpha'], true)
    expect(newCmds).toEqual([
      ['sparse-checkout', 'set', '--cone', '--', 'plugins/alpha'],
    ])
  })

  test('#2345 recognizes newer git password-prompt stderr and explains disabled prompts/askpass', () => {
    expect(
      isAuthenticationError(
        'fatal: unable to get password from user\nremote: Authentication failed',
      ),
    ).toBe(true)
    expect(
      isAuthenticationError('fatal: unable to get password from user'),
    ).toBe(true)

    const src = readFileSync(
      join(process.cwd(), 'src/utils/plugins/marketplaceManager.ts'),
      'utf8',
    )
    expect(src).toContain(
      'terminal prompts and askpass programs turned off and tells credential helpers not to prompt',
    )
  })

  test('#2346 marketplace, recommendation, and install trust warnings include code/file/shell risk notice', () => {
    const expectedPhrase =
      'can run code on your computer, with access to your files and shell.'
    for (const relPath of [
      'src/commands/plugin/PluginTrustWarning.tsx',
      'src/commands/plugin/AddMarketplace.tsx',
      'src/components/ClaudeCodeHint/PluginHintMenu.tsx',
    ]) {
      const content = readFileSync(join(process.cwd(), relPath), 'utf8')
      expect(content).toContain(expectedPhrase)
    }
  })

  test('#2360 extracts .mcpb/.dxt bundles into plugins cache directory rather than pluginPath/.mcpb-cache', () => {
    const pluginPath = '/tmp/example-plugin-root'
    const cacheDir = getMcpbCacheDir(pluginPath)
    expect(cacheDir).not.toBe(join(pluginPath, '.mcpb-cache'))
    expect(cacheDir).toContain('mcpb-cache')
    expect(cacheDir.startsWith(pluginPath)).toBe(false)
  })

  test('#2361 KnownMarketplaceSchema accepts deprecated pluginDigests without error', () => {
    const parsed = KnownMarketplaceSchema().safeParse({
      source: {
        source: 'github',
        repo: 'acme/marketplace',
      },
      installLocation: '/tmp/marketplaces/acme',
      lastUpdated: '2026-11-19T00:00:00.000Z',
      pluginDigests: {
        'foo@acme': 'sha256:abc123',
      },
    })
    expect(parsed.success).toBe(true)
  })

  test('#2362 flags unsafe .mcpb-cache paths, traversal, and broken/escaping symlinks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-unsafe-325-'))
    tempDirs.push(dir)
    const outsideDir = mkdtempSync(join(tmpdir(), 'plugin-outside-325-'))
    tempDirs.push(outsideDir)
    writeFileSync(join(outsideDir, 'secret.txt'), 'secret')

    expect(
      isPluginPathInMcpbCache(
        dir,
        join(dir, PLUGIN_MCPB_CACHE_SEGMENT, 'foo.js'),
      ),
    ).toBe(true)
    const cacheCheck = await checkPluginEntryPathSafety(
      dir,
      join(dir, '.mcpb-cache', 'bundle'),
    )
    expect(cacheCheck.safe).toBe(false)
    if (!cacheCheck.safe) {
      expect(cacheCheck.reason).toContain('.mcpb-cache')
    }
    const traversalCheck = await checkPluginEntryPathSafety(
      dir,
      join(dir, '..', 'outside.js'),
    )
    expect(traversalCheck.safe).toBe(false)
    if (!traversalCheck.safe) {
      expect(traversalCheck.reason).toContain('escapes')
    }

    mkdirSync(join(dir, '.mcpb-cache'), { recursive: true })
    writeFileSync(join(dir, '.mcpb-cache', 'stale.txt'), 'x')
    symlinkSync(join(outsideDir, 'secret.txt'), join(dir, 'escape-link'))
    symlinkSync(join(dir, 'does-not-exist'), join(dir, 'broken-link'))

    const scanResult = await scanPluginUnsafePathsAndLinks(dir)
    const allIssues = [...scanResult.errors, ...scanResult.warnings]
    expect(allIssues.some(w => w.path.includes('.mcpb-cache'))).toBe(true)
    expect(allIssues.some(w => w.path === 'escape-link')).toBe(true)
    expect(allIssues.some(w => w.path === 'broken-link')).toBe(true)
  })

  test('#2378 supports full lowercase 40/64-hex commit SHA ref, rejects uppercase SHA and official reserved SHA', () => {
    const sha40 = 'a'.repeat(40)
    const sha64 = '0123456789abcdef'.repeat(4)
    const upperSha40 = 'A'.repeat(40)

    expect(isFullLowercaseCommitSha(sha40)).toBe(true)
    expect(isFullLowercaseCommitSha(sha64)).toBe(true)
    expect(isFullLowercaseCommitSha(upperSha40)).toBe(false)
    expect(isFullLowercaseCommitSha('main')).toBe(false)

    expect(checkUppercaseCommitShaRefError(upperSha40)).toContain(
      'looks like a commit id with capital letters',
    )
    expect(checkUppercaseCommitShaRefError(sha40)).toBeUndefined()

    expect(
      checkReservedOfficialMarketplaceCommitShaRef(
        'claude-plugins-official',
        sha40,
      ),
    ).toContain('follow a branch or tag')

    expect(
      validateOfficialNameSource('claude-plugins-official', {
        source: 'github',
        repo: 'anthropics/claude-plugins-official',
        ref: sha40,
      }),
    ).toContain('follow a branch or tag')

    expect(
      validateOfficialNameSource('claude-plugins-official', {
        source: 'github',
        repo: 'anthropics/claude-plugins-official',
        ref: 'main',
      }),
    ).toBeNull()
  })

  test('#2379 routes plugin downloads through ALL_PROXY CONNECT tunnel when sole proxy', () => {
    const withAllProxy = getPluginDownloadProxyOptions(
      'https://example.com/plugin.zip',
      { ALL_PROXY: 'http://proxy.internal:8080' },
    )
    expect(withAllProxy.proxy).toBe(false)
    expect(withAllProxy.httpsAgent).toBeDefined()

    const withNoProxy = getPluginDownloadProxyOptions(
      'https://example.com/plugin.zip',
      {
        ALL_PROXY: 'http://proxy.internal:8080',
        NO_PROXY: 'example.com',
      },
    )
    expect(withNoProxy.httpsAgent).toBeUndefined()

    const withHttpsProxy = getPluginDownloadProxyOptions(
      'https://example.com/plugin.zip',
      {
        ALL_PROXY: 'http://all-proxy.internal:8080',
        HTTPS_PROXY: 'http://https-proxy.internal:8080',
      },
    )
    expect(withHttpsProxy.httpsAgent).toBeUndefined()
  })
})
