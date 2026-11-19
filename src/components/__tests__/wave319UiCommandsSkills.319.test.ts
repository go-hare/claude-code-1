import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { formatContextAsMarkdownTable } from '../../commands/context/context-noninteractive.js'
import { formatAntConsoleOrganization } from '../../commands/login/getAuthStatus.js'
import { getCloudSessionPermissionsMessage } from '../../commands/permissions/permissions.js'
import { formatRenameResultMessage } from '../../commands/rename/rename.js'
import { getCloudSessionUsageFallbackMessage } from '../../commands/usage/usage.js'
import { CLAUDE_API_SUBCOMMANDS } from '../../skills/bundled/claudeApi.js'
import { SKILL_FILES } from '../../skills/bundled/claudeApiContent.js'
import { buildCloudSessionLoopNote } from '../../skills/bundled/loop.js'
import { isLoopKeepaliveGateEnabled } from '../../utils/loopDynamic.js'
import {
  AUTO_MODE_SERVER_DOCS_URL,
  buildAutoModeServerProperties,
  linkifyStatusText,
} from '../../utils/status.js'
import {
  computeTurnDiffWindow,
  DIFF_TURN_WINDOW_SIZE,
} from '../diff/DiffDialog.js'
import {
  buildVisibleModelPickerOptions,
  MORE_MODELS_OPTION_VALUE,
} from '../ModelPicker.js'
import { formatGatewayUnlimitedSpend } from '../Settings/Usage.js'
import {
  collectEarlierSessionSubagents,
  EARLIER_IN_SESSION_LABEL,
} from '../tasks/BackgroundTasksDialog.js'

const ROOT = join(import.meta.dir, '..', '..', '..')

