import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const settingsSrc = readFileSync(
  join(import.meta.dir, '../Settings.tsx'),
  'utf8',
)
const configSrc = readFileSync(join(import.meta.dir, '../Config.tsx'), 'utf8')
const statusSrc = readFileSync(join(import.meta.dir, '../Status.tsx'), 'utf8')
const statusUtilSrc = readFileSync(
  join(import.meta.dir, '../../../utils/status.tsx'),
  'utf8',
)
const usageSrc = readFileSync(join(import.meta.dir, '../Usage.tsx'), 'utf8')
const statsSrc = readFileSync(join(import.meta.dir, '../../Stats.tsx'), 'utf8')
const mcpSettingsSrc = readFileSync(
  join(import.meta.dir, '../../mcp/MCPSettings.tsx'),
  'utf8',
)
const mcpListPanelSrc = readFileSync(
  join(import.meta.dir, '../../mcp/MCPListPanel.tsx'),
  'utf8',
)
const mcpStdioMenuSrc = readFileSync(
  join(import.meta.dir, '../../mcp/MCPStdioServerMenu.tsx'),
  'utf8',
)
const mcpToolListSrc = readFileSync(
  join(import.meta.dir, '../../mcp/MCPToolListView.tsx'),
  'utf8',
)
const mcpToolDetailSrc = readFileSync(
  join(import.meta.dir, '../../mcp/MCPToolDetailView.tsx'),
  'utf8',
)

describe('densable 2.1.289 Settings pane', () => {
  test('tabs are Status / Config / Usage / Stats with Settings title', () => {
    expect(settingsSrc).toContain('title="Settings"')
    expect(settingsSrc).toContain('title="Status"')
    expect(settingsSrc).toContain('title="Config"')
    expect(settingsSrc).toContain('title="Usage"')
    expect(settingsSrc).toContain('title="Stats"')
    expect(settingsSrc).toContain('<Stats onClose={onClose} />')
  })

  test('ceded Esc while Config content owns it and while Stats is selected', () => {
    expect(settingsSrc).toContain("selectedTab === 'Config' && configOwnsEsc")
    expect(settingsSrc).toContain("selectedTab !== 'Stats'")
    expect(settingsSrc).toContain('Settings dialog dismissed')
  })
})

describe('densable 2.1.289 Config Esc/search', () => {
  test('owns Esc while header is unfocused (not only in search)', () => {
    expect(configSrc).toContain('const ownsEsc = !headerFocused')
    expect(configSrc).not.toContain(
      'const ownsEsc = isSearchMode && !headerFocused',
    )
  })

  test('first Esc in search clears then exits without closing the pane', () => {
    expect(configSrc).toContain("if (e.key === 'escape')")
    expect(configSrc).toContain('setSearchQuery')
    expect(configSrc).toContain('setSearchModeSync(false)')
    expect(configSrc).toContain("e.key === '/' ? '' : e.key")
  })
})

describe('densable 2.1.289 Status rows', () => {
  test('Auto mode server + System diagnostics heading', () => {
    expect(statusSrc).toContain('buildAutoModeServerProperties')
    expect(statusSrc).toContain('System diagnostics')
    expect(statusSrc).not.toContain('System Diagnostics')
  })

  test('status util has gold Dfo/Mfo labels', () => {
    expect(statusUtilSrc).toContain("label: 'Auto mode server'")
    expect(statusUtilSrc).toContain("label: 'Managed settings (remote)'")
    expect(statusUtilSrc).toContain("label: 'Organization policy'")
    expect(statusUtilSrc).toContain("'Enabled'")
    expect(statusUtilSrc).toContain("'Disabled'")
  })

  test('remote/cloud viewer banner is rendered at top of Status', () => {
    expect(statusSrc).toContain(
      "Model and cwd are the {isCloud ? 'cloud' : 'remote'} session&apos;s; the other rows describe this terminal.",
    )
    expect(statusSrc).toContain('/mcp asks the session too.')
  })
})

