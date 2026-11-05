/**
 * densable 2.1.289 yfe cc-plugin-plugin-authoring / mods-guide / you-should-know.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  PLUGIN_AUTHORING_PLUGIN_DESCRIPTION,
  PLUGIN_AUTHORING_PLUGIN_NAME,
} from '../pluginAuthoring.js'
import {
  MODS_GUIDE_GB_FEATURE,
  MODS_GUIDE_PLUGIN_DESCRIPTION,
  MODS_GUIDE_PLUGIN_NAME,
} from '../modsGuide.js'
import {
  YOU_SHOULD_KNOW_GB_FEATURE,
  YOU_SHOULD_KNOW_PLUGIN_DESCRIPTION,
  YOU_SHOULD_KNOW_PLUGIN_NAME,
} from '../youShouldKnow.js'

const root = join(import.meta.dir, '../../../..')

describe('densable 2.1.289 builtin mods plugins', () => {
  test('listing names and copy', () => {
    expect(PLUGIN_AUTHORING_PLUGIN_NAME).toBe('cc-plugin-plugin-authoring')
    expect(PLUGIN_AUTHORING_PLUGIN_DESCRIPTION).toContain(
      'Plugin authoring: Claude knows how a plugin of function hooks',
    )
    expect(MODS_GUIDE_PLUGIN_NAME).toBe('cc-plugin-mods-guide')
    expect(MODS_GUIDE_PLUGIN_DESCRIPTION).toContain('Clawd cooking')
    expect(MODS_GUIDE_GB_FEATURE).toBe('tengu_linen_acorn')
    expect(YOU_SHOULD_KNOW_PLUGIN_NAME).toBe('cc-plugin-you-should-know')
    expect(YOU_SHOULD_KNOW_PLUGIN_DESCRIPTION).toContain(
      'a side agent watches your back',
    )
    expect(YOU_SHOULD_KNOW_GB_FEATURE).toBe('tengu_jolly_dewdrop')
  })

  test('source-lock init + tip + skill host', () => {
    const index = readFileSync(
      join(root, 'src/plugins/bundled/index.ts'),
      'utf8',
    )
    expect(index).toContain('registerSecDefaultBuiltinPlugin')
    expect(index).toContain('registerTelemetryBuiltinPlugin')
    expect(index).toContain('registerTipsBuiltinPlugin')
    expect(index).toContain('registerMermaidBuiltinPlugin')
    expect(index).toContain('registerResponsiveModeBuiltinPlugin')
    expect(index).toContain('registerDiffBuiltinPlugin')
    expect(index).toContain('registerClaudeTestBuiltinPlugin')
    expect(index).toContain('registerPluginAuthoringBuiltinPlugin')
    expect(index).toContain('registerModsGuideBuiltinPlugin')
    expect(index).toContain('registerYouShouldKnowBuiltinPlugin')
    expect(index).toContain("CLAUDE_CODE_ENTRYPOINT === 'local-agent'")
    expect(index).toContain('function leftoverSno')
    expect(index).toContain("startsWith('remote')")

    const authoring = readFileSync(
      join(root, 'src/plugins/bundled/pluginAuthoring.ts'),
      'utf8',
    )
    expect(authoring).toContain('createPluginAuthoringSkill')
    expect(authoring).toContain('leftoverHooksModulesOn')
    expect(authoring).not.toContain('defaultEnabled:')

    const listingGuide = readFileSync(
      join(root, 'src/plugins/bundled/modsGuide.ts'),
      'utf8',
    )
    expect(listingGuide).toContain('leftoverFu(')
    expect(listingGuide).toContain('hooksModule:')
    expect(listingGuide).toContain("hooks: ['ui.render']")
    expect(listingGuide).toContain('files: {}')
    expect(listingGuide).not.toContain('defaultEnabled:')
    expect(listingGuide).toContain(
      'vendor/claude-code-mods/mods/cc-plugin-mods-guide',
    )

    const hooksHost = readFileSync(
      join(root, 'src/utils/plugins/functionHooksModules.ts'),
      'utf8',
    )
    expect(hooksHost).toContain('export function leftoverFu')
    expect(hooksHost).toContain('export function leftoverUs')
    expect(hooksHost).toContain('function leftoverHt')
    expect(hooksHost).toContain('function leftoverVo')
    expect(hooksHost).toContain('export function leftoverLh')
    expect(hooksHost).toContain('leftoverIsStandaloneExecutable()')
    expect(hooksHost).toContain('leftoverHt(module, scan(), dir)')
    expect(hooksHost).toContain('{ module, folder: dir }')
    expect(hooksHost).toContain('leftoverNe.registerScan(vo, hooks.scan)')
    expect(hooksHost).toContain("else if ('shipped' in hooks)")
    expect(hooksHost).toContain('leftoverBuiltinHooksModule(name)')
    expect(hooksHost).toContain(
      'return leftoverHooksByName.get(leftoverVo(name))',
    )
    expect(hooksHost).not.toContain(
      'leftoverHooksByName.get(name) ?? leftoverHooksByName.get(leftoverVo(name))',
    )
    expect(hooksHost).toContain("'scan' in hooks")
    expect(hooksHost).toContain('leftoverShipped.set')
    expect(hooksHost).toContain('leftoverHooksByName.set(vo, hooks)')
    expect(hooksHost).toContain('function leftoverPluginNameFromVo')
    expect(hooksHost).toContain('for (const key of leftoverHooksByName.keys())')

    const builtinHost = readFileSync(
      join(root, 'src/plugins/builtinPlugins.ts'),
      'utf8',
    )
    expect(builtinHost).toContain('leftoverUs(definition)')
    expect(builtinHost).toContain(
      'leftoverLhForBuiltin(name, definition.hooksModule)',
    )
    expect(builtinHost).toContain('enabledFromPolicyOnly')
    expect(builtinHost).toContain('enabledFromTrustedSettingsOnly')
    expect(builtinHost).toContain(
      "getSettingsForSource('policySettings')?.enabledPlugins",
    )

    const agentsMd = readFileSync(
      join(root, 'src/plugins/bundled/agentsMd.ts'),
      'utf8',
    )
    expect(agentsMd).toContain("AGENTS_MD_PLUGIN_NAME = 'cc-plugin-agents-md'")
    expect(agentsMd).toContain('leftoverFu(')
    expect(agentsMd).toContain('hooksModule:')
    expect(agentsMd).toContain('vendor/claude-code-mods/mods/agents-md')
    const telemetry = readFileSync(
      join(root, 'src/plugins/bundled/telemetry.ts'),
      'utf8',
    )
    expect(telemetry).toContain('TELEMETRY_SCAN_ENV_READS')
    expect(telemetry).toContain('CLAUDE_CODE_REMOTE')
    expect(telemetry).toContain('function leftoverIh')
    expect(telemetry).toContain('getGatewayAuth()')
    expect(telemetry).toContain("getAPIProvider() !== 'firstParty'")
    expect(telemetry).toContain("getPrivacyLevel() !== 'default'")
    expect(telemetry).toContain('CLAUDE_CODE_CUSTOM_OAUTH_URL')
    expect(telemetry).toContain('return !leftoverIh()')
    expect(telemetry).not.toContain("leftoverTaintsInclude('hipaa')")
    const claudeTest = readFileSync(
      join(root, 'src/plugins/bundled/claudeTest.ts'),
      'utf8',
    )
    expect(claudeTest).toContain('CLAUDE_TEST_SCAN_FILES')
    expect(claudeTest).toContain('version: CLAUDE_TEST_PLUGIN_VERSION')
    expect(claudeTest).toContain("CLAUDE_TEST_PLUGIN_VERSION = '0.4.17'")
    expect(claudeTest).toContain('tengu_mellow_hollerith')
    expect(claudeTest).toContain(
      'runs the plain-language specs in .claude-test/specs/',
    )
    expect(claudeTest).toContain('PASS or FAIL per spec, with a screenshot')
    expect(claudeTest).toContain('function leftoverSe')
    expect(claudeTest).toContain('function leftoverItn')
    expect(claudeTest).toContain('isBareMode()')
    expect(claudeTest).toContain('leftoverComplianceTaintsSettled()')
    expect(claudeTest).toContain('leftoverPolicyLimitsDu()')
    expect(claudeTest).toContain('getPinnedFeatureValue')
    expect(claudeTest).toContain("leftoverTaintsInclude('hipaa')")
    expect(claudeTest).toContain("leftoverTaintsInclude('zdr')")
    expect(claudeTest).toContain("new Set(['linux', 'macos', 'wsl'])")
    expect(claudeTest).toContain('process.getuid')
    expect(claudeTest).not.toContain('isScreenReaderModeEnabled')
    expect(claudeTest).not.toContain('leftoverHooksModulesOn')
    expect(claudeTest).not.toContain(
      'an interactive session drafts and runs a spec against the app',
    )
    const claudeTestFiles = readFileSync(
      join(root, 'src/plugins/bundled/claudeTestScanFiles.ts'),
      'utf8',
    )
    expect(claudeTestFiles).toContain("'agents/author.md'")
    expect(claudeTestFiles).toContain("'agents/explorer.md'")
    const secDefault = readFileSync(
      join(root, 'src/plugins/bundled/secDefault.ts'),
      'utf8',
    )
    expect(secDefault).toContain('Security default: seated outermost')
    expect(secDefault).toContain('enabledFromTrustedSettingsOnly: true')
    expect(secDefault).toContain('enabledFromPolicyOnly: true')
    expect(secDefault).toContain('function leftoverSecDefaultSeated')
    expect(secDefault).toContain('prependPlugins')
    const tipsSrc = readFileSync(
      join(root, 'src/plugins/bundled/tips.ts'),
      'utf8',
    )
    expect(tipsSrc).not.toContain('defaultEnabled:')
    const mermaidSrc = readFileSync(
      join(root, 'src/plugins/bundled/mermaid.ts'),
      'utf8',
    )
    expect(mermaidSrc).not.toContain('defaultEnabled:')
    const responsiveSrc = readFileSync(
      join(root, 'src/plugins/bundled/responsiveMode.ts'),
      'utf8',
    )
    expect(responsiveSrc).toContain('function leftoverOx')
    expect(responsiveSrc).toContain('function leftoverGxn')
    expect(responsiveSrc).toContain("kind === 'bg'")
    expect(responsiveSrc).toContain("kind === 'daemon-worker'")
    expect(responsiveSrc).toContain('leftoverOxAttendedEntrypoints')
    expect(responsiveSrc).toContain("'claude-vscode'")
    expect(responsiveSrc).toContain("'claude-coworker-terminal'")
    expect(responsiveSrc).toContain("'ssh-remote'")
    expect(responsiveSrc).toContain('teammateAgentId()')
    expect(responsiveSrc).toContain("entry === 'claude-in-slack'")
    expect(responsiveSrc).toContain("entry === 'claude-in-teams'")
    expect(responsiveSrc).toContain('leftoverOx()')
    expect(responsiveSrc).toContain('!leftoverGxn()')
    expect(responsiveSrc).toContain('defaultEnabled: false')
    expect(responsiveSrc).not.toContain('isScreenReaderModeEnabled')
    const diffSrc = readFileSync(
      join(root, 'src/plugins/bundled/diff.ts'),
      'utf8',
    )
    expect(diffSrc).toContain('function leftoverFt')
    expect(diffSrc).toContain('getIsInteractive()')
    expect(diffSrc).toContain(
      'getFeatureValue_CACHED_MAY_BE_STALE(DIFF_GB_FEATURE, true)',
    )
    const types = readFileSync(join(root, 'src/types/plugin.ts'), 'utf8')
    expect(types).toContain('hooksModule?:')
    expect(types).toContain('enabledFromPolicyOnly?: boolean')
    expect(types).toContain('enabledFromTrustedSettingsOnly?: boolean')
    expect(types).toContain('scan: unknown')
    expect(types).toContain('folder: string')
    expect(types).not.toContain(
      '{ shipped: { register: (...args: unknown[]) => unknown } }',
    )

    const gold = readFileSync(
      join(root, 'src/skills/bundled/goldOfficialMissingSkills.ts'),
      'utf8',
    )
    expect(gold).toContain(
      'plugin-authoring hangs on cc-plugin-plugin-authoring',
    )

    const tips = readFileSync(
      join(root, 'src/services/tips/tipRegistry.ts'),
      'utf8',
    )
    expect(tips).toContain("id: 'you-should-know-plugin'")
    expect(tips).toContain("advertisedCommand: 'plugin'")
    expect(tips).toContain('maxLifetimeShows: 3')

    const yskSrc = readFileSync(
      join(root, 'src/plugins/bundled/youShouldKnow.ts'),
      'utf8',
    )
    expect(yskSrc).toContain('leftoverComplianceTaintsSettled')
    expect(yskSrc).toContain('getFeatureValue_CACHED_MAY_BE_STALE')
    expect(yskSrc).not.toContain('getPinnedFeatureValue')
    expect(yskSrc).not.toContain('lastFetchOutcome')
    expect(yskSrc).toContain('leftoverFu(')
    expect(yskSrc).toContain('hooksModule:')
    expect(yskSrc).toContain("'prompt.submit'")
    expect(yskSrc).toContain("'command.run'")
    expect(yskSrc).toContain("'turn.step'")
    expect(yskSrc).toContain("'session.detach'")
    expect(yskSrc).toContain("'session.end'")
    expect(yskSrc).toContain("'model.fork'")
    expect(yskSrc).toContain("'ui.invalidate'")
    expect(yskSrc).not.toContain("'prompt.section'")
    expect(yskSrc).not.toContain("'turn.abort'")
    expect(yskSrc).toContain(
      'vendor/claude-code-mods/mods/cc-plugin-you-should-know',
    )

    const modsGuide = readFileSync(
      join(
        root,
        'vendor/claude-code-mods/mods/cc-plugin-mods-guide/hooks/register.ts',
      ),
      'utf8',
    )
    expect(modsGuide).toContain("'ui.render'")
    expect(modsGuide).toContain("metadataSource: 'mod_hot_reload'")
    expect(modsGuide).toContain('Clawd stirs a steaming pot')
    expect(modsGuide).toContain('await t.ui.resolve(e)')

    const ysk = readFileSync(
      join(
        root,
        'vendor/claude-code-mods/mods/cc-plugin-you-should-know/hooks/register.ts',
      ),
      'utf8',
    )
    expect(ysk).toContain("'prompt.submit'")
    expect(ysk).toContain("'ui.render'")
    expect(ysk).toContain("component: 'AbovePrompt'")
    expect(ysk).toContain('await s.ui.resolve(f)')
  })

  test('yfe 3-phase isolation, A5r availability guard, and short-id normalization', async () => {
    const {
      clearBuiltinPlugins,
      externalBuiltinNamespaceName,
      getBuiltinPluginFailures,
      getBuiltinPlugins,
      isBuiltinPluginAvailable,
      normalizeCanonicalBuiltinPluginId,
      registerBuiltinPlugin,
      registerBuiltinPluginModule,
    } = await import('../../builtinPlugins.js')

    clearBuiltinPlugins()
    try {
      expect(normalizeCanonicalBuiltinPluginId('tips@builtin')).toBe(
        'cc-plugin-tips@builtin',
      )
      expect(normalizeCanonicalBuiltinPluginId('sec-default@BUILTIN')).toBe(
        'cc-plugin-sec-default@builtin',
      )
      expect(
        externalBuiltinNamespaceName(
          'cc-plugin-claude-test',
          'cc-plugin-claude-test@builtin',
        ),
      ).toBe('claude-test')
      expect(
        externalBuiltinNamespaceName(
          'cc-plugin-claude-test',
          'cc-plugin-claude-test@marketplace',
        ),
      ).toBe('cc-plugin-claude-test')

      registerBuiltinPluginModule('bad-require', () => {
        throw new Error('boom-require')
      })
      registerBuiltinPluginModule('bad-shape', () => ({ nope: 1 }))
      registerBuiltinPluginModule('bad-register', () => ({
        registerPlugin: () => {
          registerBuiltinPlugin({
            name: 'bad-register',
            description: 'partial',
          })
          throw new Error('boom-register')
        },
      }))
      registerBuiltinPluginModule('bad-avail', () => ({
        registerPlugin: () => {
          registerBuiltinPlugin({
            name: 'bad-avail',
            description: 'throws in isAvailable',
            defaultEnabled: false,
            isAvailable: () => {
              throw new Error('boom-avail')
            },
          })
        },
      }))
      registerBuiltinPluginModule('good-disabled', () => ({
        registerPlugin: () => {
          registerBuiltinPlugin({
            name: 'good-disabled',
            description: 'explicit defaultEnabled false',
            defaultEnabled: false,
          })
        },
      }))

      expect(isBuiltinPluginAvailable('bad-avail')).toBe(false)
      const failures = getBuiltinPluginFailures()
      expect(failures.get('bad-require')?.phase).toBe('require')
      expect(failures.get('bad-shape')?.phase).toBe('shape')
      expect(failures.get('bad-register')?.phase).toBe('register')
      expect(failures.get('bad-avail')?.phase).toBe('is_available')

      const { enabled, disabled } = getBuiltinPlugins()
      expect(enabled).toHaveLength(0)
      expect(disabled).toHaveLength(1)
      expect(disabled[0]?.manifest.defaultEnabled).toBe(false)
    } finally {
      clearBuiltinPlugins()
    }
  })

  test('seatSecDefaultPlugin and pluginAuthoringSkillFilesMissingNoteOf alignment', async () => {
    const { seatSecDefaultPlugin } = await import('../secDefault.js')
    const { pluginAuthoringSkillFilesMissingNoteOf } = await import(
      '../../../skills/bundled/goldOfficialMissingSkills.js'
    )

    expect(seatSecDefaultPlugin([]).outermost).toEqual([])
    expect(seatSecDefaultPlugin([]).seat).toContain(
      'not seated: managed prependPlugins does not list it',
    )
    expect(seatSecDefaultPlugin(['sec-default@builtin']).outermost).toEqual([
      'cc-plugin-sec-default@builtin',
    ])
    expect(seatSecDefaultPlugin(['sec-default@builtin']).seat).toContain(
      'seated by managed prependPlugins at position 1',
    )

    const missingNote = pluginAuthoringSkillFilesMissingNoteOf(
      '/tmp/missing-skill-dir',
    )
    expect(missingNote).toContain(
      "The engine could not write this skill's folder, /tmp/missing-skill-dir, this time",
    )
    expect(missingNote).toContain('are absent')
  })

  test('all 10 builtin mods load natively + in VM and execute runtime hooks', async () => {
    const { clearBuiltinPlugins, getBuiltinPluginDefinition } = await import(
      '../../builtinPlugins.js'
    )
    const { registerAgentsMdBuiltinPlugin } = await import('../agentsMd.js')
    const { registerSecDefaultBuiltinPlugin } = await import('../secDefault.js')
    const { registerTelemetryBuiltinPlugin } = await import('../telemetry.js')
    const { registerModsGuideBuiltinPlugin } = await import('../modsGuide.js')
    const { registerYouShouldKnowBuiltinPlugin } = await import(
      '../youShouldKnow.js'
    )
    const { getSpinnerTipPluginSeat, registerTipsBuiltinPlugin } = await import(
      '../tips.js'
    )
    const { registerMermaidBuiltinPlugin } = await import('../mermaid.js')
    const { registerResponsiveModeBuiltinPlugin } = await import(
      '../responsiveMode.js'
    )
    const { registerDiffBuiltinPlugin } = await import('../diff.js')
    const { CLAUDE_TEST_SKILLS, registerClaudeTestBuiltinPlugin } =
      await import('../claudeTest.js')
    const { addPluginScopeToServers } = await import(
      '../../../utils/plugins/mcpPluginIntegration.js'
    )
    const {
      loadFunctionHooksInProcess,
      runFunctionHookChain,
      setLoadedFunctionHooksModules,
    } = await import('../../../utils/plugins/functionHooksModules.js')

    clearBuiltinPlugins()
    setLoadedFunctionHooksModules([])
    try {
      registerAgentsMdBuiltinPlugin()
      registerSecDefaultBuiltinPlugin()
      registerTelemetryBuiltinPlugin()
      registerModsGuideBuiltinPlugin()
      registerYouShouldKnowBuiltinPlugin()
      registerTipsBuiltinPlugin()
      registerMermaidBuiltinPlugin()
      registerResponsiveModeBuiltinPlugin()
      registerDiffBuiltinPlugin()
      registerClaudeTestBuiltinPlugin()

      const specs = [
        {
          dir: 'agents-md',
          name: 'cc-plugin-agents-md',
          tier: 'builtin' as const,
          hooks: 4,
        },
        {
          dir: 'sec-default',
          name: 'cc-plugin-sec-default',
          tier: 'prepend' as const,
          hooks: 15,
        },
        {
          dir: 'telemetry',
          name: 'cc-plugin-telemetry',
          tier: 'builtin' as const,
          hooks: 6,
        },
        {
          dir: 'cc-plugin-mods-guide',
          name: 'cc-plugin-mods-guide',
          tier: 'builtin' as const,
          hooks: 1,
        },
        {
          dir: 'cc-plugin-you-should-know',
          name: 'cc-plugin-you-should-know',
          tier: 'builtin' as const,
          hooks: 6,
        },
        {
          dir: 'cc-plugin-tips',
          name: 'cc-plugin-tips',
          tier: 'builtin' as const,
          hooks: 1,
        },
        {
          dir: 'cc-plugin-mermaid',
          name: 'cc-plugin-mermaid',
          tier: 'builtin' as const,
          hooks: 1,
        },
        {
          dir: 'cc-plugin-responsive-mode',
          name: 'cc-plugin-responsive-mode',
          tier: 'builtin' as const,
          hooks: 3,
        },
        {
          dir: 'diff',
          name: 'cc-plugin-diff',
          tier: 'builtin' as const,
          hooks: 10,
        },
        {
          dir: 'cc-plugin-claude-test',
          name: 'cc-plugin-claude-test',
          tier: 'builtin' as const,
          hooks: 3,
        },
      ]

      const nativeLoaded = await loadFunctionHooksInProcess(
        specs.map(s => ({
          name: `builtin:${s.name}`,
          path: join(root, 'vendor/claude-code-mods/mods', s.dir),
          source: `${s.name}@builtin`,
          tier: s.tier,
        })),
      )
      expect(nativeLoaded).toHaveLength(10)
      for (const [idx, spec] of specs.entries()) {
        expect(nativeLoaded[idx]?.native).toBe(true)
        expect(nativeLoaded[idx]?.hooks?.length).toBe(spec.hooks)
      }

      // Runtime check 1: mermaid renders fenced mermaid code in AssistantMessage
      const mermaidReply = '```mermaid\ngraph LR\n  A --> B\n```'
      const rendered = (await runFunctionHookChain(
        'ui.render',
        {
          component: 'AssistantMessage',
          surface: 'terminal',
          requestId: 'msg-1',
          viewport: { columns: 100, rows: 40 },
          props: { text: mermaidReply },
        },
        async event => event.props,
        'builtin:cc-plugin-mermaid',
      )) as { text?: string }
      expect(typeof rendered?.text).toBe('string')
      expect(rendered?.text).toContain('┌')

      // Runtime check 2: tips installs picker on interactive session.start
      await runFunctionHookChain(
        'session.start',
        { isInteractive: true },
        async event => event,
        'builtin:cc-plugin-tips',
      )
      let shownPayload: unknown = 'unset'
      const slot = {
        context: () => ({}),
        storageV5: () => undefined,
        show: (tip: { text: string; label?: string } | undefined) => {
          shownPayload = tip
        },
      }
      getSpinnerTipPluginSeat().seat(slot)
      expect(getSpinnerTipPluginSeat().pickDue()).toBe(true)
      getSpinnerTipPluginSeat().vacate(slot)
      void shownPayload

      // Runtime check 3: claude-test skills + dynamic mcpServers + scoped server key
      expect(CLAUDE_TEST_SKILLS.map(s => s.name)).toEqual([
        'claude-test',
        'claude-test-execute',
        'claude-test-draft',
      ])
      expect(
        getBuiltinPluginDefinition('cc-plugin-claude-test')?.mcpServers,
      ).toBeUndefined()
      const scoped = addPluginScopeToServers(
        { browser: { type: 'stdio', command: 'bun', args: [] } },
        'cc-plugin-claude-test',
        'cc-plugin-claude-test@builtin',
      )
      expect(Object.keys(scoped)).toEqual(['plugin:claude-test:browser'])
    } finally {
      setLoadedFunctionHooksModules([])
      clearBuiltinPlugins()
    }
  })

  test('diff carryDiffPanelPreference, ZEn/MEt hook tier order, tips getBuiltInTips, and collector telemetry.log road', async () => {
    const {
      computePluginHookOrderRank,
      computePluginHookTier,
      resolvePluginHookTierOrder,
    } = await import('../secDefault.js')
    const { carryDiffPanelPreference, isDiffModLoaded } = await import(
      '../diff.js'
    )
    const { getBuiltInTips } = await import(
      '../../../services/tips/tipRegistry.js'
    )
    const { collectorTelemetryRoad } = await import(
      '../../../utils/telemetry/events.js'
    )
    const {
      forgetAskedPane,
      getPanesState,
      handleHostOp,
      setLoadedFunctionHooksModules,
    } = await import('../../../utils/plugins/functionHooksModules.js')

    // 1. ZEn / MEt tier & monotonic ordering (prepend outermost -> prepend -> user -> append -> builtin)
    const order = {
      ...resolvePluginHookTierOrder(),
      prepend: ['first@corp'],
      append: ['last@corp'],
      from: { prepend: 'policy' as const, append: 'policy' as const },
      outermost: ['cc-plugin-sec-default@builtin'],
    }
    const managed = ['first@corp', 'unlisted@corp', 'last@corp']
    expect(
      computePluginHookTier('cc-plugin-sec-default@builtin', managed, order),
    ).toBe('prepend')
    expect(computePluginHookTier('first@corp', managed, order)).toBe('prepend')
    expect(computePluginHookTier('unlisted@corp', managed, order)).toBe(
      'prepend',
    )
    expect(computePluginHookTier('plain@user', managed, order)).toBe('user')
    expect(computePluginHookTier('last@corp', managed, order)).toBe('append')
    expect(
      computePluginHookTier('cc-plugin-telemetry@builtin', managed, order),
    ).toBe('builtin')

    const rSec = computePluginHookOrderRank(
      'cc-plugin-sec-default@builtin',
      managed,
      order,
    )
    const rFirst = computePluginHookOrderRank('first@corp', managed, order)
    const rUnlisted = computePluginHookOrderRank(
      'unlisted@corp',
      managed,
      order,
    )
    const rUser = computePluginHookOrderRank('plain@user', managed, order)
    const rAppend = computePluginHookOrderRank('last@corp', managed, order)
    const rBuiltin = computePluginHookOrderRank(
      'cc-plugin-telemetry@builtin',
      managed,
      order,
    )
    expect(rSec).toBeLessThan(rFirst)
    expect(rFirst).toBeLessThan(rUnlisted)
    expect(rUnlisted).toBeLessThan(rUser)
    expect(rUser).toBeLessThan(rAppend)
    expect(rAppend).toBeLessThan(rBuiltin)

    // 2. diff carryDiffPanelPreference persists to plugin store + marks asked
    try {
      await handleHostOp(
        'store.delete',
        [{ key: 'open' }],
        'builtin:cc-plugin-diff',
      )
      await carryDiffPanelPreference(true)
      const storedOpen = await handleHostOp(
        'store.get',
        [{ key: 'open' }],
        'builtin:cc-plugin-diff',
      )
      expect(storedOpen).toBe(true)
      expect(
        getPanesState().asked.some(
          row => row.plugin === 'builtin:cc-plugin-diff' && row.id === 'diff',
        ),
      ).toBe(true)
      expect(typeof isDiffModLoaded()).toBe('boolean')
    } finally {
      await handleHostOp(
        'store.delete',
        [{ key: 'open' }],
        'builtin:cc-plugin-diff',
      )
      forgetAskedPane({ plugin: 'builtin:cc-plugin-diff', id: 'diff' })
      setLoadedFunctionHooksModules([])
    }

    // 3. tips getBuiltInTips returns raw built-in tips including you-should-know-plugin
    const builtInTips = getBuiltInTips()
    expect(builtInTips.some(tip => tip.id === 'you-should-know-plugin')).toBe(
      true,
    )

    // 4. collectorTelemetryRoad has default telemetry.log road wired
    expect(collectorTelemetryRoad.getRoad()).toBeDefined()
  })
})
