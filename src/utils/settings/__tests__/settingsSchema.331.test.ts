import { describe, expect, test } from 'bun:test'
import { generateSettingsSchemaObject } from '../../../skills/bundled/updateConfig.js'
import { generateSettingsJSONSchema } from '../schemaOutput.js'
import { type SettingsJson, SettingsSchema } from '../types.js'
import { validateSettingsFileContent } from '../validation.js'

const OFFICIAL_331_ADDED_KEYS = [
  'additionalDirectoryConfigRoots',
  'additionalMarketplaces',
  'allowClaudeInChromeWithManagedMcp',
  'allowNestedModelAccessUnderForceLogin',
  'allowedMarketplaces',
  'autoCompactOfferAnswer',
  'autoCompactRaisedForLoad',
  'breakReminder',
  'daemonColdStart',
  'desktopMcpServersListScope',
  'disableReplyCheck',
  'disableWindowsBashCommandSplit',
  'doneMeansMerged',
  'downloadsMirrorUrl',
  'footerLinksRegexes',
  'gatewayInternalNetworks',
  'isolatePeerMachines',
  'managedMcpServers',
  'modelCatalogPublicKey',
  'modelCatalogUrl',
  'policyHelper',
  'policyHelpers',
  'prUrlTemplate',
  'precomputeArmTokens',
  'quietHours',
  'remoteControl',
  'responseComparisonEnabled',
  'sshHostCommands',
  'syncClaudeAiPlugins',
  'wslInheritsWindowsSettings',
] as const

function parseStrict(input: Record<string, unknown>) {
  return SettingsSchema().strict().safeParse(input)
}