describe('densable 2.1.289 Config submenus, search, safe-mode, and rc channel', () => {
  test('enum options are matched by search filter', () => {
    expect(configSrc).toContain("if (setting.type === 'enum')")
    expect(configSrc).toContain(
      'setting.options.some(opt => opt.toLowerCase().includes(lowerQuery))',
    )
  })

  test('AgentsView, RemoteHomeSettings, and TextEdit submenus are wired', () => {
    expect(configSrc).toContain("setShowSubmenu('AgentsView')")
    expect(configSrc).toContain("showSubmenu === 'AgentsView'")
    expect(configSrc).toContain('title="Agents view"')
    expect(configSrc).toContain("setShowSubmenu('RemoteHomeSettings')")
    expect(configSrc).toContain("showSubmenu === 'RemoteHomeSettings'")
    expect(configSrc).toContain('enableRemoteHomeSettingsFromConfigPanel')
    expect(configSrc).toContain(
      'title="Use this machine\'s settings in cloud sessions?"',
    )
    expect(configSrc).toContain(
      "setting.provided !== undefined && setting.type === 'managedEnum'",
    )
    expect(configSrc).toContain("setShowSubmenu('TextEdit')")
    expect(configSrc).toContain("showSubmenu === 'TextEdit' && textEditSetting")
    expect(configSrc).toContain(
      "textEditSetting.optionsHint ?? 'Not a value it takes'",
    )
  })

  test('ThemePicker receives safe-mode helpText and autoUpdatesChannel handles rc/latest', () => {
    expect(configSrc).toContain('Custom themes are disabled in safe mode')
    expect(configSrc).toContain("? 'slow'")
    expect(configSrc).toContain(
      "const nextChannelValue = finalChannel === 'latest' ? undefined : finalChannel",
    )
  })
})

