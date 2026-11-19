import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as growthbook from '../../../services/analytics/growthbook.js'
import { resolveAndInstallUpdatedPluginDependencies } from '../../../services/plugins/pluginOperations.js'
import { parseRootArgs } from '../../../self-hosted-runner/rootRunner.js'
import { buildSessionChildEnv } from '../../../self-hosted-runner/sessionChild.js'
import {
  allocateCheckoutFolderName,
  createInferenceRenewalRefusalReporter,
  isDefiniteInferenceRenewalRefusal,
} from '../../../self-hosted-runner/sessionHandler.js'
import {
  cleanupSessionSideFiles,
  computeRefusalRetryDelayMs,
  startIntervalRefreshLoop,
} from '../../../self-hosted-runner/sessionRuntime.js'
import {
  clearDynamicSkills,
  createSkillCommand,
  discoverSkillDirsForPaths,
  isNestedSkillDiscoveryWithheld,
  resetNestedDiscoveryWithheldForTesting,
} from '../../../skills/loadSkillsDir.js'
import * as configMod from '../../config.js'
import { SandboxManager } from '../../sandbox/sandbox-adapter.js'
import {
  substitutePluginSubagentStatusLine,
  substituteSubagentStatusLineCommand,
} from '../../subagentStatusLine.js'
import {
  hasOwnTrustDialogAcceptedForAddDir,
  isPersistedTrustIgnored,
  resetAddDirTrustWarningsForTesting,
} from '../addDirPluginSettings.js'
import {
  createDevModStampTracker,
  createDevModWatchHandlers,
  createDevModsWatchForTesting,
} from '../pluginDevMods.js'
import { adviseFileCreateGraders } from '../pluginEval/evalScaffold.js'
import { evalInterviewPrompt } from '../pluginEval/interviewPrompt.js'