describe('SettingsSchema 2.1.331 top-level keys', () => {
  test('exposes all 30 missing official 2.1.331 keys on SettingsSchema.shape', () => {
    const shape = SettingsSchema().shape
    for (const key of OFFICIAL_331_ADDED_KEYS) {
      expect(key in shape).toBe(true)
    }
    expect(OFFICIAL_331_ADDED_KEYS).toHaveLength(30)
  })

  test('validateSettingsFileContent accepts a settings.json containing all 30 keys together', () => {
    const fullDoc: SettingsJson = {
      additionalDirectoryConfigRoots: {
        '/workspace/extra': '/workspace/checkout',
      },
      additionalMarketplaces: {
        team: {
          source: { source: 'github', repo: 'org/plugins' },
        },
      },
      allowClaudeInChromeWithManagedMcp: true,
      allowNestedModelAccessUnderForceLogin: false,
      allowedMarketplaces: [{ source: 'github', repo: 'org/*' }],
      autoCompactOfferAnswer: {
        model: 'claude-opus-4-6',
        choice: 'accept',
        tokens: 200_000,
        at: 1_700_000_000_000,
      },
      autoCompactRaisedForLoad: true,
      breakReminder: {
        enabled: true,
        intervalMinutes: 30,
        breakThresholdMinutes: 10,
        message: 'Time for a quick stretch.',
      },
      daemonColdStart: 'transient',
      desktopMcpServersListScope: 'code',
      disableReplyCheck: true,
      disableWindowsBashCommandSplit: false,
      doneMeansMerged: true,
      downloadsMirrorUrl: 'https://claude.fedstart.com/claude-downloads',
      footerLinksRegexes: [
        {
          type: 'regex',
          pattern: 'TICKET-(?<id>\\d+)',
          url: 'https://tracker.example.com/issue/{id}',
          label: 'Ticket #{id}',
        },
      ],
      gatewayInternalNetworks: ['203.0.113.0/24'],
      isolatePeerMachines: true,
      managedMcpServers: {
        corp_docs: {
          type: 'http',
          url: 'https://mcp.example.com/docs',
          headers: { 'X-Org': 'acme' },
        },
      },
      modelCatalogPublicKey:
        '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n-----END PUBLIC KEY-----',
      modelCatalogUrl: 'https://mirror.example.com/model-catalog/catalog.json',
      policyHelper: {
        path: '/usr/local/bin/claude-policy-helper',
        timeoutMs: 5000,
        refreshIntervalMs: 60_000,
      },
      policyHelpers: {
        macos: { path: '/usr/local/bin/policy-helper' },
        linux: { script: 'echo "{}"', interpreter: 'sh' },
        windows: { path: 'C:\\Program Files\\Claude\\policy-helper.exe' },
        wsl: { defaultSettings: { disableAllHooks: true } },
        default: { disableRemoteControl: true },
      },
      prUrlTemplate: 'https://reviews.example.com/{owner}/{repo}/pull/{number}',
      precomputeArmTokens: 150_000,
      quietHours: {
        enabled: true,
        start: '22:00',
        end: '07:00',
      },
      remoteControl: {
        shareHostProfile: 'basic',
      },
      responseComparisonEnabled: false,
      sshHostCommands: [
        {
          id: 'devbox',
          name: 'Dev Box',
          command: '/usr/local/bin/get-host --env dev',
        },
      ],
      syncClaudeAiPlugins: false,
      wslInheritsWindowsSettings: true,
    }

    const strictParsed = parseStrict(fullDoc)
    expect(strictParsed.success).toBe(true)

    const validated = validateSettingsFileContent(JSON.stringify(fullDoc))
    expect(validated.isValid).toBe(true)

    // Unknown top-level keys are still rejected in strict mode
    const typo = validateSettingsFileContent(
      JSON.stringify({ unknownFutureKey331: true }),
    )
    expect(typo.isValid).toBe(false)
  })

  test('boolean keys accept booleans and reject non-booleans', () => {
    const strictBooleanKeys = [
      'allowClaudeInChromeWithManagedMcp',
      'allowNestedModelAccessUnderForceLogin',
      'disableReplyCheck',
      'disableWindowsBashCommandSplit',
      'doneMeansMerged',
      'isolatePeerMachines',
      'responseComparisonEnabled',
      'syncClaudeAiPlugins',
      'wslInheritsWindowsSettings',
    ] as const

    for (const key of strictBooleanKeys) {
      const okTrue = parseStrict({ [key]: true })
      expect(okTrue.success).toBe(true)
      if (okTrue.success) expect(okTrue.data[key]).toBe(true)

      const okFalse = parseStrict({ [key]: false })
      expect(okFalse.success).toBe(true)
      if (okFalse.success) expect(okFalse.data[key]).toBe(false)

      expect(parseStrict({ [key]: 'true' }).success).toBe(false)
      expect(parseStrict({ [key]: 1 }).success).toBe(false)
      expect(parseStrict({ [key]: null }).success).toBe(false)
    }
  })

  test('string keys accept strings and reject non-strings', () => {
    const strictStringKeys = [
      'downloadsMirrorUrl',
      'modelCatalogPublicKey',
      'modelCatalogUrl',
      'prUrlTemplate',
    ] as const

    for (const key of strictStringKeys) {
      const ok = parseStrict({ [key]: 'https://example.com/resource' })
      expect(ok.success).toBe(true)
      if (ok.success) expect(ok.data[key]).toBe('https://example.com/resource')

      expect(parseStrict({ [key]: 42 }).success).toBe(false)
      expect(parseStrict({ [key]: true }).success).toBe(false)
      expect(parseStrict({ [key]: ['https://example.com'] }).success).toBe(
        false,
      )
    }
  })

  test('additionalDirectoryConfigRoots parses string map and catches invalid entries/values', () => {
    const ok = parseStrict({
      additionalDirectoryConfigRoots: { '/a': '/b', '/c': '/d' },
    })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.data.additionalDirectoryConfigRoots).toEqual({
        '/a': '/b',
        '/c': '/d',
      })
    }

    const innerInvalid = parseStrict({
      additionalDirectoryConfigRoots: { '/a': 123, '/ok': '/root' },
    })
    expect(innerInvalid.success).toBe(true)
    if (innerInvalid.success) {
      expect(innerInvalid.data.additionalDirectoryConfigRoots).toEqual({
        '/a': '',
        '/ok': '/root',
      })
    }

    const outerInvalid = parseStrict({
      additionalDirectoryConfigRoots: 'not-a-record',
    })
    expect(outerInvalid.success).toBe(true)
    if (outerInvalid.success) {
      expect(outerInvalid.data.additionalDirectoryConfigRoots).toBeUndefined()
    }
  })

  test('additionalMarketplaces parses valid marketplaces and rejects invalid or mismatched settings names', () => {
    const okGithub = parseStrict({
      additionalMarketplaces: {
        team: { source: { source: 'github', repo: 'acme/plugins' } },
      },
    })
    expect(okGithub.success).toBe(true)

    const okSettings = parseStrict({
      additionalMarketplaces: {
        inlineMkt: {
          source: { source: 'settings', name: 'inlineMkt', plugins: [] },
        },
      },
    })
    expect(okSettings.success).toBe(true)

    const mismatched = parseStrict({
      additionalMarketplaces: {
        keyA: {
          source: { source: 'settings', name: 'keyB', plugins: [] },
        },
      },
    })
    expect(mismatched.success).toBe(false)
    if (!mismatched.success) {
      expect(mismatched.error.issues[0]?.message).toContain(
        'additionalMarketplaces',
      )
    }

    expect(parseStrict({ additionalMarketplaces: [] }).success).toBe(false)
    expect(
      parseStrict({
        additionalMarketplaces: { bad: { source: { source: 'unknown' } } },
      }).success,
    ).toBe(false)
  })

  test('allowedMarketplaces parses marketplace source arrays and rejects invalid inputs', () => {
    const ok = parseStrict({
      allowedMarketplaces: [
        { source: 'github', repo: 'acme/*' },
        { source: 'url', url: 'https://plugins.example.com/marketplace.json' },
      ],
    })
    expect(ok.success).toBe(true)

    expect(parseStrict({ allowedMarketplaces: 'acme/*' }).success).toBe(false)
    expect(
      parseStrict({
        allowedMarketplaces: [{ source: 'nonexistent', value: 'x' }],
      }).success,
    ).toBe(false)
  })

  test('autoCompactOfferAnswer parses valid answers and catches invalid shapes to undefined', () => {
    for (const choice of ['accept', 'keep', 'undo'] as const) {
      const ok = parseStrict({
        autoCompactOfferAnswer: {
          model: 'claude-sonnet-4-6',
          choice,
          tokens: 180_000,
          at: 1_700_000_000_000,
        },
      })
      expect(ok.success).toBe(true)
      if (ok.success) {
        expect(ok.data.autoCompactOfferAnswer?.choice).toBe(choice)
      }
    }

    const invalidCases = [
      { model: '', choice: 'accept', tokens: 100, at: 1 },
      { model: 'm'.repeat(201), choice: 'accept', tokens: 100, at: 1 },
      { model: 'opus', choice: 'dismiss', tokens: 100, at: 1 },
      { model: 'opus', choice: 'accept', tokens: 0, at: 1 },
      { model: 'opus', choice: 'accept', tokens: 100.5, at: 1 },
      { model: 'opus', choice: 'accept', tokens: 100, at: -5 },
      'not-an-object',
    ]
    for (const bad of invalidCases) {
      const parsed = parseStrict({ autoCompactOfferAnswer: bad })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.autoCompactOfferAnswer).toBeUndefined()
      }
    }
  })

  test('autoCompactRaisedForLoad parses booleans and catches invalid values to undefined', () => {
    const ok = parseStrict({ autoCompactRaisedForLoad: true })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.autoCompactRaisedForLoad).toBe(true)

    const bad = parseStrict({ autoCompactRaisedForLoad: 'yes' })
    expect(bad.success).toBe(true)
    if (bad.success) expect(bad.data.autoCompactRaisedForLoad).toBeUndefined()
  })

  test('breakReminder validates fields and rejects invalid values', () => {
    const ok = parseStrict({
      breakReminder: {
        enabled: true,
        intervalMinutes: 45,
        breakThresholdMinutes: 15,
        message: 'Take a walk',
      },
    })
    expect(ok.success).toBe(true)

    expect(parseStrict({ breakReminder: {} }).success).toBe(true)
    expect(parseStrict({ breakReminder: true }).success).toBe(false)
    expect(parseStrict({ breakReminder: { intervalMinutes: 0 } }).success).toBe(
      false,
    )
    expect(
      parseStrict({ breakReminder: { intervalMinutes: 12.5 } }).success,
    ).toBe(false)
    expect(
      parseStrict({ breakReminder: { breakThresholdMinutes: -1 } }).success,
    ).toBe(false)
    expect(parseStrict({ breakReminder: { enabled: 'true' } }).success).toBe(
      false,
    )
    expect(parseStrict({ breakReminder: { message: 123 } }).success).toBe(false)
  })

  test('daemonColdStart accepts transient|ask and rejects other values', () => {
    expect(parseStrict({ daemonColdStart: 'transient' }).success).toBe(true)
    expect(parseStrict({ daemonColdStart: 'ask' }).success).toBe(true)
    expect(parseStrict({ daemonColdStart: 'persistent' }).success).toBe(false)
    expect(parseStrict({ daemonColdStart: true }).success).toBe(false)
  })

  test('desktopMcpServersListScope accepts strings and catches non-strings to "all"', () => {
    for (const val of ['code', 'all', 'off', 'custom-future']) {
      const ok = parseStrict({ desktopMcpServersListScope: val })
      expect(ok.success).toBe(true)
      if (ok.success) expect(ok.data.desktopMcpServersListScope).toBe(val)
    }

    for (const bad of [123, true, null, ['all']]) {
      const parsed = parseStrict({ desktopMcpServersListScope: bad })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.desktopMcpServersListScope).toBe('all')
      }
    }
  })

  test('footerLinksRegexes preserves regex and unknown variants and strips invalid entries', () => {
    const parsed = parseStrict({
      footerLinksRegexes: [
        {
          type: 'regex',
          pattern: 'PR-(?<n>\\d+)',
          url: 'https://example.com/pr/{n}',
          label: 'PR {n}',
          extraField: 'kept-by-passthrough',
        },
        {
          type: 'future-variant',
          customPayload: { a: 1 },
        },
        123,
        { missingType: true },
        null,
      ],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.footerLinksRegexes).toEqual([
        {
          type: 'regex',
          pattern: 'PR-(?<n>\\d+)',
          url: 'https://example.com/pr/{n}',
          label: 'PR {n}',
          extraField: 'kept-by-passthrough',
        },
        {
          type: 'future-variant',
          customPayload: { a: 1 },
        },
      ])
    }

    const nonArray = parseStrict({ footerLinksRegexes: 'invalid' })
    expect(nonArray.success).toBe(true)
    if (nonArray.success) {
      expect(nonArray.data.footerLinksRegexes).toBeUndefined()
    }
  })

  test('gatewayInternalNetworks accepts string arrays and catches invalid values to ["(unreadable)"]', () => {
    const ok = parseStrict({
      gatewayInternalNetworks: ['198.51.100.0/24', '203.0.113.0/24'],
    })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.data.gatewayInternalNetworks).toEqual([
        '198.51.100.0/24',
        '203.0.113.0/24',
      ])
    }

    for (const bad of [
      '198.51.100.0/24',
      [123],
      null,
      { cidr: '1.2.3.4/32' },
    ]) {
      const parsed = parseStrict({ gatewayInternalNetworks: bad })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.gatewayInternalNetworks).toEqual(['(unreadable)'])
      }
    }
  })

  test('managedMcpServers accepts http/streamable-http/sse https servers and enforces strict security checks', () => {
    const ok = parseStrict({
      managedMcpServers: {
        http_srv: {
          type: 'streamable-http',
          url: 'https://mcp.example.com/api',
          headers: { Authorization: 'Bearer literal-token' },
          request_timeout_ms: 500_000,
          orgMaxPermission: 'allow',
          toolPermissions: { search: 'allow', delete: 'blocked' },
        },
        sse_srv: {
          type: 'sse',
          url: 'https://sse.example.com/events',
          oauth: {
            clientId: 'client-1',
            authServerMetadataUrl:
              'https://auth.example.com/.well-known/oauth-authorization-server',
            scopes: 'read write',
          },
        },
      },
    })
    expect(ok.success).toBe(true)
    if (ok.success) {
      const httpSrv = ok.data.managedMcpServers?.http_srv
      expect(httpSrv?.type).toBe('http')
      expect(httpSrv?.timeout).toBe(300_000)
      expect(httpSrv?.orgMaxPermission).toBeUndefined()
      expect(ok.data.managedMcpServers?.sse_srv?.type).toBe('sse')
    }

    // Rejects Desktop array form with helpful error
    const arrayForm = parseStrict({
      managedMcpServers: [
        { name: 'corp', transport: 'http', url: 'https://mcp.example.com' },
      ],
    })
    expect(arrayForm.success).toBe(false)
    if (!arrayForm.success) {
      expect(arrayForm.error.issues[0]?.message).toContain(
        'object keyed by server name',
      )
    }

    // Rejects reserved or invalid server names
    for (const badName of [
      'bad name',
      'constructor',
      'prototype',
      '__defineGetter__',
      '__defineSetter__',
      '__lookupGetter__',
      '__lookupSetter__',
    ]) {
      expect(
        parseStrict({
          managedMcpServers: {
            [badName]: { type: 'http', url: 'https://mcp.example.com' },
          },
        }).success,
      ).toBe(false)
    }
    // Zod v4 z.record strips own "__proto__" keys rather than keeping them
    const protoJson = JSON.parse(
      '{"managedMcpServers":{"__proto__":{"type":"http","url":"https://mcp.example.com"}}}',
    ) as Record<string, unknown>
    const protoParsed = parseStrict(protoJson)
    expect(protoParsed.success).toBe(true)
    if (protoParsed.success) {
      expect(Object.keys(protoParsed.data.managedMcpServers ?? {})).toEqual([])
    }

    // Rejects stdio, command/args/env/headersHelper, non-https URL, ${VAR}, control chars
    expect(
      parseStrict({
        managedMcpServers: {
          local: { type: 'stdio', command: 'node', args: ['srv.js'] },
        },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        managedMcpServers: {
          withHelper: {
            type: 'http',
            url: 'https://mcp.example.com',
            headersHelper: '/usr/bin/helper',
          },
        },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        managedMcpServers: {
          plainHttp: { type: 'http', url: 'http://mcp.example.com' },
        },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        managedMcpServers: {
          envVar: {
            type: 'http',
            url: 'https://mcp.example.com',
            headers: { Authorization: 'Bearer ${SECRET_TOKEN}' },
          },
        },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        managedMcpServers: {
          escapeSeq: {
            type: 'http',
            url: 'https://mcp.example.com',
            headers: { 'X-Bad': 'val\u001b[31m' },
          },
        },
      }).success,
    ).toBe(false)
  })

  test('policyHelper validates paths, timeouts, null-clearing, and rejects invalid shapes', () => {
    const ok = parseStrict({
      policyHelper: {
        path: '/usr/local/bin/helper',
        timeoutMs: 9_999_999_999,
        refreshIntervalMs: 0,
      },
    })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.data.policyHelper).toEqual({
        path: '/usr/local/bin/helper',
        timeoutMs: 2_147_483_647,
        refreshIntervalMs: 0,
      })
    }

    // null or { path: null } clears policyHelper
    const clearedNull = parseStrict({ policyHelper: null })
    expect(clearedNull.success).toBe(true)
    if (clearedNull.success)
      expect(clearedNull.data.policyHelper).toBeUndefined()

    const clearedPathNull = parseStrict({ policyHelper: { path: null } })
    expect(clearedPathNull.success).toBe(true)
    if (clearedPathNull.success) {
      expect(clearedPathNull.data.policyHelper).toBeUndefined()
    }

    // Nullable optional subfields
    const nullableSub = parseStrict({
      policyHelper: {
        path: '/usr/local/bin/helper',
        timeoutMs: null,
        refreshIntervalMs: null,
      },
    })
    expect(nullableSub.success).toBe(true)

    // Invalid shapes rejected
    expect(parseStrict({ policyHelper: {} }).success).toBe(false)
    expect(parseStrict({ policyHelper: '/usr/local/bin/helper' }).success).toBe(
      false,
    )
    expect(
      parseStrict({
        policyHelper: { path: '/usr/local/bin/helper', timeoutMs: 500 },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        policyHelper: {
          path: '/usr/local/bin/helper',
          refreshIntervalMs: 1000,
        },
      }).success,
    ).toBe(false)
  })

  test('policyHelpers validates per-OS entries, paths, scripts, retries, and default payload rules', () => {
    const ok = parseStrict({
      policyHelpers: {
        macos: {
          path: '/usr/local/bin/policy-helper',
          outputBehavior: 'merge',
          onFailure: 'continue',
          retries: 10,
          defaultSettings: { disableAllHooks: true },
        },
        linux: {
          script: 'echo "{}"',
          interpreter: 'sh',
          onFailure: 'unknown-falls-back-to-refuse',
        },
        windows: {
          path: 'C:\\Program Files\\Claude\\policy-helper.ps1',
          timeoutMs: 10_000,
          refreshIntervalMs: 120_000,
        },
        wsl: { path: null },
        default: { disableRemoteControl: true },
      },
    })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.data.policyHelpers?.macos?.retries).toBe(5)
      expect(ok.data.policyHelpers?.linux?.onFailure).toBe('refuse')
      expect(ok.data.policyHelpers?.wsl).toBeUndefined()
      expect(ok.data.policyHelpers?.default).toEqual({
        disableRemoteControl: true,
      })
    }

    // null clears whole key or individual slots
    expect(parseStrict({ policyHelpers: null }).success).toBe(true)
    expect(
      parseStrict({ policyHelpers: { macos: null, default: null } }).success,
    ).toBe(true)

    // Invalid combinations and platform constraints
    expect(parseStrict({ policyHelpers: { macos: {} } }).success).toBe(false)
    expect(
      parseStrict({
        policyHelpers: {
          macos: {
            path: '/usr/local/bin/helper',
            script: 'echo {}',
            interpreter: 'sh',
          },
        },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        policyHelpers: { linux: { script: 'echo {}' } },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        policyHelpers: {
          macos: { script: 'echo {}', interpreter: 'pwsh' },
        },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        policyHelpers: {
          windows: { script: 'echo {}', interpreter: 'sh' },
        },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        policyHelpers: {
          windows: { script: 'Write-Output "café"', interpreter: 'pwsh' },
        },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        policyHelpers: {
          windows: { path: 'C:\\Tools\\helper.bat' },
        },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        policyHelpers: {
          windows: { path: 'C:\\Tools\\helper[1].ps1' },
        },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        policyHelpers: {
          windows: { path: '\\\\server\\share\\helper.exe' },
        },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        policyHelpers: {
          linux: { path: 'relative/helper' },
        },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        policyHelpers: {
          linux: { path: '/usr/../bin/helper' },
        },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        policyHelpers: {
          linux: { path: '/proc/self/exe' },
        },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        policyHelpers: {
          macos: { path: '/Network/Servers/files/helper' },
        },
      }).success,
    ).toBe(false)
    expect(
      parseStrict({
        policyHelpers: {
          macos: { path: '/.vol/123/helper' },
        },
      }).success,
    ).toBe(false)

    // Default static payload rejections
    for (const badDefault of [
      { policyHelper: { path: '/usr/bin/x' } },
      { policyHelpers: {} },
      { path: '/usr/bin/x' },
      { managedSettings: { model: 'opus' } },
      { macos: { path: '/usr/bin/x' } },
    ]) {
      expect(
        parseStrict({ policyHelpers: { default: badDefault } }).success,
      ).toBe(false)
    }
  })

  test('precomputeArmTokens accepts positive ints and catches invalid values to undefined', () => {
    const ok = parseStrict({ precomputeArmTokens: 120_000 })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.precomputeArmTokens).toBe(120_000)

    for (const bad of [0, -100, 1.5, '120000', null]) {
      const parsed = parseStrict({ precomputeArmTokens: bad })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.precomputeArmTokens).toBeUndefined()
      }
    }
  })

  test('quietHours validates HH:MM format and rejects invalid values', () => {
    expect(
      parseStrict({
        quietHours: { enabled: true, start: '22:00', end: '07:00' },
      }).success,
    ).toBe(true)
    expect(
      parseStrict({
        quietHours: { start: '9:05', end: '23:59' },
      }).success,
    ).toBe(true)
    expect(parseStrict({ quietHours: {} }).success).toBe(true)

    expect(parseStrict({ quietHours: true }).success).toBe(false)
    expect(parseStrict({ quietHours: { start: '24:00' } }).success).toBe(false)
    expect(parseStrict({ quietHours: { end: '07:60' } }).success).toBe(false)
    expect(parseStrict({ quietHours: { start: '10pm' } }).success).toBe(false)
    expect(parseStrict({ quietHours: { enabled: 'yes' } }).success).toBe(false)
  })

  test('remoteControl validates object shape and shareHostProfile enum with catch fallback', () => {
    for (const profile of ['off', 'basic', 'full'] as const) {
      const ok = parseStrict({ remoteControl: { shareHostProfile: profile } })
      expect(ok.success).toBe(true)
      if (ok.success) {
        expect(ok.data.remoteControl?.shareHostProfile).toBe(profile)
      }
    }

    const unknownProfile = parseStrict({
      remoteControl: { shareHostProfile: 'verbose-future' },
    })
    expect(unknownProfile.success).toBe(true)
    if (unknownProfile.success) {
      expect(
        unknownProfile.data.remoteControl?.shareHostProfile,
      ).toBeUndefined()
    }

    expect(parseStrict({ remoteControl: 'basic' }).success).toBe(false)
    expect(parseStrict({ remoteControl: true }).success).toBe(false)
  })

  test('sshHostCommands accepts Desktop command entries as unknown and exposes type:"array" meta in JSON Schema', () => {
    const ok = parseStrict({
      sshHostCommands: [
        {
          id: 'dev',
          name: 'Dev Host',
          command: '/usr/local/bin/resolve-host',
          sshIdentityFile: '~/.ssh/id_ed25519',
          startDirectory: '~/src',
        },
      ],
    })
    expect(ok.success).toBe(true)

    const schemaObj = generateSettingsSchemaObject()
    expect(schemaObj.properties?.sshHostCommands?.type).toBe('array')
  })

  test('JSON Schema generation succeeds cleanly and strips @internal keys', () => {
    const jsonSchemaStr = generateSettingsJSONSchema()
    const parsed = JSON.parse(jsonSchemaStr) as {
      properties?: Record<string, unknown>
    }
    expect(parsed.properties).toBeDefined()

    // Public (non-@internal) newly added keys are emitted
    expect(parsed.properties?.additionalMarketplaces).toBeDefined()
    expect(parsed.properties?.allowedMarketplaces).toBeDefined()
    expect(parsed.properties?.allowClaudeInChromeWithManagedMcp).toBeDefined()
    expect(parsed.properties?.daemonColdStart).toBeDefined()
    expect(parsed.properties?.downloadsMirrorUrl).toBeDefined()
    expect(parsed.properties?.footerLinksRegexes).toBeDefined()
    expect(parsed.properties?.gatewayInternalNetworks).toBeDefined()
    expect(parsed.properties?.managedMcpServers).toBeDefined()
    expect(parsed.properties?.policyHelper).toBeDefined()
    expect(parsed.properties?.prUrlTemplate).toBeDefined()
    expect(parsed.properties?.sshHostCommands).toBeDefined()
    expect(parsed.properties?.syncClaudeAiPlugins).toBeDefined()
    expect(parsed.properties?.wslInheritsWindowsSettings).toBeDefined()

    // @internal newly added keys are stripped from the public JSON schema
    expect(parsed.properties?.additionalDirectoryConfigRoots).toBeUndefined()
    expect(parsed.properties?.autoCompactOfferAnswer).toBeUndefined()
    expect(parsed.properties?.autoCompactRaisedForLoad).toBeUndefined()
    expect(parsed.properties?.breakReminder).toBeUndefined()
    expect(parsed.properties?.doneMeansMerged).toBeUndefined()
    expect(parsed.properties?.modelCatalogPublicKey).toBeUndefined()
    expect(parsed.properties?.modelCatalogUrl).toBeUndefined()
    expect(parsed.properties?.policyHelpers).toBeUndefined()
    expect(parsed.properties?.precomputeArmTokens).toBeUndefined()
    expect(parsed.properties?.quietHours).toBeUndefined()
    expect(parsed.properties?.remoteControl).toBeUndefined()
    expect(parsed.properties?.responseComparisonEnabled).toBeUndefined()
  })
})
