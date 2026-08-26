/**
 * densable 2.1.238 marketplace headersHelper.
 * Snapshot+restore execFileNoThrow and growthbook. Do not blanket-mock
 * GB=true / settings={} (that poisoned tui + classifier + fleet).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import * as realGrowthbook from '../../../services/analytics/growthbook.js'
import * as realExec from '../../execFileNoThrow.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

const execSnap = snapshotModuleExports(realExec)
const growthbookSnap = snapshotModuleExports(realGrowthbook)

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

mock.module('../../execFileNoThrow.js', () => ({
  ...execSnap,
  execFileNoThrow: execMock,
  execFileNoThrowWithCwd: execMock,
}))
mock.module('src/utils/execFileNoThrow.ts', () => ({
  ...execSnap,
  execFileNoThrow: execMock,
  execFileNoThrowWithCwd: execMock,
}))

function growthbookMock() {
  return {
    ...growthbookSnap,
    getFeatureValue_CACHED_MAY_BE_STALE: (
      key: string,
      fallback: unknown,
    ): unknown => {
      if (key === 'tengu_plugin_command_source_refresh') return true
      return (
        growthbookSnap.getFeatureValue_CACHED_MAY_BE_STALE as (
          k: string,
          f: unknown,
        ) => unknown
      )(key, fallback)
    },
  }
}
mock.module('../../../services/analytics/growthbook.js', growthbookMock)
mock.module('src/services/analytics/growthbook.js', growthbookMock)

afterAll(() => {
  mock.module('../../execFileNoThrow.js', () => ({ ...execSnap }))
  mock.module('src/utils/execFileNoThrow.ts', () => ({ ...execSnap }))
  mock.module('../../../services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

import {
  ENTRY_HELPER_INSTALL_ABORT_MESSAGE,
  ENTRY_HELPER_REMOTE_POLICY_UNCONSENTED,
  buildHeadersHelperChildEnv,
  canonicalizeMarketplaceUrl,
  checkHeadersHelperPaneConsent,
  clearMarketplaceHeadersHelperMemo,
  collectPluginMarketplaceEntryHeadersHelperAdvisories,
  compareConsentedEntryHelper,
  filterPluginFetchHeaders,
  formatEntryHelperCliUnconfirmedMessage,
  formatEntryHelperDisclosure,
  formatHeadersHelperPaneMismatch,
  getShownArchiveHeadersHelperFromOverlay,
  headersHelperPaneIdentity,
  lookupTrustedSettingsEntryAuth,
  mergeSameOriginArchiveHeaders,
  mintHeadersFromHelper,
  overlayTrustedSettingsEntryAuth,
  formatEntryHelperPolicyRefusalMessage,
  assertEntryHeadersHelperMayRun,
  promptEntryHeadersHelperConsent,
  resolvePluginArchiveHeaders,
  resolveShownArchiveHeadersHelper,
  resolveUrlMarketplaceHeaders,
} from '../marketplaceHeadersHelper.js'
import { EntryHelperPolicyError } from '../pluginCommandRefusal.js'
import {
  headersHelperPolicyRefusal,
  isHeadersHelperDisabledByPolicy,
} from '../pluginPolicy.js'
import {
  resetSyncCache,
  setSessionCache,
} from '../../../services/remoteManagedSettings/syncCacheState.js'
import type { SettingsJson } from '../../../utils/settings/types.js'

describe('marketplace headersHelper mint (densable 2.1.238 m5n)', () => {
  beforeEach(() => {
    clearMarketplaceHeadersHelperMemo()
    resetSyncCache()
    execMock.mockClear()
    execMock.mockImplementation(async () => ({
      stdout: '{"Authorization":"Bearer minted"}',
      stderr: '',
      code: 0,
    }))
  })

  afterEach(() => {
    clearMarketplaceHeadersHelperMemo()
    resetSyncCache()
  })

  test('mintHeadersFromHelper parses JSON string headers', async () => {
    const result = await mintHeadersFromHelper({
      command: 'printf %s',
      cwd: '/tmp',
      scrubCredentialEnv: false,
      env: { CLAUDE_CODE_MARKETPLACE_URL: 'https://example.com/m.json' },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.headers.Authorization).toBe('Bearer minted')
    }
    expect(execMock).toHaveBeenCalled()
    const opts = execMock.mock.calls[0]?.[2] as {
      shell?: boolean
      timeout?: number
      maxBuffer?: number
      extendEnv?: boolean
    }
    expect(opts.shell).toBe(true)
    expect(opts.timeout).toBe(10_000)
    expect(opts.maxBuffer).toBe(1_000_000)
    expect(opts.extendEnv).toBe(false)
  })

  test('mintHeadersFromHelper fails on non-object JSON', async () => {
    execMock.mockImplementation(async () => ({
      stdout: '["nope"]',
      stderr: '',
      code: 0,
    }))
    const result = await mintHeadersFromHelper({
      command: 'echo',
      cwd: '/tmp',
      scrubCredentialEnv: true,
    })
    expect(result).toEqual({ ok: false, reason: 'non_object' })
  })

  test('filterPluginFetchHeaders drops Host for non-operator', () => {
    const filtered = filterPluginFetchHeaders(
      { Host: 'evil.example', Authorization: 'Bearer x' },
      'plugin demo',
      { operatorAuthored: false },
    )
    expect(filtered.Host).toBeUndefined()
    expect(filtered.Authorization).toBe('Bearer x')
  })

  test('filterPluginFetchHeaders keeps Host for operator', () => {
    const filtered = filterPluginFetchHeaders(
      { Host: 'allowed.example', Authorization: 'Bearer x' },
      'plugin demo',
      { operatorAuthored: true },
    )
    expect(filtered.Host).toBe('allowed.example')
  })

  test('buildHeadersHelperChildEnv REDACTS secrets into helper env', () => {
    const prev = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-secret-value'
    try {
      const env = buildHeadersHelperChildEnv({
        scrubCredentialEnv: true,
        env: {
          CLAUDE_CODE_MARKETPLACE_URL:
            'https://example.com/?tok=sk-secret-value',
        },
      })
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(env.CLAUDE_CODE_MARKETPLACE_URL).toBe(
        'https://example.com/?tok=REDACTED',
      )
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = prev
    }
  })

  test('resolveUrlMarketplaceHeaders overlays helper over static from trustedDeclaration', async () => {
    const headers = await resolveUrlMarketplaceHeaders(
      {
        source: 'url',
        url: 'https://example.com/marketplace.json',
        headers: { Authorization: 'Bearer static', 'X-Extra': '1' },
        headersHelper: 'mint-headers',
      },
      {
        marketplaceName: 'demo',
        trustedDeclaration: {
          headers: { Authorization: 'Bearer static', 'X-Extra': '1' },
          headersHelper: 'mint-headers',
          operatorAuthored: true,
          authoredBy: 'userSettings',
        },
      },
    )
    expect(headers.Authorization).toBe('Bearer minted')
    expect(headers['X-Extra']).toBe('1')
    expect(execMock).toHaveBeenCalled()
  })

  test('resolveUrlMarketplaceHeaders skips helper on non-https even with trusted helper', async () => {
    execMock.mockClear()
    const headers = await resolveUrlMarketplaceHeaders(
      {
        source: 'url',
        url: 'http://example.com/marketplace.json',
        headers: { Authorization: 'Bearer static' },
        headersHelper: 'mint-headers',
      },
      {
        marketplaceName: 'demo',
        trustedDeclaration: {
          headers: { Authorization: 'Bearer static' },
          headersHelper: 'mint-headers',
          operatorAuthored: true,
          authoredBy: 'userSettings',
        },
      },
    )
    expect(headers.Authorization).toBe('Bearer static')
    expect(execMock).not.toHaveBeenCalled()
  })

  test('state-only headersHelper without trustedDeclaration does not exec', async () => {
    execMock.mockClear()
    const headers = await resolveUrlMarketplaceHeaders(
      {
        source: 'url',
        url: 'https://example.com/marketplace.json',
        headers: { Authorization: 'Bearer static' },
        headersHelper: 'mint-from-state',
      },
      { marketplaceName: 'demo', trustedDeclaration: null },
    )
    expect(headers.Authorization).toBe('Bearer static')
    expect(execMock).not.toHaveBeenCalled()
  })

  test('omitted trustedDeclaration uses ret(); state helper still does not exec', async () => {
    execMock.mockClear()
    const headers = await resolveUrlMarketplaceHeaders(
      {
        source: 'url',
        url: 'https://example.com/marketplace.json',
        headers: { Authorization: 'Bearer static' },
        headersHelper: 'mint-from-state',
      },
      { marketplaceName: 'demo-untrusted-state' },
    )
    expect(headers.Authorization).toBe('Bearer static')
    expect(execMock).not.toHaveBeenCalled()
  })

  test('policySettings trusted helper throws when remote policy is unconsented', async () => {
    // Drive tip psr false without inventing Z_e/sIn: populated sessionCache
    // that is not Qxn (verified+consented) → !isRemoteManagedPolicyConsented.
    const remote: SettingsJson = {
      extraKnownMarketplaces: {
        demo: {
          source: {
            source: 'url',
            url: 'https://example.com/marketplace.json',
          },
        },
      },
    }
    setSessionCache(remote)
    execMock.mockClear()
    await expect(
      resolveUrlMarketplaceHeaders(
        {
          source: 'url',
          url: 'https://example.com/marketplace.json',
        },
        {
          marketplaceName: 'demo',
          trustedDeclaration: {
            headersHelper: 'mint-headers',
            operatorAuthored: true,
            authoredBy: 'policySettings',
          },
        },
      ),
    ).rejects.toThrow(ENTRY_HELPER_REMOTE_POLICY_UNCONSENTED)
    expect(execMock).not.toHaveBeenCalled()
  })

  test('canonicalizeMarketplaceUrl round-trips https URLs', () => {
    expect(canonicalizeMarketplaceUrl('https://Example.COM/m.json')).toBe(
      'https://example.com/m.json',
    )
  })
})

describe('headersHelper policy (densable fgt/YLa)', () => {
  test('J8p policy refusal throws y5n K8n, not the overlay O3n short string', () => {
    const helper = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../marketplaceHeadersHelper.ts',
      ),
      'utf8',
    )
    const j8p = helper.slice(
      helper.indexOf('export function assertEntryHeadersHelperMayRun'),
      helper.indexOf('export function entryHasArchiveHeadersHelper'),
    )
    expect(j8p).toContain('formatEntryHelperPolicyRefusalMessage')
    expect(j8p).toContain('EntryHelperPolicyError')
    expect(j8p).toContain('entryHelperPolicyFailureCode')
    expect(j8p).toContain('entry_helper_not_inlined')
    expect(j8p).toContain('entry_helper_deferred')
    expect(j8p).not.toContain(
      "This plugin's headersHelper was not run: remote managed settings not yet verified",
    )
    expect(
      formatEntryHelperPolicyRefusalMessage(
        'demo-plugin',
        'remote_policy_unconsented',
      ),
    ).toContain('The plugin was not installed or updated.')
  })

  test('J8p throws cwe for not_inlined and deferred', () => {
    try {
      assertEntryHeadersHelperMayRun(
        { headersHelper: 'mint-headers', strict: true },
        {
          pluginName: 'demo-plugin',
          runEntryHelper: true,
          requireInlinedManifest: true,
        },
      )
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toBeInstanceOf(EntryHelperPolicyError)
      expect((error as EntryHelperPolicyError).failureCode).toBe(
        'entry_helper_not_inlined',
      )
      expect((error as EntryHelperPolicyError).kindDetail).toBe(
        'plugin entry headersHelper requires strict:false (catalog authoring error)',
      )
    }

    try {
      assertEntryHeadersHelperMayRun(
        { headersHelper: 'mint-headers', strict: false },
        {
          pluginName: 'demo-plugin',
          runEntryHelper: false,
          requireInlinedManifest: false,
        },
      )
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toBeInstanceOf(EntryHelperPolicyError)
      expect((error as EntryHelperPolicyError).failureCode).toBe(
        'entry_helper_deferred',
      )
    }
  })

  test('refusal null when policy does not disable command sources', () => {
    expect(
      headersHelperPolicyRefusal({
        source: 'url',
        url: 'https://example.com/m.json',
      }),
    ).toBeNull()
    expect(
      isHeadersHelperDisabledByPolicy({
        source: 'url',
        url: 'https://example.com/m.json',
      }),
    ).toBe(false)
  })
})

describe('marketplace headersHelper authoring advisories (densable 2.1.238)', () => {
  test('strict / non-archive / sha256 / routing-header gold strings', () => {
    const advisories = collectPluginMarketplaceEntryHeadersHelperAdvisories(
      {
        name: 'demo-plugin',
        strict: true,
        headers: { Host: 'evil.example', Authorization: 'Bearer x' },
        headersHelper: '/bin/mint',
        source: {
          source: 'github',
          repo: 'acme/demo',
        },
      },
      0,
    )
    const messages = advisories.map(a => a.message)
    expect(
      messages.some(m =>
        m.includes('sets headersHelper but is not "strict": false'),
      ),
    ).toBe(true)
    expect(
      messages.some(m =>
        m.includes('only apply to "archive" sources; they have no effect'),
      ),
    ).toBe(true)
    expect(
      messages.some(m =>
        m.includes(
          'is a request-routing/identity header that catalog entries may not set',
        ),
      ),
    ).toBe(true)

    const archiveNoPin = collectPluginMarketplaceEntryHeadersHelperAdvisories(
      {
        name: 'demo-plugin',
        strict: false,
        headersHelper: '/bin/mint',
        source: {
          source: 'archive',
          url: 'https://example.com/demo.zip',
        },
      },
      1,
    )
    expect(
      archiveNoPin.some(a =>
        a.message.includes('sets no sha256 pin. Consider pinning the digest'),
      ),
    ).toBe(true)
  })
})

describe('qhi compareConsentedEntryHelper (densable 2.1.238 dwo, not a Map)', () => {
  const helper = {
    command: '/bin/mint',
    archiveUrl: 'https://example.com/demo.zip',
  }

  test('no helper → ok even without consented snapshot', () => {
    expect(
      compareConsentedEntryHelper({
        pluginName: 'demo',
        kind: 'install',
      }),
    ).toEqual({ ok: true })
  })

  test('install from list without details → unshown; pluginId is not a grant', () => {
    const result = compareConsentedEntryHelper({
      pluginName: 'demo',
      helper,
      kind: 'install',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('unshown')
      expect(result.message).toBe(
        'This install would run a headersHelper command for "demo" that was not shown to you first. Retry the same install to review the command before it runs.',
      )
      expect(result.hint).toBe('')
      expect(formatHeadersHelperPaneMismatch(result)).not.toContain(
        'Reopen its details',
      )
    }
    // Alias still ignores pluginId — there is no session Map to write.
    const alias = checkHeadersHelperPaneConsent({
      pluginId: 'demo@mkt',
      pluginName: 'demo',
      command: helper.command,
      archiveUrl: helper.archiveUrl,
      kind: 'install',
    })
    expect(alias.ok).toBe(false)
  })

  test('matching pinned snapshot succeeds; command/archive mismatch codes', () => {
    expect(
      compareConsentedEntryHelper({
        consented: helper,
        helper,
        pluginName: 'demo',
        kind: 'install',
      }),
    ).toEqual({ ok: true })

    const cmd = compareConsentedEntryHelper({
      consented: helper,
      helper: { ...helper, command: '/bin/other' },
      pluginName: 'demo',
      kind: 'install',
    })
    expect(cmd.ok).toBe(false)
    if (!cmd.ok) {
      expect(cmd.code).toBe('command')
      expect(cmd.message).toContain('changed since it was shown')
      expect(cmd.hint).toContain('Reopen its details')
    }

    const url = compareConsentedEntryHelper({
      consented: helper,
      helper: { ...helper, archiveUrl: 'https://example.com/other.zip' },
      pluginName: 'demo',
      kind: 'install',
    })
    expect(url.ok).toBe(false)
    if (!url.ok) {
      expect(url.code).toBe('archive_url')
      expect(url.message).toContain(
        'changed since its headersHelper command was shown',
      )
    }
  })

  test('update unshown copy; retry with recorded snapshot ok', () => {
    const first = compareConsentedEntryHelper({
      pluginName: 'demo',
      helper,
      kind: 'update',
    })
    expect(first.ok).toBe(false)
    if (!first.ok) {
      expect(first.code).toBe('unshown')
      expect(first.message).toContain('not shown on this pane')
      expect(first.hint).toContain(
        'Review the command now shown, then update again',
      )
    }

    expect(
      compareConsentedEntryHelper({
        consented: helper,
        helper,
        pluginName: 'demo',
        kind: 'update',
      }),
    ).toEqual({ ok: true })
  })

  test('dwo identity is command+archiveUrl; helper change is a new identity', () => {
    expect(headersHelperPaneIdentity(undefined)).toBe('')
    expect(headersHelperPaneIdentity(helper)).toBe(
      '/bin/mint\0https://example.com/demo.zip',
    )
    expect(
      headersHelperPaneIdentity({
        command: 'new-cmd',
        archiveUrl: helper.archiveUrl,
      }),
    ).not.toBe(headersHelperPaneIdentity(helper))
  })

  test('SEA zgh CLI unconfirmed copy is BXi + confirm-in-terminal', () => {
    const disclosure = formatEntryHelperDisclosure(helper)
    expect(formatEntryHelperCliUnconfirmedMessage(helper)).toBe(
      `${disclosure}\nThis install runs that command; confirm it by running \`claude plugin install\` in a terminal (or with -y/--yes).`,
    )
  })
})

describe('Oyw install abort + f3l unconfirmed (densable 2.1.238)', () => {
  test('install abort copy is SEA-exact and plugins.ts aborts declined|unconfirmed', () => {
    expect(ENTRY_HELPER_INSTALL_ABORT_MESSAGE).toBe(
      'Aborted — the command was not run.',
    )
    const plugins = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../cli/handlers/plugins.ts',
      ),
      'utf8',
    )
    expect(plugins).toContain('ENTRY_HELPER_INSTALL_ABORT_MESSAGE')
    expect(plugins).toContain("headersHelperConsent?.kind === 'declined'")
    expect(plugins).toContain("headersHelperConsent?.kind === 'unconfirmed'")
    expect(plugins).not.toMatch(
      /headersHelperConsent\?\.kind === 'declined'[\s\S]{0,80}console\.log\('Aborted\.'\)/,
    )
  })

  test('non-TTY promptEntryHeadersHelperConsent returns unconfirmed', async () => {
    const origOut = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    const origIn = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
    })
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      configurable: true,
    })
    const origChild = process.env.CLAUDE_CODE_CHILD_SESSION
    const origClaude = process.env.CLAUDECODE
    delete process.env.CLAUDE_CODE_CHILD_SESSION
    delete process.env.CLAUDECODE
    try {
      const writes: string[] = []
      const result = await promptEntryHeadersHelperConsent({
        pluginName: 'demo',
        command: '/bin/mint',
        archiveUrl: 'https://example.com/demo.zip',
        write: t => {
          writes.push(t)
        },
      })
      expect(result).toEqual({ kind: 'unconfirmed' })
      expect(writes.join('')).toContain('Not an interactive terminal')
    } finally {
      if (origOut) Object.defineProperty(process.stdout, 'isTTY', origOut)
      else delete (process.stdout as { isTTY?: boolean }).isTTY
      if (origIn) Object.defineProperty(process.stdin, 'isTTY', origIn)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
      if (origChild === undefined) delete process.env.CLAUDE_CODE_CHILD_SESSION
      else process.env.CLAUDE_CODE_CHILD_SESSION = origChild
      if (origClaude === undefined) delete process.env.CLAUDECODE
      else process.env.CLAUDECODE = origClaude
    }
  })
})

describe('SEA ret/_5n/P5r mint sites (densable 2.1.238 leftover #2 follow-up)', () => {
  test('resolveMarketplaceArchiveAuth no longer mints via resolveUrlMarketplaceHeaders', () => {
    const helpers = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../pluginInstallationHelpers.ts',
      ),
      'utf8',
    )
    const fnStart = helpers.indexOf(
      'export async function resolveMarketplaceArchiveAuth',
    )
    const fnEnd = helpers.indexOf(
      'export async function cacheAndRegisterPlugin',
    )
    const body = helpers.slice(fnStart, fnEnd)
    expect(body).not.toContain('resolveUrlMarketplaceHeaders')
    expect(body).not.toContain('headersHelper')
  })

  test('cacheAndRegisterPlugin runs qhi before resolveMarketplaceArchiveAuth', () => {
    const helpers = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../pluginInstallationHelpers.ts',
      ),
      'utf8',
    )
    const fnStart = helpers.indexOf(
      'export async function cacheAndRegisterPlugin',
    )
    const fn = helpers.slice(fnStart)
    const qhi = fn.indexOf('compareConsentedEntryHelper')
    const auth = fn.indexOf('resolveMarketplaceArchiveAuth')
    expect(qhi).toBeGreaterThan(0)
    expect(auth).toBeGreaterThan(qhi)
  })

  test('pluginLoader P5r asserts entry helper before marketplace _5n mint', () => {
    const loader = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../pluginLoader.ts'),
      'utf8',
    )
    const archiveCase = loader.indexOf("case 'archive': {")
    expect(archiveCase).toBeGreaterThan(0)
    const chunk = loader.slice(archiveCase, archiveCase + 4500)
    const j8p = chunk.indexOf('assertEntryHeadersHelperMayRun')
    const mint = chunk.indexOf('resolveUrlMarketplaceHeaders')
    expect(j8p).toBeGreaterThan(0)
    expect(mint).toBeGreaterThan(j8p)
  })
})

describe('P5r/mqS archive header origin (densable 2.1.238)', () => {
  test('mergeSameOriginArchiveHeaders keeps entry headers when marketplaceUrl is undefined', () => {
    const merged = mergeSameOriginArchiveHeaders({
      archiveUrl: 'https://cdn.example.com/demo.zip',
      marketplaceHeaders: { Authorization: 'Bearer mkt' },
      entryHeaders: { Authorization: 'Bearer entry' },
    })
    expect(merged).toEqual({ Authorization: 'Bearer entry' })
  })

  test('mergeSameOriginArchiveHeaders overlays marketplace headers only on same origin', () => {
    const same = mergeSameOriginArchiveHeaders({
      marketplaceUrl: 'https://cdn.example.com/marketplace.json',
      archiveUrl: 'https://cdn.example.com/demo.zip',
      marketplaceHeaders: { Authorization: 'Bearer mkt', 'X-Mkt': '1' },
      entryHeaders: { Authorization: 'Bearer entry' },
    })
    expect(same).toEqual({
      Authorization: 'Bearer entry',
      'X-Mkt': '1',
    })

    const cross = mergeSameOriginArchiveHeaders({
      marketplaceUrl: 'https://github.com/acme/marketplace',
      archiveUrl: 'https://cdn.example.com/demo.zip',
      marketplaceHeaders: { Authorization: 'Bearer github' },
      entryHeaders: { Authorization: 'Bearer entry' },
    })
    expect(cross).toEqual({ Authorization: 'Bearer entry' })
  })

  test('resolvePluginArchiveHeaders keeps entry headers without marketplaceUrl', async () => {
    const headers = await resolvePluginArchiveHeaders(
      {
        headers: { Authorization: 'Bearer entry' },
        headersHelper: undefined,
        strict: false,
        source: {
          source: 'archive',
          url: 'https://cdn.example.com/demo.zip',
        },
      },
      {
        pluginName: 'demo',
        archiveUrl: 'https://cdn.example.com/demo.zip',
        runEntryHelper: false,
        marketplaceHeaders: { Authorization: 'Bearer github' },
      },
    )
    expect(headers.Authorization).toBe('Bearer entry')
  })
})

describe('DNt/Ryt/vBa settings-source overlay (densable 2.1.238)', () => {
  beforeEach(() => {
    resetSyncCache()
    execMock.mockClear()
  })
  afterEach(() => {
    resetSyncCache()
  })

  const archiveUrl = 'https://cdn.example.com/demo.zip'
  const catalogEntry = {
    name: 'demo',
    headers: { Authorization: 'Bearer catalog' },
    headersHelper: '/bin/catalog-mint',
    strict: true,
    source: { source: 'archive' as const, url: archiveUrl },
  }
  const urlMarketplace = {
    source: 'url' as const,
    url: 'https://cdn.example.com/marketplace.json',
  }
  const settingsMarketplace = {
    source: 'settings' as const,
    name: 'ops',
    plugins: [],
  }

  test('overlay archiveUrl mismatch empties entry (no helper)', () => {
    const overlay = overlayTrustedSettingsEntryAuth({
      entry: catalogEntry,
      archiveUrl,
      marketplaceSource: urlMarketplace,
      trustedSettingsEntryAuth: {
        origin: 'settings',
        operatorTier: 'userSettings',
        archiveUrl: 'https://cdn.example.com/other.zip',
        headersHelper: '/bin/overlay-mint',
      },
    })
    expect(overlay.entry).toEqual({})
    expect(overlay.operatorAuthored).toBe(true)
    expect(overlay.requireInlinedManifest).toBe(false)
    expect(
      getShownArchiveHeadersHelperFromOverlay(overlay, archiveUrl),
    ).toBeNull()
  })

  test('overlay policySettings helper throws O3n before q9 when !psr', () => {
    const remote: SettingsJson = {
      extraKnownMarketplaces: {
        ops: {
          source: {
            source: 'url',
            url: 'https://cdn.example.com/marketplace.json',
          },
        },
      },
    }
    setSessionCache(remote)
    const options = {
      entry: catalogEntry,
      archiveUrl,
      marketplaceSource: urlMarketplace,
      trustedSettingsEntryAuth: {
        origin: 'settings' as const,
        operatorTier: 'policySettings' as const,
        archiveUrl,
        headersHelper: '/bin/policy-mint',
      },
    }
    expect(() => overlayTrustedSettingsEntryAuth(options)).toThrow(
      `This plugin's headersHelper was not run: ${ENTRY_HELPER_REMOTE_POLICY_UNCONSENTED}.`,
    )
    try {
      overlayTrustedSettingsEntryAuth(options)
    } catch (error) {
      expect(error).toBeInstanceOf(EntryHelperPolicyError)
      expect((error as EntryHelperPolicyError).failureCode).toBe(
        'entry_helper_remote_policy_unconsented',
      )
      expect((error as Error).message).not.toContain(
        'The marketplace was not fetched.',
      )
    }
    expect(execMock).not.toHaveBeenCalled()
  })

  test('overlay addDir strips helper', () => {
    const overlay = overlayTrustedSettingsEntryAuth({
      entry: catalogEntry,
      archiveUrl,
      marketplaceSource: settingsMarketplace,
      trustedSettingsEntryAuth: {
        origin: 'addDir',
        archiveUrl,
        headers: { Authorization: 'Bearer addDir' },
        headersHelper: '/bin/addDir-mint',
      },
    })
    expect(overlay.entry.headersHelper).toBeUndefined()
    expect(overlay.entry.headers).toEqual({ Authorization: 'Bearer addDir' })
    expect(overlay.operatorAuthored).toBe(false)
    expect(overlay.requireInlinedManifest).toBe(false)
    expect(
      getShownArchiveHeadersHelperFromOverlay(overlay, archiveUrl),
    ).toBeNull()
  })

  test('settings-source marketplace without overlay strips catalog helper', () => {
    const overlay = overlayTrustedSettingsEntryAuth({
      entry: catalogEntry,
      archiveUrl,
      marketplaceSource: settingsMarketplace,
    })
    expect(overlay.entry).toEqual({
      headers: { Authorization: 'Bearer catalog' },
    })
    expect(overlay.operatorAuthored).toBe(false)
    expect(overlay.requireInlinedManifest).toBe(true)
    expect(
      getShownArchiveHeadersHelperFromOverlay(overlay, archiveUrl),
    ).toBeNull()
  })

  test('no marketplaceSource also strips catalog helper (pane MUST pass source)', () => {
    const overlay = overlayTrustedSettingsEntryAuth({
      entry: catalogEntry,
      archiveUrl,
    })
    expect(overlay.entry.headersHelper).toBeUndefined()
    expect(
      getShownArchiveHeadersHelperFromOverlay(overlay, archiveUrl),
    ).toBeNull()
  })

  test('catalog non-settings no overlay keeps original entry and requireInlinedManifest', () => {
    const overlay = overlayTrustedSettingsEntryAuth({
      entry: catalogEntry,
      archiveUrl,
      marketplaceSource: urlMarketplace,
    })
    expect(overlay.entry).toBe(catalogEntry)
    expect(overlay.operatorAuthored).toBe(false)
    expect(overlay.requireInlinedManifest).toBe(true)
    // catalog helper still needs strict:false
    expect(
      getShownArchiveHeadersHelperFromOverlay(overlay, archiveUrl),
    ).toBeNull()
    const shown = getShownArchiveHeadersHelperFromOverlay(
      overlayTrustedSettingsEntryAuth({
        entry: { ...catalogEntry, strict: false },
        archiveUrl,
        marketplaceSource: urlMarketplace,
      }),
      archiveUrl,
    )
    expect(shown).toEqual({
      command: '/bin/catalog-mint',
      archiveUrl,
    })
  })

  test('overlay hit does not need strict:false; operatorAuthored when origin settings', () => {
    const overlay = overlayTrustedSettingsEntryAuth({
      entry: catalogEntry,
      archiveUrl,
      marketplaceSource: urlMarketplace,
      trustedSettingsEntryAuth: {
        origin: 'settings',
        operatorTier: 'userSettings',
        archiveUrl,
        headers: { Authorization: 'Bearer overlay' },
        headersHelper: '/bin/overlay-mint',
      },
    })
    expect(overlay.requireInlinedManifest).toBe(false)
    expect(overlay.operatorAuthored).toBe(true)
    expect(overlay.entry.headersHelper).toBe('/bin/overlay-mint')
    expect(
      getShownArchiveHeadersHelperFromOverlay(overlay, archiveUrl),
    ).toEqual({ command: '/bin/overlay-mint', archiveUrl })
  })

  test('repo overlay is discarded unless marketplaceSource is settings', () => {
    const discarded = overlayTrustedSettingsEntryAuth({
      entry: catalogEntry,
      archiveUrl,
      marketplaceSource: urlMarketplace,
      trustedSettingsEntryAuth: {
        origin: 'repo',
        archiveUrl,
        headersHelper: '/bin/repo-mint',
      },
    })
    expect(discarded.entry).toBe(catalogEntry)
    expect(discarded.requireInlinedManifest).toBe(true)

    const kept = overlayTrustedSettingsEntryAuth({
      entry: catalogEntry,
      archiveUrl,
      marketplaceSource: settingsMarketplace,
      trustedSettingsEntryAuth: {
        origin: 'repo',
        archiveUrl,
        headersHelper: '/bin/repo-mint',
      },
    })
    expect(kept.entry.headersHelper).toBe('/bin/repo-mint')
    expect(kept.operatorAuthored).toBe(false)
    expect(kept.requireInlinedManifest).toBe(false)
  })

  test('g5n overlay helper shown even if catalog strict true', () => {
    const helper = resolveShownArchiveHeadersHelper({
      entry: catalogEntry,
      marketplaceName: 'ops',
      marketplaceSource: urlMarketplace,
      trustedSettingsEntryAuth: {
        origin: 'settings',
        operatorTier: 'userSettings',
        archiveUrl,
        headersHelper: '/bin/overlay-mint',
      },
    })
    expect(helper).toEqual({
      command: '/bin/overlay-mint',
      archiveUrl,
    })
  })

  test('no raw getArchiveHeadersHelperForPane bypass of DNt/g5n', () => {
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../marketplaceHeadersHelper.ts',
      ),
      'utf8',
    )
    expect(src).not.toContain('function getArchiveHeadersHelperForPane')
    expect(src).toContain('export function resolveShownArchiveHeadersHelper')
    for (const rel of [
      '../../../commands/plugin/BrowseMarketplace.tsx',
      '../../../commands/plugin/DiscoverPlugins.tsx',
      '../../../commands/plugin/ManagePlugins.tsx',
      '../../../commands/plugin/pluginDetailsHelpers.tsx',
    ]) {
      const pane = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), rel),
        'utf8',
      )
      expect(pane).toContain('resolveShownArchiveHeadersHelper')
      expect(pane).not.toContain('getArchiveHeadersHelperForPane')
    }
  })

  test('Ryt never reads known_marketplaces.json', () => {
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../marketplaceHeadersHelper.ts',
      ),
      'utf8',
    )
    const ryt = src.indexOf('export function lookupTrustedSettingsEntryAuth')
    expect(ryt).toBeGreaterThan(0)
    const vba = src.indexOf('function settingsEntryAuthFromKnown')
    expect(vba).toBeGreaterThan(0)
    const rytBody = src.slice(ryt, src.indexOf('\nexport function', ryt + 1))
    const vbaBody = src.slice(
      vba,
      src.indexOf('\nexport function lookupTrustedSettingsEntryAuth'),
    )
    expect(rytBody).not.toContain('known_marketplaces')
    expect(rytBody).toContain('extraKnownNamed')
    expect(vbaBody).toContain("origin !== 'addDir'")
    expect(lookupTrustedSettingsEntryAuth(undefined, 'demo')).toBeUndefined()
  })

  test('pluginLoader P5r uses DNt overlay entry for J8p/G4S', () => {
    const loader = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../pluginLoader.ts'),
      'utf8',
    )
    const archiveCase = loader.indexOf("case 'archive': {")
    expect(archiveCase).toBeGreaterThan(0)
    const chunk = loader.slice(archiveCase, archiveCase + 6500)
    expect(chunk).toContain('overlayTrustedSettingsEntryAuth')
    const dnt = chunk.indexOf('overlayTrustedSettingsEntryAuth')
    const j8p = chunk.indexOf('assertEntryHeadersHelperMayRun(overlay.entry')
    const g4s = chunk.indexOf('resolvePluginArchiveHeaders')
    const g4sEntry = chunk.indexOf('overlay.entry', g4s)
    expect(j8p).toBeGreaterThan(dnt)
    expect(g4s).toBeGreaterThan(j8p)
    expect(g4sEntry).toBeGreaterThan(g4s)
  })

  test('cacheAndRegisterPlugin qhi uses g5n(DNt)', () => {
    const ayi = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../pluginInstallationHelpers.ts',
      ),
      'utf8',
    )
    const fn = ayi.indexOf('export async function cacheAndRegisterPlugin')
    const chunk = ayi.slice(fn, fn + 4500)
    const dnt = chunk.indexOf('overlayTrustedSettingsEntryAuth')
    const g5n = chunk.indexOf('getShownArchiveHeadersHelperFromOverlay')
    const qhi = chunk.indexOf('compareConsentedEntryHelper')
    expect(dnt).toBeGreaterThan(0)
    expect(g5n).toBeGreaterThan(dnt)
    expect(qhi).toBeGreaterThan(g5n)
  })

  test('G4S mints overlay entry with no source field', async () => {
    execMock.mockClear()
    const headers = await resolvePluginArchiveHeaders(
      { headersHelper: '/bin/overlay-mint' },
      {
        pluginName: 'demo',
        archiveUrl,
        runEntryHelper: true,
        requireInlinedManifest: false,
        operatorAuthored: true,
      },
    )
    expect(headers.Authorization).toBe('Bearer minted')
    expect(execMock).toHaveBeenCalled()
  })

  test('pane identity stays command + archiveUrl (no pluginId)', () => {
    expect(
      headersHelperPaneIdentity({
        command: '/bin/overlay-mint',
        archiveUrl,
      }),
    ).toBe(`/bin/overlay-mint\0${archiveUrl}`)
    expect(
      headersHelperPaneIdentity({
        command: '/bin/overlay-mint',
        archiveUrl,
      }),
    ).not.toContain('demo@')
  })
})
