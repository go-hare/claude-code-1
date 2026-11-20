/**
 * Wave 327-328 Group 4D — Commands / SettingsUI / Status / Usage / Config /
 * Export / InstallGithubApp / Artifacts / AutofixPR / Chrome / Statusline /
 * DesktopHandoff / Exit / ListAgents unit tests.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  resolveWorkflowsForExistingWorkflowAction,
  shouldConfirmBeforeRepoChanges,
} from '../install-github-app/install-github-app.js'
import {
  ExportFileExistsError,
  resolveExportFilePath,
  writeExportFile,
} from '../export/export.js'
import {
  type ArtifactPageResponse,
  fetchPaginatedArtifacts,
} from '../artifacts/scanner.js'
import { ARTIFACTS_PARTIAL_LOAD_WARNING } from '../artifacts/ArtifactsMenu.js'
import {
  formatAutofixCancelMessage,
  formatAutofixStopFailedMessage,
} from '../autofix-pr/AutofixProgress.js'
import { createAutofixCancelController } from '../autofix-pr/launchAutofixPr.js'
import { CHROME_PERMISSIONS_NOTICE } from '../chrome/chrome.js'
import listAgentsCommand from '../list-agents/index.js'
import { buildListAgentsDisplayOnlyMetaMessage } from '../list-agents/list-agents.js'
import { getStatuslineAllowedTools } from '../statusline.js'
import {
  getStatuslineConfigDirDisplay,
  getStatuslineSystemPrompt,
} from '../../../packages/builtin-tools/src/tools/AgentTool/built-in/statuslineSetup.js'
import {
  buildConfigAndFileDiagnostics,
  detectOtelMissingEndpointNotices,
  inspectHookMatcher,
  inspectSettingsConfigProblems,
} from '../../utils/status.js'
import { detectOtelMissingEndpointWarnings } from '../../utils/doctorDiagnostic.js'
import {
  resolveEffectivePluginModel,
  resolvePluginFootprintModelAndContext,
  skillListingCharBudget,
  skillListingCharsPerToken,
} from '../../utils/usagePluginFootprint.js'
import {
  listExitBackgroundItems,
  listExitInFlightItems,
} from '../../utils/exitBackgroundItems.js'
import {
  SETTINGS_SAVE_FAILED_MESSAGE,
  SETTINGS_SAVE_FAILED_NOTIFICATION_KEY,
} from '../../components/Settings/Config.js'
import type { Command } from '../../types/command.js'
import type { TaskState } from '../../tasks/types.js'

const ROOT = join(import.meta.dir, '../../..')

describe('#368, #496, #613 — /install-github-app confirmation, Select lists & workflow preservation', () => {
  test('#368: shouldConfirmBeforeRepoChanges confirms before pushing branch or saving secret', () => {
    expect(shouldConfirmBeforeRepoChanges('sk-ant-test', 'skip')).toBe(true)
    expect(shouldConfirmBeforeRepoChanges(null, 'update')).toBe(true)
    expect(shouldConfirmBeforeRepoChanges(null, 'create')).toBe(true)
    expect(shouldConfirmBeforeRepoChanges(null, 'skip')).toBe(false)
  })

  test('#613: updating or skipping an existing workflow keeps only claude without adding claude-code-review', () => {
    expect(
      resolveWorkflowsForExistingWorkflowAction('update', [
        'claude',
        'claude-review',
      ]),
    ).toEqual(['claude'])
    expect(
      resolveWorkflowsForExistingWorkflowAction('skip', [
        'claude',
        'claude-review',
      ]),
    ).toEqual(['claude'])
    expect(
      resolveWorkflowsForExistingWorkflowAction('exit', [
        'claude',
        'claude-review',
      ]),
    ).toEqual(['claude', 'claude-review'])
  })

  test('#368 & #496: ConfirmSetupStep and repo/secret/API key steps use Select lists', () => {
    const confirmSrc = readFileSync(
      join(ROOT, 'src/commands/install-github-app/ConfirmSetupStep.tsx'),
      'utf8',
    )
    const repoSrc = readFileSync(
      join(ROOT, 'src/commands/install-github-app/ChooseRepoStep.tsx'),
      'utf8',
    )
    const secretSrc = readFileSync(
      join(ROOT, 'src/commands/install-github-app/CheckExistingSecretStep.tsx'),
      'utf8',
    )
    const apiKeySrc = readFileSync(
      join(ROOT, 'src/commands/install-github-app/ApiKeyStep.tsx'),
      'utf8',
    )
    const mainSrc = readFileSync(
      join(ROOT, 'src/commands/install-github-app/install-github-app.tsx'),
      'utf8',
    )
    expect(confirmSrc).toContain('Yes, make these changes')
    expect(confirmSrc).toContain('No, cancel')
    expect(confirmSrc).toContain('<ConfirmSelect')
    expect(confirmSrc).toContain('focus="cancel"')
    expect(repoSrc).toContain('<Select')
    expect(secretSrc).toContain('<Select')
    expect(apiKeySrc).toContain('<Select')
    expect(mainSrc).toContain("case 'confirm-setup':")
    expect(mainSrc).toContain('saml_enforcement')
  })
})

describe('#371 & #544 — /status & claude doctor diagnostics', () => {
  test('#544: detectOtelMissingEndpointNotices and doctor warnings detect exporters missing endpoints', () => {
    const notices = detectOtelMissingEndpointNotices({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'otlp',
    })
    expect(notices.length).toBe(1)
    expect(notices[0]).toContain('metrics and logs')
    expect(notices[0]).toContain('OTEL_EXPORTER_OTLP_ENDPOINT')

    const satisfied = detectOtelMissingEndpointNotices({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com',
    })
    expect(satisfied).toEqual([])

    const doctorWarnings = detectOtelMissingEndpointWarnings({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_METRICS_EXPORTER: 'otlp',
    })
    expect(doctorWarnings.length).toBe(1)
    expect(doctorWarnings[0]!.issue).toContain('OpenTelemetry:')
    expect(doctorWarnings[0]!.fix).toContain('OTEL_EXPORTER_OTLP_ENDPOINT')
  })

  test('#371: inspectHookMatcher flags invalid regex, MCP server-only names, and rule syntax in matcher', () => {
    expect(inspectHookMatcher('PreToolUse', '[unclosed')).toEqual([
      "[unclosed isn't a valid regular expression",
    ])
    expect(inspectHookMatcher('PreToolUse', 'mcp__github')).toEqual([
      'mcp__github matches no tool · use mcp__github__.* (in a list, join names with |)',
    ])
    expect(inspectHookMatcher('PreToolUse', 'Bash(ls:*)')).toEqual([
      'Bash(ls:*) matches no tool · put the rule in "if"',
    ])
    expect(inspectHookMatcher('PreToolUse', 'Bash|Edit')).toEqual([])
    expect(inspectHookMatcher('PreToolUse', 'mcp__server__tool')).toEqual([])
    expect(inspectHookMatcher('Stop', 'ignored')).toEqual([])
  })

  test('#371: inspectSettingsConfigProblems flags ignored permission keys, misplaced top-level keys, and bad hook matchers', () => {
    const problems = inspectSettingsConfigProblems({
      permissions: {
        allow: ['Bash(ls:*)'],
        bogusPermKey: true,
      },
      allow: ['Read'],
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash(rm -rf:*)',
            hooks: [{ type: 'command', command: 'echo hi' }],
          },
        ],
      },
    })
    expect(problems.some(p => p.includes('permissions.bogusPermKey'))).toBe(
      true,
    )
    expect(
      problems.some(p => p.includes('allow is ignored outside permissions')),
    ).toBe(true)
    expect(
      problems.some(p => p.includes('Bash(rm -rf:*) matches no tool')),
    ).toBe(true)
  })

  test('#371: buildConfigAndFileDiagnostics surfaces broken agent, output-style, and skill/command files', () => {
    const brokenCmd = {
      type: 'prompt',
      name: 'bad-skill',
      description: 'bad',
      skillFile: { frontmatterProblem: 'invalid YAML frontmatter' },
    } as unknown as Command
    const items = buildConfigAndFileDiagnostics({
      failedAgentFiles: [
        { path: '.claude/agents/bad.md', error: 'missing name' },
      ],
      failedOutputStyleFiles: [
        { path: '.claude/output-styles/bad.md', error: 'bad yaml' },
      ],
      commands: [brokenCmd],
    })
    const joined = items.join('\n')
    expect(joined).toContain('bad.md not loaded: missing name')
    expect(joined).toContain('bad.md frontmatter: bad yaml')
    expect(joined).toContain('/bad-skill frontmatter: invalid YAML frontmatter')
  })
})

describe('#372, #395, #507, #603 — /config overrides, save-failed notice, unnumbered lists & search burst', () => {
  test('#395: save-failed notification constants match 2.1.327 wording', () => {
    expect(SETTINGS_SAVE_FAILED_NOTIFICATION_KEY).toBe('setting-not-saved')
    expect(SETTINGS_SAVE_FAILED_MESSAGE).toBe(
      "a settings change wasn't saved · check that your settings files are valid and writable",
    )
  })

  test('#372, #507, #603: Config.tsx wires override notice, hideIndexes, and synchronous isSearchModeRef', () => {
    const configSrc = readFileSync(
      join(ROOT, 'src/components/Settings/Config.tsx'),
      'utf8',
    )
    expect(configSrc).toContain('getConfigOverrideNotice')
    expect(configSrc).toContain('reportSaveResult')
    expect(configSrc).toContain('hideIndexes={!isScreenReaderModeEnabled()}')
    expect(configSrc).toContain('isSearchModeRef')
    expect(configSrc).toContain('setSearchModeSync')
  })
})

describe('#379 & #611 — /export EEXIST overwrite protection & empty filename rejection', () => {
  test('#611: resolveExportFilePath rejects empty or whitespace-only filenames (never writes .txt)', () => {
    expect(() => resolveExportFilePath('')).toThrow(/Filename can't be empty/i)
    expect(() => resolveExportFilePath('   ')).toThrow(
      /Filename can't be empty/i,
    )
    expect(() => resolveExportFilePath('.txt')).toThrow(
      /Filename can't be empty/i,
    )
    expect(resolveExportFilePath('notes', '/tmp/test-export')).toBe(
      '/tmp/test-export/notes.txt',
    )
    expect(resolveExportFilePath('notes.md', '/tmp/test-export')).toBe(
      '/tmp/test-export/notes.md',
    )
  })

  test('#379: writeExportFile refuses to overwrite in refuse mode and overwrites in overwrite mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'export-328-'))
    try {
      const target = join(dir, 'transcript.txt')
      writeFileSync(target, 'original', 'utf8')

      expect(() => writeExportFile(target, 'updated', 'refuse')).toThrow(
        ExportFileExistsError,
      )
      expect(readFileSync(target, 'utf8')).toBe('original')

      writeExportFile(target, 'updated', 'overwrite')
      expect(readFileSync(target, 'utf8')).toBe('updated')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#379 & #611: ExportDialog asks before overwriting and blocks empty name', () => {
    const dialogSrc = readFileSync(
      join(ROOT, 'src/components/ExportDialog.tsx'),
      'utf8',
    )
    expect(dialogSrc).toContain('Overwrite this file?')
    expect(dialogSrc).toContain('No, change the name')
    expect(dialogSrc).toContain('Yes, overwrite')
    expect(dialogSrc).toContain("Filename can't be empty")
  })
})

describe('#422 — /artifacts paginated cloud fetch with retry and partial warning', () => {
  test('retries transient errors and returns complete list when retry succeeds', async () => {
    let page2Attempts = 0
    const res = await fetchPaginatedArtifacts<{ id: string }>({
      fetchPage: async (
        token,
      ): Promise<ArtifactPageResponse<{ id: string }>> => {
        if (!token) {
          return { served: true, rows: [{ id: 'a1' }], nextPageToken: 'p2' }
        }
        page2Attempts++
        if (page2Attempts === 1) {
          return { served: false, status: 503, reason: 'unavailable' }
        }
        return { served: true, rows: [{ id: 'a2' }] }
      },
      retryDelaysMs: [1, 1],
      sleep: async () => {},
    })
    expect(res.incomplete).toBe(false)
    expect(res.items.map(i => i.id)).toEqual(['a1', 'a2'])
    expect(page2Attempts).toBe(2)
  })

  test('marks result incomplete after retries exhaust instead of silently showing partial list', async () => {
    let attempts = 0
    const res = await fetchPaginatedArtifacts<{ id: string }>({
      fetchPage: async (
        token,
      ): Promise<ArtifactPageResponse<{ id: string }>> => {
        if (!token) {
          return { served: true, rows: [{ id: 'a1' }], nextPageToken: 'p2' }
        }
        attempts++
        return { served: false, status: 502, reason: 'bad_gateway' }
      },
      retryDelaysMs: [1, 1],
      sleep: async () => {},
    })
    expect(res.incomplete).toBe(true)
    expect(res.items.map(i => i.id)).toEqual(['a1'])
    expect(attempts).toBe(3)
    expect(ARTIFACTS_PARTIAL_LOAD_WARNING).toBe("Couldn't load the whole list")
  })
})

describe('#437 — /statusline respects CLAUDE_CONFIG_DIR', () => {
  test('uses CLAUDE_CONFIG_DIR in system prompt and allowedTools instead of hardcoded ~/.claude', () => {
    const prev = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = '/tmp/custom-claude-cfg'
    try {
      expect(getStatuslineConfigDirDisplay()).toBe('/tmp/custom-claude-cfg')
      const prompt = getStatuslineSystemPrompt()
      expect(prompt).toContain('/tmp/custom-claude-cfg/settings.json')
      expect(prompt).toContain('/tmp/custom-claude-cfg/statusline-command.sh')
      const allowed = getStatuslineAllowedTools()
      expect(allowed).toContain('Read(/tmp/custom-claude-cfg/**)')
      expect(allowed).toContain('Edit(/tmp/custom-claude-cfg/settings.json)')
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prev
    }
  })
})

describe('#447 — /autofix-pr Esc-cancellable dialog & late stop-failure reporting', () => {
  test('closes immediately on Esc and reports late stop failure with session URL', async () => {
    const closed: string[] = []
    const lateFailures: string[] = []
    let releaseStop!: () => void
    const stopPromise = new Promise<boolean>(resolve => {
      releaseStop = () => resolve(false)
    })

    const controller = createAutofixCancelController({
      onDone: msg => closed.push(msg),
      stopSession: () => stopPromise,
      onLateStopFailure: msg => lateFailures.push(msg),
    })

    controller.setPhase('launching')
    controller.setStartedSessionId('sess-123')
    controller.cancelNow()

    // Dialog closes synchronously on Esc without waiting for the stop request
    expect(closed).toEqual([formatAutofixCancelMessage('launching')])
    expect(controller.isCancelled()).toBe(true)

    releaseStop()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(lateFailures.length).toBe(1)
    expect(lateFailures[0]).toContain('sess-123')
    expect(
      formatAutofixStopFailedMessage('https://claude.ai/code/sess-123'),
    ).toContain('https://claude.ai/code/sess-123')
  })
})

describe('#466 & #672 — /chrome Ctrl+C double-press & accurate permission wording', () => {
  test('permission wording explains permission mode and /permissions rules in both onboarding and /chrome', () => {
    expect(CHROME_PERMISSIONS_NOTICE).toContain(
      'Claude Code asks before Claude acts on a site, unless your permission mode or a rule in /permissions answers',
    )
    const onboardingSrc = readFileSync(
      join(ROOT, 'src/components/ClaudeInChromeOnboarding.tsx'),
      'utf8',
    )
    const chromeSrc = readFileSync(
      join(ROOT, 'src/commands/chrome/chrome.tsx'),
      'utf8',
    )
    expect(onboardingSrc).toContain('unless your permission mode or a rule in')
    expect(onboardingSrc).toContain('/permissions')
    expect(chromeSrc).toContain("view === 'select-browser'")
  })
})

describe('#495 & #497 — narrow 40-col layouts & DesktopHandoff Select list', () => {
  test('#495: Status and ModelPicker handle narrow ~40-column terminals cleanly', () => {
    const statusSrc = readFileSync(
      join(ROOT, 'src/components/Settings/Status.tsx'),
      'utf8',
    )
    const modelPickerSrc = readFileSync(
      join(ROOT, 'src/components/ModelPicker.tsx'),
      'utf8',
    )
    expect(statusSrc).toContain('isNarrow')
    expect(modelPickerSrc).toContain('isNarrow')
    expect(modelPickerSrc).toContain('←/→ to adjust')
  })

  test('#497: DesktopHandoff download prompt uses standard Select list instead of raw y/n', () => {
    const handoffSrc = readFileSync(
      join(ROOT, 'src/components/DesktopHandoff.tsx'),
      'utf8',
    )
    expect(handoffSrc).toContain('Download Claude Desktop?')
    expect(handoffSrc).toContain('Yes, download')
    expect(handoffSrc).toContain('Not now')
    expect(handoffSrc).toContain('<Select')
  })
})

describe('#618 — /usage model context window (1M uncapped) & active model fallback', () => {
  test('1M context model budget exceeds 2,000 tokens and resolveEffectivePluginModel resolves fallback', () => {
    const res1m = resolvePluginFootprintModelAndContext(
      'claude-opus-4-7[1m]',
      null,
    )
    expect(res1m.contextTokens).toBeGreaterThanOrEqual(1_000_000)
    expect(res1m.charsPerToken).toBe(3)
    const charBudget = skillListingCharBudget(
      res1m.contextTokens,
      res1m.charsPerToken,
    )
    expect(Math.round(charBudget / res1m.charsPerToken)).toBeGreaterThan(2_000)

    const resolvedDefault = resolveEffectivePluginModel(null, null)
    expect(typeof resolvedDefault).toBe('string')
    expect(resolvedDefault.length).toBeGreaterThan(0)
    expect(skillListingCharsPerToken('claude-opus-4-7')).toBe(3)
  })
})

describe('#620 — unified /exit & Ctrl+D background work list excluding stopped workflows', () => {
  test('listExitBackgroundItems and listExitInFlightItems agree and exclude stopped/completed workflows', () => {
    const tasks: Record<string, TaskState> = {
      runningWf: {
        id: 'runningWf',
        type: 'local_workflow',
        status: 'running',
        description: 'Active workflow',
        startTime: 1,
        outputFile: '',
        outputOffset: 0,
        notified: false,
      } as unknown as TaskState,
      stoppedWf: {
        id: 'stoppedWf',
        type: 'local_workflow',
        status: 'stopped',
        description: 'Stopped workflow',
        startTime: 2,
        outputFile: '',
        outputOffset: 0,
        notified: false,
      } as unknown as TaskState,
      runningBash: {
        id: 'runningBash',
        type: 'local_bash',
        status: 'running',
        description: 'npm run dev',
        command: 'npm run dev',
        isBackgrounded: true,
        startTime: 3,
        outputFile: '',
        outputOffset: 0,
        notified: false,
      } as unknown as TaskState,
      completedBash: {
        id: 'completedBash',
        type: 'local_bash',
        status: 'completed',
        description: 'echo done',
        command: 'echo done',
        isBackgrounded: true,
        startTime: 4,
        outputFile: '',
        outputOffset: 0,
        notified: false,
      } as unknown as TaskState,
    }

    const bgItems = listExitBackgroundItems(tasks, { backgroundOnly: false })
    const exitItems = listExitInFlightItems({ tasks })
    expect(exitItems).toEqual(bgItems)
    expect(exitItems).toEqual([
      { label: 'workflow', detail: 'Active workflow' },
      { label: 'shell', detail: 'npm run dev' },
    ])
    expect(exitItems.some(i => i.detail === 'Stopped workflow')).toBe(false)
  })
})

describe('#677 — /list-agents local command (user-only display, aliases: peers)', () => {
  test('command metadata, registration in src/commands.ts, and display-only meta message', () => {
    expect(listAgentsCommand.type).toBe('local')
    expect(listAgentsCommand.name).toBe('list-agents')
    expect(listAgentsCommand.aliases).toContain('peers')
    expect(listAgentsCommand.supportsNonInteractive).toBe(true)

    const metaWithTool = buildListAgentsDisplayOnlyMetaMessage(true)
    expect(metaWithTool).toContain('/list-agents')
    expect(metaWithTool).toContain('shown to the user and not to you')
    expect(metaWithTool).toContain('ListAgents')

    const metaWithoutTool = buildListAgentsDisplayOnlyMetaMessage(false)
    expect(metaWithoutTool).toContain('shown to the user and not to you')
    expect(metaWithoutTool).not.toContain('ListAgents')

    const commandsSrc = readFileSync(join(ROOT, 'src/commands.ts'), 'utf8')
    expect(commandsSrc).toContain('./commands/list-agents/index.js')
    expect(commandsSrc).toContain('listAgentsCmd')
  })
})
