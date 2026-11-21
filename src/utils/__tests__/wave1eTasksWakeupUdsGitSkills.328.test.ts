import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ScheduleWakeupTool,
  clearPendingWakeupOnFire,
} from '../../../packages/builtin-tools/src/tools/ScheduleWakeupTool/ScheduleWakeupTool.js'
import {
  getSessionId,
  setReplBridgeActive,
  setSessionIngressToken,
  switchSession,
} from '../../bootstrap/state.js'
import { isBgGatewayMarkEnabled } from '../../daemon/bgHostManagedEnv.js'
import { isCloudOrRemoteControlSession } from '../../services/rateLimitMessages.js'
import {
  clearInMemorySyncedSkills,
  discoverAndActivateSkillsForFilePath,
  removeInMemorySyncedSkill,
  retainInMemorySyncedSkill,
} from '../../skills/loadSkillsDir.js'
import {
  clearPendingSkillDownloads,
  hasPendingSkillDownload,
} from '../../skills/syncedSkillsHarden.js'
import { asSessionId } from '../../types/ids.js'
import type { Command } from '../../types/command.js'
import {
  buildGhStandinNoteTag,
  formatGhStandinNote,
} from '../agentProxy/ghStandin.js'
import { isBlockedByProjectConfigRoot } from '../cronTasks.js'
import { runWithCwdOverride } from '../cwd.js'
import { fetchGitDiff, fetchGitDiffHunks } from '../gitDiff.js'
import {
  drainBackgroundShutdownWork,
  hasPendingBackgroundShutdownWork,
  resetShutdownState,
  trackBackgroundShutdownWork,
} from '../gracefulShutdown.js'
import { runOrphanAgentResumePass } from '../orphanAgentResume.js'
import { readPendingWakeup, writePendingWakeup } from '../orphanCronResume.js'
import {
  createDesktopForwardGuard,
  createPeerAdmissionGuard,
  hashAddressToHopToken,
} from '../peerAdmission.js'
import {
  formatOlderCompatibleUpdateMessage,
  verifyOlderCandidateManifestVersion,
} from '../plugins/pluginEngineRange.js'
import {
  getSessionTaskListId,
  resetTaskListState,
  restoreSessionTaskListId,
  setLeaderTeamName,
  setSessionTaskListId,
} from '../tasks.js'
import { classifyInboundLocalHopChain } from '../udsMessaging.js'