describe('Wave 319 Group 4 — Skills, Commands, UI & Core Alignments', () => {
  test('#1704 & #1819: claude-api bundles latency-optimization docs/probe and 12 managed-agents quickstarts', () => {
    expect(CLAUDE_API_SUBCOMMANDS).toContain('latency-optimize')
    expect(SKILL_FILES['shared/latency-optimization.md']).toBeDefined()
    expect(
      SKILL_FILES['shared/latency-optimization/latency_probe.py'],
    ).toBeDefined()
    expect(SKILL_FILES['shared/latency-optimization/levers.md']).toBeDefined()
    expect(
      SKILL_FILES['shared/latency-optimization/measuring.md'],
    ).toBeDefined()
    expect(SKILL_FILES['shared/latency-optimization/search.md']).toBeDefined()
    expect(
      existsSync(
        join(
          ROOT,
          'src/skills/bundled/claude-api/shared/latency-optimization/latency_probe.py',
        ),
      ),
    ).toBe(true)

    const quickstartKeys = Object.keys(SKILL_FILES).filter(k =>
      k.startsWith('shared/managed-agents-quickstarts/'),
    )
    expect(quickstartKeys.length).toBeGreaterThanOrEqual(12)
    expect(
      SKILL_FILES['shared/managed-agents-quickstarts/bug-hunter.md'],
    ).toBeDefined()
    expect(
      SKILL_FILES['shared/managed-agents-quickstarts/incident-commander.md'],
    ).toBeDefined()
  })

  test('#1753: managed-agents-tools.md documents Console Capabilities + allowed_hosts', () => {
    const doc = readFileSync(
      join(
        ROOT,
        'src/skills/bundled/claude-api/shared/managed-agents-tools.md',
      ),
      'utf8',
    )
    expect(doc).toContain('https://platform.claude.com/settings/capabilities')
    expect(doc).toContain('`limited` networking')
    expect(doc).not.toContain('are not yet supported in Managed Agents')
  })

  test('#1715: loop skill adds cloud session container lifetime note', () => {
    const note = buildCloudSessionLoopNote({
      isRemoteSession: true,
      includeSurvivingLoopOffer: true,
      routinesAllowed: true,
    })
    expect(note).toContain('## This is a cloud session')
    expect(note).toContain('send_later')
    expect(note).toContain('delete_trigger')
    expect(buildCloudSessionLoopNote({ isRemoteSession: false })).toBe('')
  })

  test('#1706: Usage.tsx formats unlimited gateway spend (UTC)', () => {
    expect(
      formatGatewayUnlimitedSpend({
        used: { daily: 125, weekly: 1050, monthly: 4200 },
        limit: null,
        currency: 'USD',
      }),
    ).toBe('$1.25 today · $10.50 this week · $42.00 this month')
  })

  test('#1708: GatewayConnect.tsx parses login_notice and renders Notice from <hostname>', () => {
    const src = readFileSync(
      join(ROOT, 'src/components/GatewayConnect.tsx'),
      'utf8',
    )
    expect(src).toContain('login_notice')
    expect(src).toContain("Notice from {hostname ?? 'gateway'}:")
    expect(src).toContain('loginNotice')
  })

  test('#1713: ant auth login Console org formatting & LogoV2 wiring', () => {
    expect(formatAntConsoleOrganization('Acme Corp')).toBe(
      'Acme Corp (Claude Console)',
    )
    expect(formatAntConsoleOrganization(undefined)).toBe(
      'your Claude Console organization',
    )
    const logoSrc = readFileSync(
      join(ROOT, 'src/components/LogoV2/LogoV2.tsx'),
      'utf8',
    )
    expect(logoSrc).toContain('getAntAuthLoginStartupLine')
  })

  test('#1714: BackgroundTasksDialog collects finished subagents under Earlier in this session', () => {
    expect(EARLIER_IN_SESSION_LABEL).toBe('Earlier in this session')
    const earlier = collectEarlierSessionSubagents(
      {
        a1: {
          id: 'a1',
          type: 'local_agent',
          status: 'completed',
          description: 'Done researcher',
          startTime: 100,
          endTime: 500,
        } as never,
        a2: {
          id: 'a2',
          type: 'local_agent',
          status: 'running',
          description: 'Active agent',
          startTime: 200,
        } as never,
        s1: {
          id: 's1',
          type: 'local_bash',
          status: 'completed',
          description: 'Done shell',
          startTime: 300,
          endTime: 600,
        } as never,
      },
      new Set(['a2']),
    )
    expect(earlier.map(t => t.id)).toEqual(['a1'])
  })

  test('#1718 & #1719: gitDiff.ts and git.ts include "--" terminator after ref/HEAD', () => {
    const gitDiffSrc = readFileSync(join(ROOT, 'src/utils/gitDiff.ts'), 'utf8')
    expect(gitDiffSrc).toMatch(/'--shortstat',\s*ref,\s*'--'/)
    expect(gitDiffSrc).toMatch(/'--numstat',\s*ref,\s*'--'/)
    const gitSrc = readFileSync(join(ROOT, 'src/utils/git.ts'), 'utf8')
    const matches = gitSrc.match(/RAW_GIT_DIFF_FLAGS,\s*'HEAD',\s*'--'/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })

  test('#1720: DiffDialog paginates >=64 turn tabs with sliding window', () => {
    expect(DIFF_TURN_WINDOW_SIZE).toBe(63)
    // Turns are ordered newest-first in DiffDialog (T80 .. T1)
    const turns = Array.from({ length: 80 }, (_, i) => ({
      turnIndex: 80 - i,
      stats: { filesCount: 1, linesAdded: 1, linesRemoved: 0 },
      files: [],
    }))
    const atNewest = computeTurnDiffWindow(turns, 80)
    expect(atNewest.visibleTurns.length).toBe(63)
    expect(atNewest.hasNewer).toBe(false)
    expect(atNewest.hasOlder).toBe(true)
    expect(atNewest.labelFor(atNewest.visibleTurns[0]!, 0)).toBe('T80')
    expect(
      atNewest.labelFor(
        atNewest.visibleTurns[atNewest.visibleTurns.length - 1]!,
        atNewest.visibleTurns.length - 1,
      ),
    ).toContain('(pick for older)')

    const atOldest = computeTurnDiffWindow(turns, 1)
    expect(atOldest.hasNewer).toBe(true)
    expect(atOldest.hasOlder).toBe(false)
    expect(atOldest.labelFor(atOldest.visibleTurns[0]!, 0)).toContain(
      '(pick for newer)',
    )
  })

  test('#1721: handlePromptSubmit and processUserInput accept leading-whitespace slash commands', () => {
    const submitSrc = readFileSync(
      join(ROOT, 'src/utils/handlePromptSubmit.ts'),
      'utf8',
    )
    const procSrc = readFileSync(
      join(ROOT, 'src/utils/processUserInput/processUserInput.ts'),
      'utf8',
    )
    expect(submitSrc).toContain(".trimStart().startsWith('/')")
    expect(procSrc).toContain(".trimStart().startsWith('/')")
  })

  test('#1723 & #1802: /context uses displayOnly + metaMessages, bounds top-10 rows, groups unloaded MCP tools by server', () => {
    const contextSrc = readFileSync(
      join(ROOT, 'src/commands/context/context.tsx'),
      'utf8',
    )
    expect(contextSrc).toContain("display: 'displayOnly'")
    expect(contextSrc).toContain('metaMessages')

    const loadedMcp = Array.from({ length: 12 }, (_, i) => ({
      name: `mcp__alpha__tool_${i}`,
      serverName: 'alpha',
      tokens: (12 - i) * 100,
      isLoaded: true,
    }))
    const unloadedMcp = [
      {
        name: 'mcp__beta__one',
        serverName: 'beta',
        tokens: 250,
        isLoaded: false,
      },
      {
        name: 'mcp__beta__two',
        serverName: 'beta',
        tokens: 350,
        isLoaded: false,
      },
    ]
    const md = formatContextAsMarkdownTable(
      {
        categories: [
          { name: 'System prompt', tokens: 1000, color: 'blue' },
          { name: 'MCP tools', tokens: 7800, color: 'cyan', isDeferred: true },
        ],
        totalTokens: 8800,
        maxTokens: 200000,
        rawMaxTokens: 200000,
        percentage: 4,
        gridRows: [],
        model: 'claude-sonnet-4-6',
        memoryFiles: [],
        mcpTools: [...loadedMcp, ...unloadedMcp],
        agents: [],
        skills: [],
        messageBreakdown: {
          toolCallTokens: 0,
          toolResultTokens: 0,
          attachmentTokens: 0,
          assistantMessageTokens: 0,
          userMessageTokens: 0,
          toolCallsByType: [],
          attachmentsByType: [],
        },
        isAutoCompactEnabled: true,
      } as never,
      { isBounded: true },
    )
    expect(md).toContain('| and 2 more |')
    expect(md).toContain('### Other MCP tools, by server')
    expect(md).toContain('| beta | 2 |')
  })

  test('#1727 & #1783: Auto mode server declined status + OSC-8 Link helper', () => {
    const props = buildAutoModeServerProperties('auto', {
      serverCheckDeclined: true,
    })
    expect(props.length).toBeGreaterThan(0)
    expect(props[0]!.label).toBe('Auto mode server')
    expect(props[0]!.value).toContain('Not reaching this session:')
    expect(props[0]!.value).toContain(AUTO_MODE_SERVER_DOCS_URL)
    expect(props[0]!.linkify).toBe(true)

    const linked = linkifyStatusText(`Docs: ${AUTO_MODE_SERVER_DOCS_URL}.`)
    expect(Array.isArray(linked)).toBe(true)
  })

  test('#1743: LogoV2 and WelcomeV2 prioritize did you mean suggestion for unrecognized model', () => {
    const logoSrc = readFileSync(
      join(ROOT, 'src/components/LogoV2/LogoV2.tsx'),
      'utf8',
    )
    const welcomeSrc = readFileSync(
      join(ROOT, 'src/components/LogoV2/WelcomeV2.tsx'),
      'utf8',
    )
    expect(logoSrc).toContain('did you mean "${notice.suggestion}"?')
    expect(welcomeSrc).toContain('did you mean "${notice.suggestion}"?')
  })

  test('#1745: login.tsx dismisses immediately on Enter and runs refresh in background', () => {
    const src = readFileSync(join(ROOT, 'src/commands/login/login.tsx'), 'utf8')
    expect(src).toContain('props.onDone(true')
    expect(src).toContain('refreshGrowthBookAfterAuthChange')
  })

  test('#1750: isGhosttyXtversion checks attacherCaps().isGhosttyXtv', () => {
    const src = readFileSync(
      join(ROOT, 'packages/@ant/ink/src/core/terminal.ts'),
      'utf8',
    )
    expect(src).toContain('isGhosttyXtv')
  })

  test('#1752: branch sets forkedFromSessionId & REPL exports RewindBackupsStillCopyingError', async () => {
    const { RewindBackupsStillCopyingError } = await import(
      '../../screens/REPL.js'
    )
    const err = new RewindBackupsStillCopyingError()
    expect(err.name).toBe('RewindBackupsStillCopyingError')
    const branchSrc = readFileSync(
      join(ROOT, 'src/commands/branch/branch.ts'),
      'utf8',
    )
    expect(branchSrc).toContain('forkedFromSessionId: originalSessionId')
    expect(branchSrc).toContain('file-history-snapshot')
  })

  test('#1760 & #1773: /clear preserves surviving background agents, teammates, workflows and their subtasks', async () => {
    const { computeSurvivingTaskIdsOnClear } = await import(
      '../../commands/clear/conversation.js'
    )
    const tasks = {
      bgAgent: {
        id: 'bgAgent',
        type: 'local_agent',
        status: 'running',
        isBackgrounded: true,
      },
      childShell: {
        id: 'childShell',
        type: 'local_bash',
        status: 'running',
        ownerAgentId: 'bgAgent',
      },
      mainShell: {
        id: 'mainShell',
        type: 'local_bash',
        status: 'running',
      },
      workflow: {
        id: 'workflow',
        type: 'local_workflow',
        status: 'running',
      },
      teammate: {
        id: 'teammate',
        type: 'in_process_teammate',
        status: 'running',
        identity: { agentId: 'teammate' },
      },
    }
    const surviving = computeSurvivingTaskIdsOnClear(tasks as never)
    expect(surviving.has('bgAgent')).toBe(true)
    expect(surviving.has('childShell')).toBe(true)
    expect(surviving.has('workflow')).toBe(true)
    expect(surviving.has('teammate')).toBe(true)
    expect(surviving.has('mainShell')).toBe(false)

    const clearSrc = readFileSync(
      join(ROOT, 'src/commands/clear/conversation.ts'),
      'utf8',
    )
    expect(clearSrc).toContain("subtype: 'background_tasks_changed'")
  })

  test('#1770 & #1803: cloud session /permissions and /usage fallback messages', () => {
    const permMsg = getCloudSessionPermissionsMessage({
      isRemoteSession: true,
      isManagedOnly: false,
    })
    expect(permMsg).toContain('.claude/settings.json')
    expect(permMsg).toContain(
      'https://code.claude.com/docs/en/settings#settings-in-cloud-sessions',
    )

    const managedPermMsg = getCloudSessionPermissionsMessage({
      isRemoteSession: true,
      isManagedOnly: true,
    })
    expect(managedPermMsg).toContain(
      'Your organization manages the permission rules for this session',
    )

    const usageMsg = getCloudSessionUsageFallbackMessage({
      isRemoteSession: true,
      ingressUrl: 'https://claude.ai',
    })
    expect(usageMsg).toContain('Settings → Usage')
    expect(usageMsg).toContain('https://claude.ai/settings/usage')
  })

  test('#1787: /rename warns when transcript or registry update fails', () => {
    const transcriptFail = formatRenameResultMessage({
      newName: 'my-session',
      requestedName: 'my-session',
      transcriptUpdated: false,
      registryUpdated: true,
    })
    expect(transcriptFail).toContain('transcript could not be updated')
    expect(transcriptFail).toContain('/rename my-session')

    const registryFail = formatRenameResultMessage({
      newName: 'my-session',
      requestedName: 'my-session',
      transcriptUpdated: true,
      registryUpdated: false,
    })
    expect(registryFail).toContain('session registry could not be updated')

    const ok = formatRenameResultMessage({
      newName: 'my-session',
      requestedName: 'my-session',
      transcriptUpdated: true,
      registryUpdated: true,
    })
    expect(ok).toBe('Session renamed to: my-session')
  })

  test('#1797: low-contrast color="subtle" migrated to dimColor in target UI components', () => {
    for (const rel of [
      'src/components/Stats.tsx',
      'src/components/ModelPicker.tsx',
      'src/components/FileEditToolUseRejectedMessage.tsx',
      'src/components/NotebookEditToolUseRejectedMessage.tsx',
      'src/components/Spinner.tsx',
    ]) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      expect(src).not.toContain('color="subtle"')
    }
  })

  test('#1801: ModelPicker builds unnumbered "More models" collapsible option', () => {
    const allOptions = [
      { value: 'a', label: 'A', description: 'Model A' },
      { value: 'b', label: 'B', description: 'Model B' },
      {
        value: 'c',
        label: 'C',
        description: 'Model C',
        overflow: true as const,
      },
      {
        value: 'd',
        label: 'D',
        description: 'Model D',
        overflow: true as const,
      },
    ]
    const collapsed = buildVisibleModelPickerOptions(allOptions, {
      currentValue: 'a',
      baseValue: 'a',
      expanded: false,
    })
    expect(collapsed.length).toBe(3)
    expect(collapsed[2]!.value).toBe(MORE_MODELS_OPTION_VALUE)
    expect(collapsed[2]!.label).toBe('More models')
    expect(
      'marker' in collapsed[2]! ? collapsed[2].marker : undefined,
    ).toBeDefined()

    const expanded = buildVisibleModelPickerOptions(allOptions, {
      currentValue: 'a',
      baseValue: 'a',
      expanded: true,
    })
    expect(expanded.map(o => o.value)).toEqual([
      'a',
      'b',
      MORE_MODELS_OPTION_VALUE,
      'c',
      'd',
    ])
  })

  test('#1813: isLoopKeepaliveGateEnabled defaults to false', () => {
    expect(isLoopKeepaliveGateEnabled()).toBe(false)
  })
})