const tempDirs: string[] = []
async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  delete process.env.CLAUDE_CODE_IGNORE_PERSISTED_TRUST
  delete process.env.SELF_HOSTED_RUNNER_REMOVE_SESSION_STATE
  resetNestedDiscoveryWithheldForTesting()
  clearDynamicSkills()
  resetAddDirTrustWarningsForTesting()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe('Wave 319 — Plugins / Skills-Dir / Self-Hosted-Runner alignment', () => {
  test('#1748: evalScaffold never suggests (max: 0) alone and interviewPrompt specifies min: 0, max: 0', () => {
    const advice = adviseFileCreateGraders(
      {
        slug: 'case-1',
        prompt: 'hello',
        execution: {
          allowed_tools: [],
          max_turns: 5,
          timeout_seconds: 60,
          runs: 1,
        },
        graders: [
          {
            name: 'no-monitor',
            type: 'tool_used',
            tool: 'Monitor',
            min: 1,
            weight: 1,
          },
        ],
      } as unknown as Parameters<typeof adviseFileCreateGraders>[0],
      [],
      {
        scaffolded: false,
        artifactPublishGranted: false,
        mockedTools: [],
      },
    )
    expect(advice.length).toBeGreaterThan(0)
    expect(advice[0]!.text).toContain(
      'Monitor is never available inside an eval run, so drop the grader',
    )
    expect(advice[0]!.text).not.toContain('(max: 0)')

    const prompt = evalInterviewPrompt('/tmp/p', undefined, 'evals')
    expect(prompt).toContain('set `min: 0`, `max: 0`, AND `arm: both`')
  })

  test('#1749 & #1789: post-update dependency install succeeds and reports dependencies_not_installed / dependencies_not_screened', async () => {
    const dir = await makeTmpDir('dep-upd-')
    const installed: string[] = []

    const ok = await resolveAndInstallUpdatedPluginDependencies({
      pluginId: 'app@mkt',
      pluginName: 'app',
      versionedPath: dir,
      scope: 'user',
      projectPath: undefined,
      manifest: {
        name: 'app',
        dependencies: ['dep-a'],
      } as unknown as Parameters<
        typeof resolveAndInstallUpdatedPluginDependencies
      >[0]['manifest'],
      lookupDependency: async id => {
        if (id === 'app@mkt') return { dependencies: ['dep-a'] }
        if (id === 'dep-a@mkt') return { dependencies: ['dep-b'] }
        if (id === 'dep-b@mkt') return { dependencies: [] }
        return null
      },
      isInstalledAtScope: () => false,
      installDependency: async depId => {
        installed.push(depId)
        return { success: true, message: 'ok', installPath: dir }
      },
      screenDependency: async () => {},
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.installedDependencies).toEqual(['dep-b@mkt', 'dep-a@mkt'])
    }
    expect(installed).toEqual(['dep-b@mkt', 'dep-a@mkt'])

    const failInstall = await resolveAndInstallUpdatedPluginDependencies({
      pluginId: 'app@mkt',
      pluginName: 'app',
      versionedPath: dir,
      scope: 'user',
      projectPath: undefined,
      manifest: { name: 'app', dependencies: ['dep-a'] } as never,
      lookupDependency: async id =>
        id === 'app@mkt' ? { dependencies: ['dep-a'] } : { dependencies: [] },
      isInstalledAtScope: () => false,
      installDependency: async () => ({
        success: false,
        message: 'network down',
      }),
    })
    expect(failInstall.ok).toBe(false)
    if (!failInstall.ok) {
      expect(failInstall.failureCode).toBe('dependencies_not_installed')
    }

    // Screening failure on escaping symlink
    const outsideDir = await makeTmpDir('dep-outside-')
    const outsideFile = join(outsideDir, 'secret.txt')
    await writeFile(outsideFile, 'secret')
    const depDir = await makeTmpDir('dep-escaped-')
    await symlink(outsideFile, join(depDir, 'escape-link'))

    const failScreen = await resolveAndInstallUpdatedPluginDependencies({
      pluginId: 'app@mkt',
      pluginName: 'app',
      versionedPath: dir,
      scope: 'user',
      projectPath: undefined,
      manifest: { name: 'app', dependencies: ['dep-a'] } as never,
      lookupDependency: async id =>
        id === 'app@mkt' ? { dependencies: ['dep-a'] } : { dependencies: [] },
      isInstalledAtScope: () => false,
      installDependency: async () => ({
        success: true,
        message: 'ok',
        installPath: depDir,
      }),
    })
    expect(failScreen.ok).toBe(false)
    if (!failScreen.ok) {
      expect(failScreen.failureCode).toBe('dependencies_not_screened')
    }
  })

  test('#1751: unlink clears stamp tracker and async read race cannot suppress re-creation', async () => {
    const tracker = createDevModStampTracker(() => 1000)
    let reloads = 0
    const stampA = { ctimeMs: 100, stamp: { size: 10, hash: 'aaa' } }

    let resolvePendingRead!: (v: typeof stampA | undefined) => void
    let slowFirst = true
    const handlers = createDevModWatchHandlers(
      tracker,
      () => {
        reloads++
      },
      async () => {
        if (slowFirst) {
          slowFirst = false
          return await new Promise(r => {
            resolvePendingRead = r
          })
        }
        return stampA
      },
    )

    // 1. In-flight add superseded by unlink: stale stamp must NOT be stored
    const p1 = handlers.onFileChange('/mod/a.ts')
    handlers.onUnlink('/mod/a.ts') // reloads = 1
    expect(reloads).toBe(1)
    resolvePendingRead(stampA)
    await p1
    expect(tracker.getState('/mod/a.ts')).toBeUndefined()

    // 2. File returns with stampA -> MUST trigger reload
    await handlers.onFileChange('/mod/a.ts')
    expect(reloads).toBe(2)
    tracker.markReloaded(true)

    // 3. Unlink clears cached stamp so returning with identical stampA reloads again
    handlers.onUnlink('/mod/a.ts')
    expect(reloads).toBe(3)
    expect(tracker.getState('/mod/a.ts')).toBeUndefined()

    await handlers.onFileChange('/mod/a.ts')
    expect(reloads).toBe(4)

    // 4. Transient delete during read (readStamp -> undefined) forgets stamp and fires reload
    const transientHandlers = createDevModWatchHandlers(
      tracker,
      () => {
        reloads++
      },
      async () => undefined,
    )
    await transientHandlers.onFileChange('/mod/a.ts')
    expect(tracker.getState('/mod/a.ts')).toBeUndefined()
    expect(reloads).toBe(5)
  })

  test('#1769: inference_token renewal refusal shortens retry delay and posts in-session warning after 5 refusals on dead token', async () => {
    const d1 = computeRefusalRetryDelayMs({
      refusals: 1,
      intervalMs: 1_440_000,
      random: () => 0.5,
    })
    const d2 = computeRefusalRetryDelayMs({
      refusals: 2,
      intervalMs: 1_440_000,
      random: () => 0.5,
    })
    const d5 = computeRefusalRetryDelayMs({
      refusals: 5,
      intervalMs: 1_440_000,
      random: () => 0.5,
    })
    expect(d1).toBe(60_000)
    expect(d2).toBe(120_000)
    expect(d5).toBe(1_440_000)

    expect(isDefiniteInferenceRenewalRefusal({ httpStatus: 400 })).toBe(true)
    expect(isDefiniteInferenceRenewalRefusal({ httpStatus: 500 })).toBe(false)

    const posted: Array<Record<string, unknown>> = []
    const statuses: string[] = []
    const telemetry: Array<{ outcome: string; meta: Record<string, number> }> =
      []
    const reporter = createInferenceRenewalRefusalReporter({
      sessionId: 'cse_test123',
      post: async ev => {
        posted.push(ev)
      },
      onStatus: msg => statuses.push(msg),
      over: () => false,
      now: () => Date.UTC(2026, 0, 1, 12, 0, 0),
      onTelemetry: (outcome, meta) => telemetry.push({ outcome, meta }),
    })

    // Below threshold -> no warning posted
    reporter.refused(
      { httpStatus: 400, serverMessage: 'token revoked' },
      {
        delayMs: 60_000,
        transient: false,
        expired: true,
        dead: true,
        definiteSinceSuccess: 4,
      },
    )
    await reporter.idle()
    expect(posted.length).toBe(0)

    // At threshold (5) with dead token -> warning + token_dead telemetry + ERROR status
    reporter.refused(
      { httpStatus: 400, serverMessage: 'token revoked' },
      {
        delayMs: 1_440_000,
        transient: false,
        expired: true,
        dead: true,
        definiteSinceSuccess: 5,
      },
    )
    await reporter.idle()
    expect(posted.length).toBe(1)
    expect(posted[0]!.tag).toBe('model_access_renewal_refused')
    expect(posted[0]!.level).toBe('warning')
    expect(telemetry[0]?.outcome).toBe('token_dead')
    expect(
      statuses.some(s => s.includes('ERROR: the server has refused')),
    ).toBe(true)

    // Renewal succeeds -> resumed notice posted
    reporter.renewed()
    await reporter.idle()
    expect(posted.length).toBe(2)
    expect(posted[1]!.tag).toBe('model_access_renewal_resumed')
    expect(telemetry[1]?.outcome).toBe('resumed')

    // Verify startIntervalRefreshLoop tracks definiteSinceSuccess & dead
    const ac = new AbortController()
    const seenInfos: Array<{ definiteSinceSuccess: number; dead: boolean }> = []
    const loop = startIntervalRefreshLoop({
      intervalMs: 10,
      ttlMs: 1,
      signal: ac.signal,
      isDefiniteRefusal: isDefiniteInferenceRenewalRefusal,
      now: () => Date.now(),
      refresh: async () => {
        throw Object.assign(new Error('bad request'), { httpStatus: 400 })
      },
      onError: (_err, info) => {
        seenInfos.push({
          definiteSinceSuccess: info.definiteSinceSuccess,
          dead: info.dead,
        })
        ac.abort()
      },
    })
    await new Promise(r => setTimeout(r, 40))
    loop.cancel()
    expect(seenInfos.length).toBe(1)
    expect(seenInfos[0]!.definiteSinceSuccess).toBe(1)
    expect(seenInfos[0]!.dead).toBe(true)
  })

  test('#1772: mod hot-reload state machine rolls back unpickedCount on person turns', async () => {
    const beginCbs: Array<() => void> = []
    const endCbs: Array<() => void> = []
    let personTurn = true
    let running = false
    let stoppedHow: string | undefined
    let askCount = 0

    const watch = createDevModsWatchForTesting('/tmp/fake-mods', {
      watchRoot: () => ({ close: async () => {} }),
      loaded: [],
      listChildren: async () => ['my-mod'],
      refusal: () => undefined,
      ask: async () => {
        askCount++
        return 'unpicked'
      },
      enable: async () => {},
      deferred: () => {},
      withdrawn: () => {},
      unanswered: () => {},
      stopped: how => {
        stoppedHow = how
      },
      clock: {
        now: () => Date.now(),
        setTimeout: fn => {
          queueMicrotask(fn)
          return () => {}
        },
      },
      turn: {
        isRunning: () => running,
        isPersonTurn: () => personTurn,
        onBegin: fn => {
          beginCbs.push(fn)
          return () => {}
        },
        onEnd: fn => {
          endCbs.push(fn)
          return () => {}
        },
      },
      quietMs: 0,
    })

    // Simulate 4 person turns without answering the prompt — must NOT shut off
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 10))
      running = true
      personTurn = true
      for (const cb of beginCbs) cb()
      running = false
      for (const cb of endCbs) cb()
    }
    await new Promise(r => setTimeout(r, 10))
    expect(askCount).toBeGreaterThanOrEqual(4)
    expect(stoppedHow).toBeUndefined()
    expect(watch.isClosed()).toBe(false)

    // Now simulate 3 non-person turns returning unpicked -> SHOULD stop with no_pick
    personTurn = false
    for (let i = 0; i < 4; i++) {
      running = true
      for (const cb of beginCbs) cb()
      running = false
      for (const cb of endCbs) cb()
      await new Promise(r => setTimeout(r, 10))
    }
    expect(stoppedHow).toBe('no_pick')
    expect(watch.isClosed()).toBe(true)
  })

  test('#1781: --trust-workspace false injects CLAUDE_CODE_IGNORE_PERSISTED_TRUST=1 and disables repo skill hooks & persisted add-dir trust', async () => {
    const envUntrusted = buildSessionChildEnv({
      sessionId: 'cse_1',
      sessionToken: 'tok',
      workerEpoch: 1,
      configDir: '/tmp/cfg',
      stageFileRoot: '/tmp/stage',
      apiBaseUrl: 'https://api.anthropic.com',
      inferenceAccessToken: 'inf',
      trustWorkspace: false,
    })
    expect(envUntrusted.CLAUDE_CODE_IGNORE_PERSISTED_TRUST).toBe('1')

    const envTrusted = buildSessionChildEnv({
      sessionId: 'cse_1',
      sessionToken: 'tok',
      workerEpoch: 1,
      configDir: '/tmp/cfg',
      stageFileRoot: '/tmp/stage',
      apiBaseUrl: 'https://api.anthropic.com',
      inferenceAccessToken: 'inf',
      trustWorkspace: true,
    })
    expect(envTrusted.CLAUDE_CODE_IGNORE_PERSISTED_TRUST).toBeUndefined()

    process.env.CLAUDE_CODE_IGNORE_PERSISTED_TRUST = '1'
    expect(isPersistedTrustIgnored()).toBe(true)

    const skillCmd = createSkillCommand({
      skillName: 'repo-skill',
      displayName: 'repo-skill',
      description: 'desc',
      hasUserSpecifiedDescription: true,
      markdownContent: 'body',
      allowedTools: [],
      argumentNames: [],
      argumentHint: undefined,
      whenToUse: undefined,
      version: undefined,
      model: undefined,
      disableModelInvocation: false,
      userInvocable: true,
      source: 'projectSettings',
      baseDir: '/tmp/repo/.claude/skills/repo-skill',
      loadedFrom: 'skills',
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'echo pwn' }] }],
      },
      executionContext: undefined,
      background: undefined,
      agent: undefined,
      paths: undefined,
      effort: undefined,
      shell: undefined,
    })
    expect(
      skillCmd.type === 'prompt' ? skillCmd.hooks : undefined,
    ).toBeUndefined()

    const addDir = await makeTmpDir('add-dir-ignore-trust-')
    const spyCfg = spyOn(configMod, 'getGlobalConfig').mockReturnValue({
      projects: { [addDir]: { hasTrustDialogAccepted: true } },
    } as never)
    try {
      expect(hasOwnTrustDialogAcceptedForAddDir(addDir)).toBe(false)
    } finally {
      spyCfg.mockRestore()
    }
  })

  test('#1788: subagentStatusLine substitutes ${CLAUDE_PLUGIN_ROOT}', () => {
    const cmd = substituteSubagentStatusLineCommand(
      '"${CLAUDE_PLUGIN_ROOT}/bin/status.sh" --flag',
      '/opt/my-plugin',
    )
    expect(cmd).toBe('"/opt/my-plugin/bin/status.sh" --flag')

    const settings = substitutePluginSubagentStatusLine(
      {
        subagentStatusLine: {
          type: 'command',
          command: '${CLAUDE_PLUGIN_ROOT}/scripts/row.js',
        },
      },
      { path: '/plugins/demo' },
    )
    expect((settings.subagentStatusLine as { command: string }).command).toBe(
      '/plugins/demo/scripts/row.js',
    )
  })

  test('#1811: --add-dir extraKnownMarketplaces requires directory own trust record (gated on tengu_tawny_thrush)', async () => {
    const parent = await realpath(await makeTmpDir('add-dir-parent-'))
    const child = join(parent, 'child')
    await mkdir(child, { recursive: true })

    // Only parent is trusted -> child must NOT inherit trust
    const spyCfg = spyOn(configMod, 'getGlobalConfig').mockReturnValue({
      projects: { [parent]: { hasTrustDialogAccepted: true } },
    } as never)
    try {
      expect(hasOwnTrustDialogAcceptedForAddDir(child)).toBe(false)
      expect(hasOwnTrustDialogAcceptedForAddDir(parent)).toBe(true)
    } finally {
      spyCfg.mockRestore()
    }
  })

  test('#1812: Bash sandbox suppresses nested .claude/skills discovery and latches nestedDiscoveryWithheld', async () => {
    const root = await makeTmpDir('sandbox-nested-')
    const subSkill = join(root, 'sub', '.claude', 'skills')
    await mkdir(subSkill, { recursive: true })
    const fileInSub = join(root, 'sub', 'index.ts')
    await writeFile(fileInSub, 'export {}')

    const spyGb = spyOn(
      growthbook,
      'getFeatureValue_CACHED_MAY_BE_STALE',
    ).mockReturnValue(true as never)
    let sandboxOn = true
    const spySandbox = spyOn(
      SandboxManager,
      'isSandboxingEnabled',
    ).mockImplementation(() => sandboxOn)
    try {
      const dirsWhileOn = await discoverSkillDirsForPaths([fileInSub], root)
      expect(dirsWhileOn).toEqual([])
      expect(isNestedSkillDiscoveryWithheld()).toBe(true)

      // Even if sandbox is turned off mid-session, nested discovery stays withheld
      sandboxOn = false
      const dirsAfterOff = await discoverSkillDirsForPaths([fileInSub], root)
      expect(dirsAfterOff).toEqual([])
    } finally {
      spyGb.mockRestore()
      spySandbox.mockRestore()
    }
  })

  test('#1825: allocateCheckoutFolderName appends -2, -3 on case-insensitive collisions', () => {
    const used = new Set<string>()
    expect(allocateCheckoutFolderName('app', used)).toBe('app')
    expect(allocateCheckoutFolderName('App', used)).toBe('App-2')
    expect(allocateCheckoutFolderName('APP', used)).toBe('APP-3')
    expect(allocateCheckoutFolderName('other', used)).toBe('other')
  })

  test('#1826: --remove-session-state controls failed debug log cleanup and debug upload is removed', async () => {
    const parsedDefault = parseRootArgs([])
    expect(parsedDefault.removeSessionState).toBe(false)

    const parsedFlag = parseRootArgs(['--remove-session-state'])
    expect(parsedFlag.removeSessionState).toBe(true)

    const parsedFalse = parseRootArgs(['--remove-session-state', 'false'])
    expect(parsedFalse.removeSessionState).toBe(false)

    process.env.SELF_HOSTED_RUNNER_REMOVE_SESSION_STATE = '1'
    expect(parseRootArgs([]).removeSessionState).toBe(true)

    const dir = await makeTmpDir('remove-state-')
    const debugKeep = join(dir, 'keep.txt')
    const debugRemove = join(dir, 'remove.txt')
    await writeFile(debugKeep, 'log1')
    await writeFile(debugRemove, 'log2')

    const msgs: string[] = []
    await cleanupSessionSideFiles({
      sessionId: 's1',
      exitResult: 'failed',
      debugFile: debugKeep,
      removeSessionState: false,
      onStatus: m => msgs.push(m),
    })
    expect(await Bun.file(debugKeep).exists()).toBe(true)
    expect(msgs.some(m => m.includes('preserved'))).toBe(true)

    await cleanupSessionSideFiles({
      sessionId: 's2',
      exitResult: 'failed',
      debugFile: debugRemove,
      removeSessionState: true,
      onStatus: m => msgs.push(m),
    })
    expect(await Bun.file(debugRemove).exists()).toBe(false)
  })
})
