/**
 * densable 2.1.238 leftover #1/#2 — SEA ggw/ayi/P5r planner + copy.
 * Pure helpers only. Do not mock pluginOperations / pluginLoader.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ENTRY_HELPER_UPDATE_ABORT_MESSAGE,
  formatClaudePluginCliInvocation,
  formatEntryHelperDeferredUpdateSkipMessage,
  formatEntryHelperDisclosure,
  formatEntryHelperPolicyRefusalMessage,
  marketplaceSourceFromKnown,
  planArchiveEntryHelperUpdate,
} from '../marketplaceHeadersHelper.js'
import type { PluginMarketplaceEntry } from '../schemas.js'

const ARCHIVE_HELPER_ENTRY = {
  name: 'demo-plugin',
  version: '2.0.0',
  strict: false,
  headersHelper: '/usr/local/bin/mint-headers',
  source: {
    source: 'archive' as const,
    url: 'https://example.com/demo.zip',
    sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  },
} satisfies Pick<
  PluginMarketplaceEntry,
  'name' | 'version' | 'strict' | 'headersHelper' | 'source'
>

const GITHUB_ENTRY = {
  name: 'demo-plugin',
  version: '1.0.0',
  source: {
    source: 'github' as const,
    repo: 'acme/demo',
  },
} satisfies Pick<PluginMarketplaceEntry, 'name' | 'version' | 'source'>

describe('formatClaudePluginCliInvocation (SEA w0/U2a)', () => {
  test('formats safe plugin ids', () => {
    expect(
      formatClaudePluginCliInvocation('plugin update', 'demo-plugin@acme'),
    ).toBe('claude plugin update demo-plugin@acme')
  })

  test('rejects unsafe ids', () => {
    expect(
      formatClaudePluginCliInvocation('plugin update', 'demo plugin'),
    ).toBeNull()
    expect(formatClaudePluginCliInvocation('plugin update', '../x')).toBeNull()
  })
})

describe('formatEntryHelperDeferredUpdateSkipMessage (SEA ggw skip)', () => {
  test('includes /plugin and cli invocation', () => {
    const msg = formatEntryHelperDeferredUpdateSkipMessage(
      'demo-plugin',
      'demo-plugin@acme',
    )
    expect(msg).toBe(
      'Skipped — "demo-plugin" fetches its archive through a headersHelper, which only runs when you update it yourself. Update it from /plugin (or `claude plugin update demo-plugin@acme`).',
    )
  })
})

describe('formatEntryHelperPolicyRefusalMessage (SEA y5n)', () => {
  test('lockdown copy names managed settings', () => {
    const msg = formatEntryHelperPolicyRefusalMessage('demo-plugin')
    expect(msg).toContain(
      '"demo-plugin" fetches its archive through a marketplace-declared headersHelper command',
    )
    expect(msg).toContain('disableCommandPluginSources / allowManagedHooksOnly')
    expect(msg).toContain('The plugin was not installed or updated')
  })

  test('remote_policy_unconsented uses O3n', () => {
    const msg = formatEntryHelperPolicyRefusalMessage(
      'demo-plugin',
      'remote_policy_unconsented',
    )
    expect(msg).toContain('headersHelper command that was not run')
    expect(msg).toContain('managed-settings server')
  })
})

describe('formatEntryHelperDisclosure (SEA BXi)', () => {
  test('uses origin destination', () => {
    expect(
      formatEntryHelperDisclosure({
        command: '/usr/local/bin/mint-headers',
        archiveUrl: 'https://example.com/demo.zip',
      }),
    ).toBe(
      "Fetching this plugin's archive sends helper-minted headers to https://example.com; the local command it runs (headersHelper) is: /usr/local/bin/mint-headers",
    )
  })
})

describe('marketplaceSourceFromKnown', () => {
  test('returns source object for name@marketplace', () => {
    const source = {
      source: 'url' as const,
      url: 'https://org.example/marketplace.json',
    }
    const got = marketplaceSourceFromKnown('demo-plugin@acme', {
      acme: { source },
    })
    expect(got.pluginName).toBe('demo-plugin')
    expect(got.marketplaceName).toBe('acme')
    expect(got.marketplaceSource).toEqual(source)
  })

  test('undefined source when marketplace missing', () => {
    const got = marketplaceSourceFromKnown('demo-plugin@acme', {})
    expect(got.marketplaceSource).toBeUndefined()
    expect(got.marketplaceName).toBe('acme')
  })
})

const URL_MARKETPLACE_SOURCE = {
  source: 'url' as const,
  url: 'https://org.example/marketplace.json',
}

describe('planArchiveEntryHelperUpdate (SEA ggw order)', () => {
  test('non-explicit helper defers with skipReason', () => {
    const plan = planArchiveEntryHelperUpdate({
      pluginId: 'demo-plugin@acme',
      pluginName: 'demo-plugin',
      entry: ARCHIVE_HELPER_ENTRY,
      installedVersion: '1.0.0',
      explicit: false,
      // SEA DNt: without marketplaceSource, settings-strip drops helper.
      marketplaceSource: URL_MARKETPLACE_SOURCE,
    })
    expect(plan.kind).toBe('skip')
    if (plan.kind === 'skip') {
      expect(plan.skipReason).toBe('entry_helper_deferred')
      expect(plan.message).toContain('Update it from /plugin')
      expect(plan.message).toContain('claude plugin update demo-plugin@acme')
    }
  })

  test('non-explicit helper already at declared version is up_to_date', () => {
    const plan = planArchiveEntryHelperUpdate({
      pluginId: 'demo-plugin@acme',
      pluginName: 'demo-plugin',
      entry: ARCHIVE_HELPER_ENTRY,
      installedVersion: '2.0.0',
      explicit: false,
      marketplaceSource: URL_MARKETPLACE_SOURCE,
    })
    expect(plan).toEqual({ kind: 'up_to_date', version: '2.0.0' })
  })

  test('non-explicit helper without entry.version uses archive sha256 12-hex', () => {
    const { version: _v, ...noVersion } = ARCHIVE_HELPER_ENTRY
    const plan = planArchiveEntryHelperUpdate({
      pluginId: 'demo-plugin@acme',
      pluginName: 'demo-plugin',
      entry: noVersion,
      installedVersion: 'abcdef012345',
      explicit: false,
      marketplaceSource: URL_MARKETPLACE_SOURCE,
    })
    expect(plan).toEqual({ kind: 'up_to_date', version: 'abcdef012345' })
  })

  test('explicit helper runs', () => {
    const plan = planArchiveEntryHelperUpdate({
      pluginId: 'demo-plugin@acme',
      pluginName: 'demo-plugin',
      entry: ARCHIVE_HELPER_ENTRY,
      installedVersion: '1.0.0',
      explicit: true,
      marketplaceSource: URL_MARKETPLACE_SOURCE,
    })
    expect(plan).toEqual({ kind: 'run', runEntryHelper: true })
  })

  test('github source is not deferred', () => {
    const plan = planArchiveEntryHelperUpdate({
      pluginId: 'demo-plugin@acme',
      pluginName: 'demo-plugin',
      entry: GITHUB_ENTRY,
      installedVersion: '1.0.0',
      explicit: false,
      marketplaceSource: URL_MARKETPLACE_SOURCE,
    })
    expect(plan).toEqual({ kind: 'run', runEntryHelper: false })
  })

  test('missing marketplaceSource strips catalog helper (SEA DNt settings path)', () => {
    const plan = planArchiveEntryHelperUpdate({
      pluginId: 'demo-plugin@acme',
      pluginName: 'demo-plugin',
      entry: ARCHIVE_HELPER_ENTRY,
      installedVersion: '1.0.0',
      explicit: false,
    })
    expect(plan).toEqual({ kind: 'run', runEntryHelper: false })
  })
})

describe('ENTRY_HELPER_UPDATE_ABORT_MESSAGE (SEA ggw abort)', () => {
  test('matches densable abort copy', () => {
    expect(ENTRY_HELPER_UPDATE_ABORT_MESSAGE).toBe(
      'Aborted — the headersHelper command was not confirmed, so it was not run.',
    )
  })
})

describe('leftover #1+#2 gold-hard bind (source, densable 2.1.238)', () => {
  test('LSP recommendation is explicitInstall:!1 (runEntryHelper: false)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../hooks/useLspPluginRecommendation.tsx'),
      'utf8',
    )
    expect(src).toContain('{ runEntryHelper: false }')
    expect(src).toContain('explicitInstall:!1')
    expect(src).not.toMatch(/runEntryHelper:\s*true/)
  })

  test('CLI install binds shownEntryHelper into zgh; missing shown + helper is unconfirmed', () => {
    const handler = readFileSync(
      join(import.meta.dir, '../../../cli/handlers/plugins.ts'),
      'utf8',
    )
    expect(handler).toContain("headersHelperConsent?.kind === 'accepted'")
    expect(handler).toContain('archiveUrl: headersHelperConsent.archiveUrl')

    const ops = readFileSync(
      join(import.meta.dir, '../../../services/plugins/pluginOperations.ts'),
      'utf8',
    )
    expect(ops).toContain('shownEntryHelper?: HeadersHelperPaneShown')
    expect(ops).toContain('formatEntryHelperCliUnconfirmedMessage(helper)')
    expect(ops).toContain('consented: options?.consentedEntryHelper')

    const manage = readFileSync(
      join(import.meta.dir, '../../../commands/plugin/ManagePlugins.tsx'),
      'utf8',
    )
    expect(manage).toContain('consentedEntryHelper: headersHelperPane.pinned()')
    expect(manage).toContain(
      'SEA `_in(..., {explicit:!0, consentedEntryHelper: pinned()})`',
    )
  })

  test('ayi qhi runs only when runEntryHelper; pane dwo is per-view not a Map', () => {
    const install = readFileSync(
      join(import.meta.dir, '../pluginInstallationHelpers.ts'),
      'utf8',
    )
    expect(install).toContain('compareConsentedEntryHelper')
    expect(install).toContain('consented: options?.consentedEntryHelper')

    const helper = readFileSync(
      join(import.meta.dir, '../marketplaceHeadersHelper.ts'),
      'utf8',
    )
    expect(helper).not.toContain('headersHelperPaneShown')
    expect(helper).toContain('export function headersHelperPaneIdentity')
    expect(helper).toContain('export function compareConsentedEntryHelper')

    const details = readFileSync(
      join(
        import.meta.dir,
        '../../../commands/plugin/pluginDetailsHelpers.tsx',
      ),
      'utf8',
    )
    expect(details).toContain('export function useHeadersHelperPaneConsent')
    expect(details).toContain('ref.current = null')
    expect(details).not.toContain('headersHelperPaneShown')
  })
})