const tempDirs: string[] = []
const originalCwd = process.cwd()
const originalArgv = [...process.argv]
const originalSessionId = getSessionId()

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  process.chdir(originalCwd)
  process.argv = [...originalArgv]
  delete process.env.CLAUDE_CONFIG_DIR
  delete process.env.CLAUDE_CODE_TASK_LIST_ID
  delete process.env.CLAUDE_JOB_DIR
  delete process.env.CLAUDE_CODE_REMOTE
  delete process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN
  delete process.env.CLAUDE_CODE_BRIDGE_MODE
  delete process.env.CLAUDE_PROJECT_CONFIG_ROOT
  delete process.env.CLAUDE_CODE_DISABLE_BG_GATEWAY_MARK
  setReplBridgeActive(false)
  setSessionIngressToken(null)
  switchSession(asSessionId(originalSessionId), null, 'clear')
  resetTaskListState()
  resetShutdownState()
  clearInMemorySyncedSkills()
  clearPendingSkillDownloads()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 1E P1-#45 — Tasks persistence & ScheduleWakeup pending wakeup', () => {
  test('setLeaderTeamName and setSessionTaskListId auto-persist .session-task-list', async () => {
    const cfgDir = makeTempDir('tasks-persist-')
    process.env.CLAUDE_CONFIG_DIR = cfgDir
    const sid = '11111111-2222-4333-8444-555555555555'
    switchSession(asSessionId(sid), null, 'resume')

    setLeaderTeamName('alpha-team')
    await new Promise(r => setTimeout(r, 30))
    resetTaskListState()
    expect(await restoreSessionTaskListId(sid)).toBe('alpha-team')
    expect(getSessionTaskListId()).toBe('alpha-team')

    setSessionTaskListId('beta-list')
    await new Promise(r => setTimeout(r, 30))
    resetTaskListState()
    expect(await restoreSessionTaskListId(sid)).toBe('beta-list')
  })

  test('ScheduleWakeupTool writes .pending-wakeup on arm and removes it on stop/fire', async () => {
    const jobDir = makeTempDir('wakeup-job-')
    process.env.CLAUDE_JOB_DIR = jobDir

    const armed = await ScheduleWakeupTool.call(
      { delaySeconds: 120, reason: 'check ci', prompt: 'check status' },
      { toolUseId: 'toolu_wave1e_1' },
    )
    expect(armed.data.scheduledFor).toBeGreaterThan(Date.now())

    const persisted = await readPendingWakeup(jobDir)
    expect(persisted).not.toBeNull()
    expect(persisted!.toolUseId).toBe('toolu_wave1e_1')
    expect(persisted!.scheduledFor).toBe(armed.data.scheduledFor)

    // Stopping clears .pending-wakeup
    const stopped = await ScheduleWakeupTool.call({ stop: true })
    expect(stopped.data.stopped).toBe(true)
    expect(await readPendingWakeup(jobDir)).toBeNull()

    // Re-arm and clear on fire
    await ScheduleWakeupTool.call(
      { delaySeconds: 120, reason: 'check ci', prompt: 'check status' },
      { toolUseId: 'toolu_wave1e_2' },
    )
    expect(await readPendingWakeup(jobDir)).not.toBeNull()
    await clearPendingWakeupOnFire()
    expect(await readPendingWakeup(jobDir)).toBeNull()
  })

  test('runOrphanAgentResumePass wires resurrectPendingWakeupFromScan for future wakeup', async () => {
    const jobDir = makeTempDir('orphan-wakeup-')
    const now = Date.now()
    const scheduledFor = now + 300_000
    await writePendingWakeup(jobDir, {
      toolUseId: 'toolu_resurrect_1',
      scheduledFor,
      chainStartedAt: now - 5_000,
    })

    const rearmed: Array<{ scheduledFor: number; prompt: string }> = []
    const res = await runOrphanAgentResumePass({
      sessionDir: jobDir,
      notify: false,
      resurrectCrons: false,
      rearmWakeup: args => {
        rearmed.push({ scheduledFor: args.scheduledFor, prompt: args.prompt })
      },
      messages: [
        {
          type: 'assistant',
          timestamp: new Date(now - 1_000).toISOString(),
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_resurrect_1',
                name: 'ScheduleWakeup',
                input: { prompt: 'poll deploy', reason: 'waiting' },
              },
            ],
          },
        },
        {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_resurrect_1',
              },
            ],
          },
          toolUseResult: { scheduledFor },
        },
      ],
    })

    expect(res.pendingWakeup).toEqual({
      kind: 'rearmed',
      scheduledFor,
      prompt: 'poll deploy',
    })
    expect(rearmed).toEqual([{ scheduledFor, prompt: 'poll deploy' }])
  })
})

