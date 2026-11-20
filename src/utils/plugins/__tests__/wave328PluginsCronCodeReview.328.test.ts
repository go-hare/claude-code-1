import { afterEach, describe, expect, test } from 'bun:test'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  formatQuickstartResult,
  partitionDesignSystemTokenFiles,
} from '../../../../packages/builtin-tools/src/tools/ArtifactTool/quickstartResult.js'
import {
  CODE_REVIEW_CELLS,
  CODE_REVIEW_NO_ISSUES,
  CODE_REVIEW_SEVERITIES,
  CODE_REVIEW_SEVERITY_LABELS,
  codeReview as codeReviewCommand,
  codeReviewEffortCell,
  formatCodeReviewFindings,
  formatCodeReviewForegroundForkResult,
} from 'src/commands/codeReview.js'
import {
  readCronTasksStrict,
  removeCronTasks,
  UNREADABLE_TASKS_ERROR,
  upsertCronTask,
} from 'src/utils/cronTasks.js'
import {
  HEADLESS_PLUGIN_RECORD_DRAIN_MS,
  installPluginsForHeadless,
  waitForHeadlessPluginInstallDrain,
} from '../headlessPluginInstall.js'
import { isManagedExternalGitPluginCandidate } from '../installedPluginsManager.js'
import {
  createDevModStampTracker,
  shouldDeferModReloadAfterTurnBegin,
} from '../pluginDevMods.js'
import {
  formatPluginHookApprovalWarnings,
  resolveEvalPermissionHookDecision,
} from '../pluginEval/report.js'
import type { RunReport } from '../pluginEval/types.js'
import {
  beginInitialPluginLoad,
  isInitialPluginLoadPending,
  markInitialPluginsLoaded,
  resetInitialPluginLoadForTests,
  waitForInitialPluginsLoaded,
} from '../pluginLoader.js'
import {
  buildHostOverlayManagedSettings,
  extractHostOverlayPolicyModConfigs,
  isAllowManagedModsOnlyEffective,
  mergeManagedSettingsWithHostOverlay,
  POLICY_MOD_PLUGIN_ID,
} from '../pluginPolicy.js'
import {
  ensurePluginAgentLoadedForResume,
  mergeCliAgentsIntoDefinitions,
} from '../refresh.js'

