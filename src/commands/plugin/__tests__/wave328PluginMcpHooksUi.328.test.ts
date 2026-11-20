/**
 * Wave 327-328 Group 4D — /plugin, /mcp, /hooks, and /tasks UI unit tests:
 * #382, #410, #444, #453, #454, #462, #464, #484, #494, #603, #610, #614,
 * #615, #616, #617.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  applySearchBurstInput,
  CLICK_TO_ENTER_GUARD_MS,
  ENTER_REPEAT_COOLDOWN_MS,
  isPluginViewOpCurrent,
  POST_TRANSITION_ENTER_GUARD_MS,
  recordPluginUiClick,
  resetPluginUiClickForTests,
  sanitizeSearchBurstInput,
  shouldIgnorePluginEnterAction,
} from '../pluginListHelpers.js'
import {
  formatMarketplaceRemoveWarning,
  shouldShowMarketplaceDetailsError,
} from '../ManageMarketplaces.js'
import { NO_MCP_SERVERS_MESSAGE } from '../../../components/mcp/MCPSettings.js'
import { resolveInitialMcpToolFocusIndex } from '../../../components/mcp/MCPToolListView.js'

const ROOT = join(import.meta.dir, '../../../..')

describe('#454 & #610 — /hooks flagSettings footer & preserved focus position', () => {
  test('#454: ViewHookMode handles flagSettings source exhaustively', () => {
    const viewHookSrc = readFileSync(
      join(ROOT, 'src/components/hooks/ViewHookMode.tsx'),
      'utf8',
    )
    expect(viewHookSrc).toContain("case 'flagSettings':")
    expect(viewHookSrc).toContain(
      'This hook comes from --settings. To change or remove it, change those settings and restart Claude Code.',
    )
  })

  test('#610: HooksConfigMenu & subviews preserve event, matcher, and hook focus indexes', () => {
    const menuSrc = readFileSync(
      join(ROOT, 'src/components/hooks/HooksConfigMenu.tsx'),
      'utf8',
    )
    const eventSrc = readFileSync(
      join(ROOT, 'src/components/hooks/SelectEventMode.tsx'),
      'utf8',
    )
    const matcherSrc = readFileSync(
      join(ROOT, 'src/components/hooks/SelectMatcherMode.tsx'),
      'utf8',
    )
    const hookSrc = readFileSync(
      join(ROOT, 'src/components/hooks/SelectHookMode.tsx'),
      'utf8',
    )
    expect(menuSrc).toContain('eventFocusIndex')
    expect(menuSrc).toContain('matcherFocusByEvent')
    expect(menuSrc).toContain('hookFocusByKey')
    expect(eventSrc).toContain('defaultFocusIndex')
    expect(matcherSrc).toContain('defaultFocusIndex')
    expect(hookSrc).toContain('defaultFocusIndex')
  })
})

describe('#444 — /tasks second x on task details never stops next task', () => {
  test('BackgroundTasksDialog guards auto-exit from detail view with ignoreNextKillRef', () => {
    const tasksSrc = readFileSync(
      join(ROOT, 'src/components/tasks/BackgroundTasksDialog.tsx'),
      'utf8',
    )
    expect(tasksSrc).toContain('ignoreNextKillRef')
    expect(tasksSrc).toContain("if (viewState.mode !== 'list') return;")
    expect(tasksSrc).toContain('ignoreNextKillRef.current = true;')
  })
})

describe('#453, #462, #494 — /mcp empty guidance, preserved tool focus & unified server menus', () => {
  test('#453: NO_MCP_SERVERS_MESSAGE explains restart, reset-project-choices, and claude doctor', () => {
    expect(NO_MCP_SERVERS_MESSAGE).toBe(
      "No MCP servers loaded. If you just added one, restart Claude Code. If you declined a project's server, run `claude mcp reset-project-choices` first. `claude doctor` finds config problems. To add one, run `claude mcp --help` or see https://code.claude.com/docs/en/mcp",
    )
  })

  test('#462: resolveInitialMcpToolFocusIndex restores exact tool by name or fallback index', () => {
    const tools = [{ name: 't1' }, { name: 't2' }, { name: 't3' }]
    expect(resolveInitialMcpToolFocusIndex(tools, 't3', 0)).toBe(2)
    expect(resolveInitialMcpToolFocusIndex(tools, 'missing', 1)).toBe(1)
    expect(resolveInitialMcpToolFocusIndex(tools, undefined, 99)).toBe(2)
    expect(resolveInitialMcpToolFocusIndex([], 't1', 0)).toBe(0)

    const mcpSettingsSrc = readFileSync(
      join(ROOT, 'src/components/mcp/MCPSettings.tsx'),
      'utf8',
    )
    const managePluginsSrc = readFileSync(
      join(ROOT, 'src/commands/plugin/ManagePlugins.tsx'),
      'utf8',
    )
    expect(mcpSettingsSrc).toContain('lastToolSelection')
    expect(mcpSettingsSrc).toContain('startOn={savedSelection?.toolName}')
    expect(managePluginsSrc).toContain('lastMcpToolSelection')
    expect(managePluginsSrc).toContain('startOn={savedToolSelection?.toolName}')
  })

  test('#494: local, remote, and agent MCP menus share Dialog layout, end in Back, and hide indexes outside screen reader', () => {
    for (const rel of [
      'src/components/mcp/MCPStdioServerMenu.tsx',
      'src/components/mcp/MCPRemoteServerMenu.tsx',
      'src/components/mcp/MCPAgentServerMenu.tsx',
    ]) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      expect(src).toContain('<Dialog')
      expect(src).toContain("label: 'Back'")
      expect(src).toContain("value: 'back'")
      expect(src).toContain('hideIndexes={!isScreenReaderModeEnabled()}')
    }
  })
})

describe('#464 — PluginOptionsDialog removes doubled divider inside /plugin', () => {
  test('PluginOptionsDialog renders Dialog with hideBorder', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/plugin/PluginOptionsDialog.tsx'),
      'utf8',
    )
    expect(src).toContain('<Dialog')
    expect(src).toContain('hideBorder')
  })
})

describe('#484 — ManageMarketplaces removal warning & per-marketplace error isolation', () => {
  test('formatMarketplaceRemoveWarning mentions settings and saved data (singular & plural)', () => {
    expect(formatMarketplaceRemoveWarning(1)).toBe(
      'This will also uninstall 1 plugin and delete its settings and saved data:',
    )
    expect(formatMarketplaceRemoveWarning(3)).toBe(
      'This will also uninstall 3 plugins and delete their settings and saved data:',
    )
  })

  test('shouldShowMarketplaceDetailsError hides another marketplace error on a healthy marketplace page', () => {
    const listErr = 'Failed to load marketplace broken-mkt'
    expect(
      shouldShowMarketplaceDetailsError(
        { name: 'healthy-mkt', pluginCount: 5 },
        listErr,
        listErr,
        null,
      ),
    ).toBe(false)
    expect(
      shouldShowMarketplaceDetailsError(
        { name: 'broken-mkt', pluginCount: undefined },
        listErr,
        listErr,
        null,
      ),
    ).toBe(true)
    expect(
      shouldShowMarketplaceDetailsError(
        { name: 'healthy-mkt', pluginCount: 5 },
        'Update failed',
        null,
        'other-mkt',
      ),
    ).toBe(false)
    expect(
      shouldShowMarketplaceDetailsError(
        { name: 'healthy-mkt', pluginCount: 5 },
        'Update failed',
        null,
        'healthy-mkt',
      ),
    ).toBe(true)
  })
})

describe('#382, #410, #603, #614, #615, #616, #617 — /plugin interaction, burst & async guards', () => {
  test('#382 & #617: shouldIgnorePluginEnterAction blocks click+Enter, post-transition repeat, held Enter cooldown, and busy state', () => {
    resetPluginUiClickForTests()
    const base = 10_000

    // Clean Enter passes
    expect(
      shouldIgnorePluginEnterAction({
        now: base,
        lastClickAt: 0,
        lastTransitionAt: 0,
        lastAcceptAt: 0,
        isBusy: false,
      }),
    ).toBe(false)

    // #382: Click followed immediately by Enter is ignored
    recordPluginUiClick(base)
    expect(
      shouldIgnorePluginEnterAction({
        now: base + CLICK_TO_ENTER_GUARD_MS - 1,
      }),
    ).toBe(true)
    expect(
      shouldIgnorePluginEnterAction({
        now: base + CLICK_TO_ENTER_GUARD_MS + 1,
      }),
    ).toBe(false)

    resetPluginUiClickForTests()

    // #617: Held Enter right after entering details view is ignored
    expect(
      shouldIgnorePluginEnterAction({
        now: base + POST_TRANSITION_ENTER_GUARD_MS - 1,
        lastTransitionAt: base,
      }),
    ).toBe(true)

    // #617: Rapid repeat Enter within cooldown is ignored
    expect(
      shouldIgnorePluginEnterAction({
        now: base + ENTER_REPEAT_COOLDOWN_MS - 1,
        lastAcceptAt: base,
      }),
    ).toBe(true)

    // Key repeat flag or busy state is ignored
    expect(shouldIgnorePluginEnterAction({ now: base, isRepeat: true })).toBe(
      true,
    )
    expect(shouldIgnorePluginEnterAction({ now: base, isBusy: true })).toBe(
      true,
    )
  })

  test('#410 & #603: sanitizeSearchBurstInput & applySearchBurstInput handle control bursts and out-of-range offsets safely', () => {
    expect(sanitizeSearchBurstInput('abc\x1b[A\x00def\x7f')).toBe('abc[Adef')
    expect(applySearchBurstInput('hel', 999, 'lo\x00!')).toEqual({
      query: 'hello!',
      cursorOffset: 6,
    })
    expect(applySearchBurstInput('world', -5, 'hi ')).toEqual({
      query: 'hi world',
      cursorOffset: 3,
    })
    expect(applySearchBurstInput('abc', 2, '\x1b\x07')).toEqual({
      query: 'abc',
      cursorOffset: 2,
    })
  })

  test('#614 & #615: isPluginViewOpCurrent rejects stale async completions after navigating away or switching plugins', () => {
    expect(isPluginViewOpCurrent(3, 3, 'a@mkt', 'a@mkt')).toBe(true)
    // User pressed Esc back to list (gen bumped)
    expect(isPluginViewOpCurrent(4, 3, null, 'a@mkt')).toBe(false)
    // User opened a different plugin B while A's operation was still running
    expect(isPluginViewOpCurrent(4, 3, 'b@mkt', 'a@mkt')).toBe(false)
    expect(isPluginViewOpCurrent(3, 3, 'b@mkt', 'a@mkt')).toBe(false)
  })

  test('#616: ManagePlugins and PluginSettings keep typing & arrows working after empty search or tab row click', () => {
    const manageSrc = readFileSync(
      join(ROOT, 'src/commands/plugin/ManagePlugins.tsx'),
      'utf8',
    )
    const settingsSrc = readFileSync(
      join(ROOT, 'src/commands/plugin/PluginSettings.tsx'),
      'utf8',
    )
    expect(manageSrc).toContain('searchBoxRef')
    expect(manageSrc).toContain('focusManager?.focus(searchBoxRef.current)')
    expect(manageSrc).toContain('filteredItemsLengthRef.current === 0')
    expect(manageSrc).toContain('isPluginViewOpCurrent')
    expect(manageSrc).toContain('shouldIgnorePluginEnterAction')
    expect(settingsSrc).toContain('setChildSearchActive(false)')
    expect(settingsSrc).toContain('recordPluginUiClick()')
  })
})