describe('Wave 1E P1-#46 — Skills discovery & UDS local hop exemption + maxDesktopForwards', () => {
  test('FileRead/FileEdit/FileWrite delegate to discoverAndActivateSkillsForFilePath and Set<string> is accepted', async () => {
    for (const rel of [
      '../../../packages/builtin-tools/src/tools/FileReadTool/FileReadTool.ts',
      '../../../packages/builtin-tools/src/tools/FileEditTool/FileEditTool.ts',
      '../../../packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.ts',
    ]) {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
      expect(src).toContain('discoverAndActivateSkillsForFilePath(')
      expect(src).not.toContain('discoverSkillDirsForPaths(')
    }

    const triggers = new Set<string>()
    await discoverAndActivateSkillsForFilePath(
      join(originalCwd, 'package.json'),
      triggers,
    )
    expect(triggers).toBeInstanceOf(Set)
  })

  test('classifyInboundLocalHopChain routes verified local peer chain via shouldSkipLocalHopCount', () => {
    const tok = hashAddressToHopToken('uds:/tmp/a.sock')
    const skipped = classifyInboundLocalHopChain({
      authRole: 'peer',
      from: 'uds:/tmp/a.sock',
      localChain: tok,
      kernelPeerPid: 1234,
      authRequired: false,
      countLocalHops: false,
    })
    expect(skipped).toEqual({ verifiedLocal: true, fullHopChain: [tok] })

    const counted = classifyInboundLocalHopChain({
      authRole: 'peer',
      from: 'uds:/tmp/a.sock',
      localChain: tok,
      kernelPeerPid: 1234,
      authRequired: false,
      countLocalHops: true,
    })
    expect(counted).toEqual({ verifiedLocal: true, hopChain: [tok] })

    // Unverified child auth does not get verifiedLocal
    const unverified = classifyInboundLocalHopChain({
      authRole: 'child',
      from: 'uds:/tmp/a.sock',
      localChain: tok,
      kernelPeerPid: 1234,
      authRequired: false,
      countLocalHops: false,
    })
    expect(unverified).toEqual({})
  })

  test('PeerAdmissionGuard skips hop budget for verifiedLocal when countLocalHops is false, and DesktopForwardGuard enforces maxDesktopForwards', () => {
    const own = new Set(['self-tok'])
    const loopingChain = Array.from({ length: 12 }, () => 'self-tok')

    const localExemptGuard = createPeerAdmissionGuard({
      countLocalHops: false,
      maxSelfHops: 3,
    })
    expect(
      localExemptGuard.admit({
        senderKey: 'peer-1',
        body: 'hi',
        hopChain: loopingChain,
        ownTokens: own,
        verifiedLocal: true,
      }),
    ).toEqual({ admitted: true })

    // Non-local still rejected for hop-loop
    expect(
      localExemptGuard.admit({
        senderKey: 'peer-2',
        body: 'hi',
        hopChain: loopingChain,
        ownTokens: own,
        verifiedLocal: false,
      }),
    ).toEqual({ admitted: false, reason: 'hop-loop' })

    // countLocalHops: true enforces hop-loop even on verifiedLocal
    const strictGuard = createPeerAdmissionGuard({
      countLocalHops: true,
      maxSelfHops: 3,
    })
    expect(
      strictGuard.admit({
        senderKey: 'peer-3',
        body: 'hi',
        hopChain: loopingChain,
        ownTokens: own,
        verifiedLocal: true,
      }),
    ).toEqual({ admitted: false, reason: 'hop-loop' })

    // DesktopForwardGuard enforces maxDesktopForwards per prompt index
    const fwdGuard = createDesktopForwardGuard(() => ({
      maxDesktopForwards: 2,
    }))
    expect(fwdGuard.checkForward(1)).toEqual({ admitted: true })
    expect(fwdGuard.checkForward(1)).toEqual({ admitted: true })
    expect(fwdGuard.checkForward(1)).toEqual({
      admitted: false,
      reason: 'loop-paused',
      forwards: 2,
    })
    // Advancing prompt index resets budget
    expect(fwdGuard.checkForward(2)).toEqual({ admitted: true })
  })
})