describe('densable 2.1.289 Usage, Stats, and MCP panels', () => {
  test('Settings Tabs uses densable Ybe stableHeight and flexShrink-0 pane column', () => {
    expect(settingsSrc).toContain('stableHeight')
    expect(settingsSrc).toContain('flexShrink={0}')
  })

  test('Usage scan failures retain a visible contributing section (2.1.289 ku)', () => {
    expect(usageSrc).toContain('logError(')
    expect(usageSrc).toContain(
      'return { day: EMPTY_USAGE_WINDOW, week: EMPTY_USAGE_WINDOW }',
    )
    expect(usageSrc).not.toContain('if (!cancelled) setScan(null)')
  })

  test('Usage LimitBar and Ln shell do not shrink (densable Rt / Ln flexShrink:0)', () => {
    expect(usageSrc).toContain('flexShrink={0}')
    expect(usageSrc).toContain('function UsagePane')
    expect(usageSrc).toContain('width="100%"')
  })

  test('Usage tab shell is densable Ln: Session, plugin gate, gateway vs subscriber', () => {
    expect(usageSrc).toContain(
      '<SessionCostSection isThinClient={isThinClient} />',
    )
    expect(usageSrc).toContain("'Session (remote)'")
    expect(usageSrc).toContain("'Session'")
    expect(usageSrc).toContain('isPluginSkillListingFootprintEnabled')
    expect(usageSrc).toContain("getAPIProvider() === 'gateway'")
    expect(usageSrc).toContain('const subscriber = isClaudeAISubscriber()')
    expect(usageSrc).toContain("What's contributing to your limits usage?")
    expect(usageSrc).toContain('scanUsageTranscripts')
    expect(usageSrc).toContain('aggregatePluginSkillListing')
    expect(usageSrc).toContain('get_session_cost')
    expect(usageSrc).toContain('sendControlRequest')
    expect(usageSrc).toContain('buildModelScopedWeekBars')
    expect(usageSrc).toContain('tengu_usage_overage_included_models')
    expect(usageSrc).toContain('tengu_rate_limit_promo_notices')
    expect(usageSrc).toContain('trailingLinesForBar')
    expect(usageSrc).not.toContain(
      '/usage is only available for subscription plans.',
    )
    expect(usageSrc).not.toContain('OverageCreditUpsell')
  })

  test('Usage $a remote cost RPC and ext model-scoped week bars runtime', async () => {
    const {
      buildModelScopedWeekBars,
      fetchThinClientSessionCost,
      getOverageIncludedModelsAllowlist,
    } = await import('../Usage.js')
    const {
      getSurfaceCapabilities,
      replaceSurfaceCapabilities,
      resetSurfaceCapabilitiesForTests,
    } = await import('../../../utils/sessionNameUniqueness.js')

    resetSurfaceCapabilitiesForTests()
    try {
      expect(await fetchThinClientSessionCost()).toBe('Remote cost unavailable')
      replaceSurfaceCapabilities({
        ...getSurfaceCapabilities(),
        workspace: 'remote',
        remote: {
          kind: 'ccr',
          isRemoteMode: true,
          async sendControlRequest(req) {
            expect(req.subtype).toBe('get_session_cost')
            return { text: 'Total cost: $1.23' }
          },
        },
      })
      expect(await fetchThinClientSessionCost()).toBe('Total cost: $1.23')

      replaceSurfaceCapabilities({
        ...getSurfaceCapabilities(),
        workspace: 'remote',
        remote: {
          kind: 'ccr',
          isRemoteMode: true,
          async sendControlRequest() {
            throw new Error('socket closed')
          },
        },
      })
      expect(await fetchThinClientSessionCost()).toBe(
        'Remote cost unavailable (socket closed)',
      )
    } finally {
      resetSurfaceCapabilitiesForTests()
    }

    const prevDisableGb = process.env.DISABLE_GROWTHBOOK
    try {
      process.env.DISABLE_GROWTHBOOK = '1'
      expect(getOverageIncludedModelsAllowlist()).toEqual([
        'Fable',
        'Fable 5',
        'Fable 5.1',
      ])
    } finally {
      if (prevDisableGb === undefined) delete process.env.DISABLE_GROWTHBOOK
      else process.env.DISABLE_GROWTHBOOK = prevDisableGb
    }
    const bars = buildModelScopedWeekBars(
      [
        {
          kind: 'weekly_scoped',
          group: 'weekly',
          percent: 42,
          resets_at: '2026-11-20T00:00:00Z',
          severity: 'warning',
          is_active: false,
          scope: { model: { display_name: 'Fable 5.1' } },
        },
        {
          kind: 'weekly_scoped',
          group: 'weekly',
          percent: 10,
          resets_at: null,
          severity: 'warning',
          is_active: false,
          scope: { model: { display_name: 'Haiku' } },
        },
      ],
      ['Fable 5.1'],
    )
    expect(bars).toEqual([
      {
        bar: 'Fable 5.1',
        title: 'Current week (Fable 5.1)',
        displayName: 'Fable 5.1',
        limit: { utilization: 42, resets_at: '2026-11-20T00:00:00Z' },
        alwaysShowDateInReset: true,
      },
    ])
  })

  test('Usage renders cinder_cove credit bar with subtextOverride', () => {
    expect(usageSrc).toContain('utilization.cinder_cove')
    expect(usageSrc).toContain('title="Claude Code and Cowork credit"')
    expect(usageSrc).toContain('One-time credit · Expires ')
    expect(usageSrc).toContain("'One-time credit'")
  })

  test('Stats allows upArrow to focusHeader in any active tab', () => {
    expect(statsSrc).toContain('if (key.upArrow) {')
    expect(statsSrc).not.toContain(
      "if (key.upArrow && activeTab === 'Overview')",
    )
  })

  test('MCPSettings empty state and MCPListPanel unused/suppressed connectors', () => {
    expect(mcpSettingsSrc).toContain(
      "No MCP servers loaded. If you just added one, restart Claude Code. If you declined a project's server, run `claude mcp reset-project-choices` first. `claude doctor` finds config problems. To add one, run `claude mcp --help` or see https://code.claude.com/docs/en/mcp",
    )
    expect(mcpListPanelSrc).toContain("label: 'Show unused connectors'")
    expect(mcpListPanelSrc).toContain('hidden — same URL as your server')
  })

  test('MCPStdioServerMenu, MCPToolListView, and MCPToolDetailView 2.1.289 parity', () => {
    expect(mcpStdioMenuSrc).toContain('<Dialog')
    expect(mcpStdioMenuSrc).toContain('Protocol: ')
    expect(mcpStdioMenuSrc).toContain('Issue: ')
    expect(mcpToolListSrc).toContain('disabled by your organization')
    expect(mcpToolListSrc).toContain("'ask-only'")
    expect(mcpToolListSrc).toContain('is disabled by your organization')
    expect(mcpToolDetailSrc).toContain(
      'The model receives only about the first {limit} characters.',
    )
  })
})