const tempDirs: string[] = []
async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  resetInitialPluginLoadForTests()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe('Wave 327-328 Plugins / Mods / Cron / ArtifactTool / CodeReview', () => {
  test('#398 mergeCliAgentsIntoDefinitions preserves --agents across plugin refreshes', () => {
    const cliAgent = {
      agentType: 'cli-custom',
      whenToUse: 'custom CLI agent',
      getSystemPrompt: () => 'cli prompt',
      source: 'flagSettings' as const,
    }
    const pluginAgent = {
      agentType: 'plug-agent',
      whenToUse: 'plugin agent',
      getSystemPrompt: () => 'plugin prompt',
      source: 'plugin' as const,
      plugin: 'my-plugin@local',
    }
    const merged = mergeCliAgentsIntoDefinitions(
      { allAgents: [pluginAgent], activeAgents: [pluginAgent] },
      [cliAgent],
    )
    expect(merged.allAgents.map(a => a.agentType)).toContain('cli-custom')
    expect(merged.activeAgents.map(a => a.agentType)).toContain('cli-custom')
    expect(merged.allAgents.map(a => a.agentType)).toContain('plug-agent')
  })

  test('#399 ensurePluginAgentLoadedForResume returns existing definitions when agent is already loaded or not a plugin agent', async () => {
    const pluginAgent = {
      agentType: 'my-plugin:reviewer',
      whenToUse: 'reviews code',
      getSystemPrompt: () => 'review',
      source: 'plugin' as const,
      plugin: 'my-plugin@local',
    }
    const alreadyPresent = await ensurePluginAgentLoadedForResume({
      resumedAgentName: 'my-plugin:reviewer',
      agentDefinitions: {
        allAgents: [pluginAgent],
        activeAgents: [pluginAgent],
      },
    })
    expect(alreadyPresent.activeAgents.map(a => a.agentType)).toContain(
      'my-plugin:reviewer',
    )

    // When no resumed agent name is provided, skips reload and returns existing definitions
    const noResume = await ensurePluginAgentLoadedForResume({
      resumedAgentName: undefined,
      agentDefinitions: { allAgents: [], activeAgents: [] },
    })
    expect(noResume.activeAgents).toEqual([])
  })

  test('#468 partitionDesignSystemTokenFiles omits absent token files from quickstart instructions', () => {
    const allPresent = partitionDesignSystemTokenFiles(false, [
      'api/tokens.md',
      'tokens.json',
      'colors_and_type.css',
    ])
    expect(allPresent.present.map(p => p.path)).toEqual([
      'api/tokens.md',
      'tokens.json',
    ])
    expect(allPresent.absent).toEqual([])

    const nonePresent = partitionDesignSystemTokenFiles(false, [
      'README.md',
      'other.css',
    ])
    expect(nonePresent.present).toEqual([])
    expect(nonePresent.absent.length).toBeGreaterThan(0)

    const output = formatQuickstartResult({
      quickstart: {
        intent: 'slides',
        match: {
          title: 'Slide Deck',
          type_url: 'https://artifacts.example/types/slides',
        },
        design_system: {
          title: 'Acme Brand',
          url: 'https://artifacts.example/ds/acme',
          token_files: ['README.md'],
          docs: [{ path: 'README.md', text: '# Acme Brand' }],
        },
      },
    })
    expect(output).toContain('Its file list has no')
    expect(output).not.toContain('`path`: "api/tokens.md"')
  })

  test('#518 plugin eval keeps deny rules over permission hook & flags plugin-approved calls', () => {
    expect(
      resolveEvalPermissionHookDecision({
        baseDecision: { behavior: 'deny', fromDenyRule: true },
        hookDecision: { behavior: 'allow' },
        toolName: 'Bash',
      }),
    ).toMatchObject({ behavior: 'deny', pluginApproval: 'refused' })

    expect(
      resolveEvalPermissionHookDecision({
        baseDecision: { behavior: 'ask' },
        hookDecision: { behavior: 'allow' },
        toolName: 'Bash',
      }),
    ).toMatchObject({ behavior: 'allow', pluginApproval: 'applied' })

    const warnings = formatPluginHookApprovalWarnings({
      approved: ['Bash', 'Bash'],
      refused: ['Write'],
    })
    expect(warnings.length).toBe(2)
    expect(warnings.join('\n')).toContain('Bash ×2')
    expect(warnings.join('\n')).toContain('Write')
  })

  test('#524 initial plugin load gate waits for load completion and respects AbortSignal', async () => {
    let resolveLoad!: () => void
    const p = new Promise<void>(resolve => {
      resolveLoad = resolve
    })
    beginInitialPluginLoad(p)
    expect(isInitialPluginLoadPending()).toBe(true)

    const ac = new AbortController()
    const waitAborted = waitForInitialPluginsLoaded(ac.signal)
    ac.abort()
    await expect(waitAborted).rejects.toThrow()

    const waitNormal = waitForInitialPluginsLoaded()
    resolveLoad()
    await waitNormal
    expect(isInitialPluginLoadPending()).toBe(false)

    // Explicit markInitialPluginsLoaded settles immediately
    resetInitialPluginLoadForTests()
    markInitialPluginsLoaded()
    expect(isInitialPluginLoadPending()).toBe(false)
  })

  test('#546 host overlay applies policy mod when admin did not configure one, and admin always wins', () => {
    const hostSettings = {
      allowManagedModsOnly: true,
      pluginConfigs: {
        [POLICY_MOD_PLUGIN_ID]: {
          options: { allowManagedModsOnly: true },
        },
      },
    }
    const configs = extractHostOverlayPolicyModConfigs(hostSettings)
    expect(configs).toEqual({
      [POLICY_MOD_PLUGIN_ID]: {
        options: { allowManagedModsOnly: true },
      },
    })

    const overlay = buildHostOverlayManagedSettings(hostSettings)
    expect(isAllowManagedModsOnlyEffective(overlay)).toBe(true)

    // Admin setting false overrides host overlay true
    const mergedAdminWins = mergeManagedSettingsWithHostOverlay(
      {
        pluginConfigs: {
          [POLICY_MOD_PLUGIN_ID]: {
            options: { allowManagedModsOnly: false },
          },
        },
      },
      overlay,
    )
    expect(isAllowManagedModsOnlyEffective(mergedAdminWins)).toBe(false)

    // When admin omits it, host overlay applies
    const mergedOverlayWins = mergeManagedSettingsWithHostOverlay({}, overlay)
    expect(isAllowManagedModsOnlyEffective(mergedOverlayWins)).toBe(true)
  })

  test('#560 & #561 cronTasks throws on unreadable file instead of erasing, and preserves malformed entries', async () => {
    const dir = await makeTempDir('cron-560-')
    const claudeDir = join(dir, '.claude')
    await mkdir(claudeDir, { recursive: true })
    const file = join(claudeDir, 'scheduled_tasks.json')

    // #561: valid + malformed/typoed entries coexist; mutating preserves unknown/malformed entries
    await writeFile(
      file,
      JSON.stringify({
        tasks: [
          {
            id: 'good-1',
            cron: '0 9 * * *',
            prompt: 'daily standup',
            createdAt: 1000,
          },
          {
            id: 'typo-1',
            cron: 'not-a-cron-expr',
            prompt: 'user is mid-edit',
            createdAt: 2000,
          },
        ],
      }),
    )

    const preserved: unknown[] = []
    const strict = await readCronTasksStrict(dir, preserved)
    expect(Array.isArray(strict)).toBe(true)
    if (Array.isArray(strict)) {
      expect(strict.map(t => t.id)).toEqual(['good-1'])
      expect(preserved).toHaveLength(1)
    }

    const addedId = 'added-1'
    await upsertCronTask(
      {
        id: addedId,
        cron: '*/5 * * * *',
        prompt: 'ping',
        recurring: true,
      },
      dir,
    )
    const rawAfterAdd = JSON.parse(await readFile(file, 'utf8')) as {
      tasks: Array<{ id?: string }>
    }
    expect(rawAfterAdd.tasks.map(t => t.id)).toContain('typo-1')
    expect(rawAfterAdd.tasks.map(t => t.id)).toContain(addedId)

    await removeCronTasks([addedId], dir)
    const rawAfterRemove = JSON.parse(await readFile(file, 'utf8')) as {
      tasks: Array<{ id?: string }>
    }
    expect(rawAfterRemove.tasks.map(t => t.id)).toContain('typo-1')

    // #560: unreadable file (EACCES) returns 'unreadable' and mutations throw instead of wiping
    if (process.getuid?.() !== 0) {
      await chmod(file, 0o000)
      try {
        const unreadable = await readCronTasksStrict(dir)
        expect(unreadable).toBe('unreadable')
        await expect(
          upsertCronTask(
            {
              id: 'fail-1',
              cron: '* * * * *',
              prompt: 'fail',
            },
            dir,
          ),
        ).rejects.toThrow(UNREADABLE_TASKS_ERROR)
      } finally {
        await chmod(file, 0o600)
      }
    }
  })

  test('#623 shouldDeferModReloadAfterTurnBegin defers reload only when file ctime changed after turn start', () => {
    expect(
      shouldDeferModReloadAfterTurnBegin({
        isTurnRunning: true,
        turnStartedAt: 1000,
        pendingCtimeMs: [1500.9],
        nowMs: 2000,
      }),
    ).toBe(true)
    expect(
      shouldDeferModReloadAfterTurnBegin({
        isTurnRunning: true,
        turnStartedAt: 2000,
        pendingCtimeMs: [1500],
        nowMs: 3000,
      }),
    ).toBe(false)
    expect(
      shouldDeferModReloadAfterTurnBegin({
        isTurnRunning: false,
        turnStartedAt: 1000,
        pendingCtimeMs: [1500],
        nowMs: 2000,
      }),
    ).toBe(false)
  })

  test('#643 isManagedExternalGitPluginCandidate identifies managed external git plugins excluding official', () => {
    expect(
      isManagedExternalGitPluginCandidate(
        'acme-tool@partner-market',
        { source: 'github', repo: 'acme/tool' },
        'managed',
      ),
    ).toBe(true)
    expect(
      isManagedExternalGitPluginCandidate(
        'acme-tool@claude-plugins-official',
        { source: 'github', repo: 'acme/tool' },
        'managed',
      ),
    ).toBe(false)
    expect(
      isManagedExternalGitPluginCandidate(
        'acme-tool@partner-market',
        { source: 'github', repo: 'acme/tool' },
        'user',
      ),
    ).toBe(false)
  })

  test('#644 headless plugin install drain waits cleanly within 30s budget', async () => {
    expect(HEADLESS_PLUGIN_RECORD_DRAIN_MS).toBe(30_000)
    expect(typeof installPluginsForHeadless).toBe('function')
    expect(await waitForHeadlessPluginInstallDrain(100)).toBe(true)
  })

  test('#664 & #665 /code-review bugs-only default cells and compact severity output', () => {
    expect(CODE_REVIEW_CELLS.default).toEqual({
      low: 'bugs-low-v1',
      medium: 'bugs-conventions-v1',
      high: 'bugs-conventions-v1',
      xhigh: 'bugs-conventions-xhigh-v1',
      max: 'bugs-conventions-max-v1',
    })
    expect(codeReviewEffortCell(undefined, 'medium')).toBe(
      'bugs-conventions-v1',
    )
    expect(CODE_REVIEW_SEVERITIES).toEqual(['important', 'pre_existing', 'nit'])
    expect(CODE_REVIEW_SEVERITY_LABELS.important).toContain('Important')
    expect(codeReviewCommand.description).toContain('/simplify')

    expect(formatCodeReviewFindings(JSON.stringify([]))).toBe(
      CODE_REVIEW_NO_ISSUES,
    )
    const formatted = formatCodeReviewFindings(
      JSON.stringify([
        {
          file: 'src/foo.ts',
          line: 42,
          severity: 'important',
          summary:
            'Null dereference: check user before reading id. Fix: guard with `if (!user) return`.',
        },
      ]),
    )
    expect(formatted).toContain('🔴 Important')
    expect(formatted).toContain('src/foo.ts:42')
    expect(formatted).toContain('Null dereference')

    const forkRes = formatCodeReviewForegroundForkResult(
      JSON.stringify([
        {
          file: 'src/bar.ts',
          line: 7,
          severity: 'nit',
          summary: 'Unused var: remove x. Fix: delete `const x`.',
        },
      ]),
    )
    expect(forkRes).toContain('🟡 Nit')
    expect(forkRes).toContain('src/bar.ts:7')

    expect(formatCodeReviewForegroundForkResult(JSON.stringify([]))).toBe(
      CODE_REVIEW_NO_ISSUES,
    )
  })

  test('#518 regression: crashed permission check with plugin allow stamps pluginApproval: refused', () => {
    const decision = resolveEvalPermissionHookDecision({
      baseDecision: {
        behavior: 'deny',
        checkCrashed: true,
        message: 'Permission check crashed',
      },
      hookDecision: { behavior: 'allow' },
      toolName: 'Bash',
    })
    expect(decision.behavior).toBe('deny')
    expect(decision.pluginApproval).toBe('refused')
    const warnings = formatPluginHookApprovalWarnings({
      approved: [],
      refused: ['Bash'],
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Bash')
  })

  test('#623 regression: createDevModStampTracker collects pending ctimeMs for mid-turn reload deferral', () => {
    const tracker = createDevModStampTracker(() => 5_000)
    expect(
      tracker.shouldReload('/mods/a.js', {
        ctimeMs: 12_500.4,
        stamp: { size: 10, hash: 'h1' },
      }),
    ).toBe(true)
    const pending = tracker.getPendingCtimeMs()
    expect(pending).toEqual([12_500.4])
    expect(
      shouldDeferModReloadAfterTurnBegin({
        turnStartedAt: 10_000,
        isTurnRunning: true,
        pendingCtimeMs: pending,
        nowMs: 15_000,
      }),
    ).toBe(true)
    tracker.markReloaded(true)
    expect(tracker.getPendingCtimeMs()).toEqual([])
  })
})