describe('Wave 1E P1-#47/#48 & P2-#13b/#15 — GitDiff private index, shutdown work, synced skills, plugins, env vars', () => {
  test('gitDiff succeeds with private index copy even when .git/index.lock exists', async () => {
    const repo = makeTempDir('git-private-idx-')
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 't@example.com'], {
      cwd: repo,
      stdio: 'ignore',
    })
    execFileSync('git', ['config', 'user.name', 'Test'], {
      cwd: repo,
      stdio: 'ignore',
    })
    writeFileSync(join(repo, 'a.txt'), 'v1\n')
    execFileSync('git', ['add', 'a.txt'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'init'], {
      cwd: repo,
      stdio: 'ignore',
    })
    writeFileSync(join(repo, 'a.txt'), 'v1\nv2\n')
    // Simulate concurrent user git command holding .git/index.lock
    writeFileSync(join(repo, '.git', 'index.lock'), 'locked')

    await runWithCwdOverride(repo, async () => {
      const diff = await fetchGitDiff('uncommitted')
      expect(diff).not.toBeNull()
      expect(diff!.stats.filesCount).toBe(1)
      expect(diff!.stats.linesAdded).toBe(1)

      const hunks = await fetchGitDiffHunks('HEAD')
      expect(hunks).not.toBeNull()
      expect(hunks!.hunks.has('a.txt')).toBe(true)
    })
  })

  test('trackBackgroundShutdownWork safely handles rejecting promises and drains chained work', async () => {
    const rejecting = Promise.reject(new Error('bg fail'))
    trackBackgroundShutdownWork(rejecting)
    expect(hasPendingBackgroundShutdownWork()).toBe(true)
    await drainBackgroundShutdownWork()
    expect(hasPendingBackgroundShutdownWork()).toBe(false)
  })

  test('retainInMemorySyncedSkill wires pending download and remove/clear prune synced skill hooks', () => {
    const skillRoot = makeTempDir('synced-skill-root-')
    const cmd = {
      type: 'prompt',
      name: 'cloud-skill',
      description: 'desc',
      loadedFrom: 'syncedSkills',
      skillRoot,
      isHidden: false,
      progressMessage: 'running',
      userFacingName: () => 'cloud-skill',
      source: 'userSettings',
      getPromptForCommand: async () => [],
    } as unknown as Command

    let started = false
    const settle = retainInMemorySyncedSkill('id-1', cmd, {
      pendingDownloadStart: () => {
        started = true
      },
    })
    expect(hasPendingSkillDownload('cloud-skill')).toBe(true)
    settle?.({ ok: true })
    expect(hasPendingSkillDownload('cloud-skill')).toBe(false)
    expect(started).toBe(false)

    const prunedRoots: string[] = []
    removeInMemorySyncedSkill('id-1', {
      reason: 'skill_gone',
      removeHooksForRoots: roots => {
        prunedRoots.push(...roots)
        return roots.size
      },
    })
    expect(prunedRoots).toEqual([skillRoot])
  })

  test('pluginEngineRange 2.1.328 helpers, ghStandin ghOnly, and dead dispatchWatcher removal', () => {
    expect(
      verifyOlderCandidateManifestVersion(
        { version: '1.2.0', tag: { ref: 'v1.2.0' } },
        undefined,
      ),
    ).toBe('its tag has no plugin.json')
    expect(
      verifyOlderCandidateManifestVersion(
        { version: '1.2.0' },
        { version: '1.3.0' },
      ),
    ).toBe('its plugin.json says version 1.3.0')
    expect(
      formatOlderCompatibleUpdateMessage({
        baseMessage: 'Updated demo to 1.2.0.',
        rejectedVersion: '2.0.0',
        miss: {
          range: '>=2.2.0',
          claudeCodeVersion: '2.1.328',
          newerClaudeCodeMayFit: true,
        },
      }),
    ).toContain(
      "It's the newest that works on your version: 2.0.0 needs Claude Code >=2.2.0",
    )

    const tag = buildGhStandinNoteTag({ runner: true, ghOnly: true })
    expect(tag).toBe('builtin-api+runner+gh-only')
    expect(formatGhStandinNote(tag)).toContain(
      "which adds the session's GitHub sign-in if it has one",
    )

    expect(
      existsSync(join(import.meta.dir, '../../daemon/dispatchWatcher.ts')),
    ).toBe(false)
  })

  test('P2-#15 env alignment: bgGatewayMark uses GB, cronTasks ignores CLAUDE_PROJECT_CONFIG_ROOT env, rateLimitMessages uses isReplBridgeActive', () => {
    // 1. CLAUDE_CODE_DISABLE_BG_GATEWAY_MARK is ignored (official SWe reads GB tengu_bg_gateway_mark)
    process.env.CLAUDE_CODE_DISABLE_BG_GATEWAY_MARK = '1'
    expect(isBgGatewayMarkEnabled()).toBe(true)

    // 2. CLAUDE_PROJECT_CONFIG_ROOT env is ignored; --project-config-root argv flag blocks
    process.env.CLAUDE_PROJECT_CONFIG_ROOT = '/tmp/fake'
    expect(isBlockedByProjectConfigRoot()).toBe(false)
    process.argv = [...originalArgv, '--project-config-root', '/tmp/real']
    expect(isBlockedByProjectConfigRoot()).toBe(true)

    // 3. CLAUDE_CODE_BRIDGE_MODE env is ignored; isReplBridgeActive() & CLAUDE_CODE_SESSION_ACCESS_TOKEN work
    process.env.CLAUDE_CODE_BRIDGE_MODE = '1'
    expect(isCloudOrRemoteControlSession()).toBe(false)
    setReplBridgeActive(true)
    expect(isCloudOrRemoteControlSession()).toBe(true)
    setReplBridgeActive(false)
    setSessionIngressToken('sess-jwt')
    expect(isCloudOrRemoteControlSession()).toBe(true)
    setSessionIngressToken(null)
  })
})
