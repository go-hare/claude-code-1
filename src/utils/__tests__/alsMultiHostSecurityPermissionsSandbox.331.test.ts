import { afterEach, describe, expect, test } from 'bun:test'
import {
  closeSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  SandboxManager as BaseSandboxManager,
  type SandboxAskCallback,
  type SandboxRuntimeConfig,
} from '@anthropic-ai/sandbox-runtime'
import {
  _setSpeculativeClassifierCheckForTesting,
  clearSpeculativeChecks,
  consumeSpeculativeClassifierCheck,
  peekSpeculativeClassifierCheck,
} from '@claude-code/builtin-tools/tools/BashTool/bashPermissions.js'
import {
  getFlagMcpConfigFilePaths as getBootstrapFlagMcpConfigFilePaths,
  setAdditionalDirectoriesForClaudeMd,
  setFlagMcpConfigFilePaths as setBootstrapFlagMcpConfigFilePaths,
  switchSession,
} from '../../bootstrap/state.js'
import {
  dropLeftoverPolicyHints,
  hintFromRefusedPolicyBody,
  isPolicyEnforced,
  leftoverPolicyLimitsHost,
  leftoverTaintsInclude,
} from '../../cli/leftoverTulip.js'
import {
  _resetPolicyLimitsForTesting,
  _setArtifactCreateNoticeForTesting,
  getArtifactCreateNotice,
} from '../../services/policyLimits/index.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import type { SessionId } from '../../types/ids.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { getCwd, runWithCwd } from '../cwd.js'
import {
  clearRepoVisibilityCache,
  resolveCurrentBranch,
  resolveOriginRepoState,
  seedRepoOriginCache,
} from '../permissions/autoModeRepoVisibility.js'
import {
  _resetForTesting as resetAutoModeStateForTesting,
  getAutoModeFlagCli,
  isAutoDefaultAwaitsServedSettings,
  isAutoModeActive,
  isAutoModeCircuitBroken,
  isAutoModeFromFallback,
  setAutoDefaultAwaitsServedSettings,
  setAutoModeActive,
  setAutoModeCircuitBroken,
  setAutoModeFlagCli,
  setAutoModeFromFallback,
} from '../permissions/autoModeState.js'
import type { ClassifierResult } from '../permissions/bashClassifier.js'
import {
  checkAndDisableBypassPermissionsIfNeeded,
  resetBypassPermissionsCheck,
} from '../permissions/bypassPermissionsKillswitch.js'
import {
  getBundledSkillsRoot,
  getClaudeTempDir,
  getFlagMcpConfigFilePaths as getFsFlagMcpConfigFilePaths,
  getResolvedWorkingDirPaths,
  getScratchpadDir,
  holdWorkingDirPathAsNamed,
  isClaudeSettingsPath,
  isWorkingDirPathHeldAsNamed,
  resolvedWorkingDirPaths,
  setFlagMcpConfigFilePaths as setFsFlagMcpConfigFilePaths,
  workingDirPathsHeldAsNamed,
} from '../permissions/filesystem.js'
import {
  emitPermissionRecheck,
  onPermissionRecheck,
} from '../permissions/permissionRecheck.js'
import {
  _resetWorktreeAddDirPinStateForTesting,
  _setAutoModeGateEnabledForTesting,
  getWorktreeAddDirPinState,
  isAutoModeGateEnabled,
  pinAddDirsForWorktreeLaunch,
} from '../permissions/permissionSetup.js'
import {
  checkAndLatchRemovalWaiverRulesClear,
  consumeClassifierOverflowCompact,
  consumePermissionPipelineResult,
  getRemovalWaiverRulesClearForTesting,
  markClassifierOverflowCompactSpent,
  recordPermissionPipelineResult,
  requestClassifierOverflowCompact,
  resetRemovalWaiverRulesClearForTesting,
} from '../permissions/permissions.js'
import {
  clearRestoredWorkerForPlanResumeForTests,
  isPlanModeResumeSkippedBecauseContinue,
  peekRestoredWorkerForPlanResume,
  setSkipPlanModeResumeBecauseContinue,
  stashRestoredWorkerForPlanResume,
  subscribeRestoredWorkerForPlanResume,
  takeRestoredWorkerForPlanResume,
} from '../permissions/planModeResume.js'
import {
  filterGatedAllowRules,
  resetProjectGrantsGateWarningsForTests,
} from '../permissions/projectGrantsGate.js'
import {
  resetSkillAllowedToolsWithheldForTests,
  withholdUntrustedSkillAllowedTools,
} from '../permissions/skillAllowedToolsTrust.js'
import {
  clearClassifierPolicySkipsForTesting,
  vetClassifierModel,
} from '../permissions/yoloClassifier.js'
import {
  _resetSandboxHeldStateForTesting,
  addSessionAllowedHost,
  clearSessionAllowedHostsForTests,
  convertToSandboxRuntimeConfig,
  getLastSandboxAskCallbackForTests,
  getSessionAllowedHosts,
  hasSandboxStartedOnce,
  SandboxManager,
} from '../sandbox/sandbox-adapter.js'
import {
  deriveScrubWriteRoots,
  getDenyLiteralSymlinkCandidates,
  getSymlinkedDenyScrubPaths,
  recordSymlinkedDenyPath,
  recordWrapWriteRoots,
  resetSymlinkedDenyScrubState,
} from '../sandbox/symlinkedDenyScrub.js'
import {
  getStagingDirIdentity,
  recordStagingDirIdentity,
  resetStagingDirIdentities,
} from '../sandbox/wrapPreflight.js'
import { runWithNewHostSession, runWithSession } from '../sessionHost.js'
import { settingsChangeDetector } from '../settings/changeDetector.js'
import { resetSettingsCache } from '../settings/settingsCache.js'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  clearSpeculativeChecks()
  setBootstrapFlagMcpConfigFilePaths([])
  resetBypassPermissionsCheck()
  resetAutoModeStateForTesting()
  resetRemovalWaiverRulesClearForTesting()
  _resetWorktreeAddDirPinStateForTesting()
  _setAutoModeGateEnabledForTesting(undefined)
  clearRestoredWorkerForPlanResumeForTests()
  clearRepoVisibilityCache()
  resetSkillAllowedToolsWithheldForTests()
  resetProjectGrantsGateWarningsForTests()
  clearClassifierPolicySkipsForTesting()
  resetSymlinkedDenyScrubState()
  resetStagingDirIdentities()
  _resetPolicyLimitsForTesting()
  clearSessionAllowedHostsForTests()
  _resetSandboxHeldStateForTesting()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('2.1.331 Multi-Host ALS Isolation: Security, Permissions, PolicyLimits & Sandbox', () => {
  test('flagMcpConfigFilePaths is single-source-of-truth between bootstrap/state and permissions/filesystem and isolates hosts', async () => {
    // Same function reference re-exported from bootstrap/state.ts
    expect(setFsFlagMcpConfigFilePaths).toBe(setBootstrapFlagMcpConfigFilePaths)
    expect(getFsFlagMcpConfigFilePaths).toBe(getBootstrapFlagMcpConfigFilePaths)

    const rootA = makeTempDir('mcp-flag-a-')
    const rootB = makeTempDir('mcp-flag-b-')
    const mcpA = join(rootA, 'custom-mcp-a.json')
    const mcpB = join(rootB, 'custom-mcp-b.json')
    writeFileSync(mcpA, '{"mcpServers":{}}')
    writeFileSync(mcpB, '{"mcpServers":{}}')

    await Promise.all([
      runWithNewHostSession(
        { id: 'sess-mcp-a', cwd: rootA, originalCwd: rootA },
        async () => {
          setBootstrapFlagMcpConfigFilePaths([mcpA])
          await Promise.resolve()
          expect(getFsFlagMcpConfigFilePaths()).toEqual([mcpA])
          expect(isClaudeSettingsPath(mcpA)).toBe(true)
          expect(isClaudeSettingsPath(mcpB)).toBe(false)
          const sbxCfg = convertToSandboxRuntimeConfig({})
          expect(sbxCfg.filesystem.denyWrite).toContain(mcpA)
          expect(sbxCfg.filesystem.denyWrite).not.toContain(mcpB)
        },
      ),
      runWithNewHostSession(
        { id: 'sess-mcp-b', cwd: rootB, originalCwd: rootB },
        async () => {
          await Promise.resolve()
          expect(getFsFlagMcpConfigFilePaths()).toEqual([])
          expect(isClaudeSettingsPath(mcpA)).toBe(false)

          setFsFlagMcpConfigFilePaths([mcpB])
          await Promise.resolve()
          expect(getBootstrapFlagMcpConfigFilePaths()).toEqual([mcpB])
          expect(isClaudeSettingsPath(mcpB)).toBe(true)
          expect(isClaudeSettingsPath(mcpA)).toBe(false)
        },
      ),
    ])
  })

  test('filesystem [W-166] HostSlot isolates temp/bundled-skills/resolved/named working dirs and global onSessionSwitch resets per-host cache', async () => {
    const dirA = makeTempDir('fs-host-a-')
    const dirB = makeTempDir('fs-host-b-')

    let bundledA = ''
    let bundledB = ''

    await Promise.all([
      runWithNewHostSession(
        { id: 'sess-fs-a', cwd: dirA, originalCwd: dirA },
        async () => {
          const tempA = getClaudeTempDir()
          expect(getClaudeTempDir.cache.has(undefined)).toBe(true)
          expect(getClaudeTempDir()).toBe(tempA)

          bundledA = getBundledSkillsRoot()
          expect(getBundledSkillsRoot.cache.has(undefined)).toBe(true)
          expect(getBundledSkillsRoot()).toBe(bundledA)

          holdWorkingDirPathAsNamed(dirA)
          expect(isWorkingDirPathHeldAsNamed(dirA)).toBe(true)
          expect(workingDirPathsHeldAsNamed.has(dirA)).toBe(true)
          expect(resolvedWorkingDirPaths.get(dirA)).toEqual([dirA])

          getResolvedWorkingDirPaths(dirA)
          expect(getResolvedWorkingDirPaths.cache.has(dirA)).toBe(true)
          const scratchBefore = getScratchpadDir()
          expect(scratchBefore).toContain('sess-fs-a')

          await Promise.resolve()

          // Host A still sees only dirA held as named
          expect(workingDirPathsHeldAsNamed.has(dirB)).toBe(false)
          expect(resolvedWorkingDirPaths.has(dirB)).toBe(false)

          // Switching session in Host A fires global onSessionSwitch and clears Host A's working-dir memo only
          switchSession('sess-fs-a-2' as SessionId, null, 'resume')
          expect(getResolvedWorkingDirPaths.cache.has(dirA)).toBe(false)
          expect(getScratchpadDir()).toContain('sess-fs-a-2')
        },
      ),
      runWithNewHostSession(
        { id: 'sess-fs-b', cwd: dirB, originalCwd: dirB },
        async () => {
          bundledB = getBundledSkillsRoot()
          expect(getBundledSkillsRoot()).toBe(bundledB)

          getResolvedWorkingDirPaths(dirB)
          expect(getResolvedWorkingDirPaths.cache.has(dirB)).toBe(true)

          await Promise.resolve()
          await Promise.resolve()

          // Host A's holdWorkingDirPathAsNamed and switchSession MUST NOT bleed into Host B
          expect(isWorkingDirPathHeldAsNamed(dirA)).toBe(false)
          expect(workingDirPathsHeldAsNamed.has(dirA)).toBe(false)
          expect(resolvedWorkingDirPaths.has(dirA)).toBe(false)
          expect(getResolvedWorkingDirPaths.cache.has(dirB)).toBe(true)
        },
      ),
    ])

    // Each host minted its own independent random nonce for bundled skills root
    expect(bundledA).not.toBe(bundledB)
  })

  test('policyLimitsHost [W-119] & policyLimits/index [W-247] isolate HIPAA/compliance taints, restrictions, verdicts & artifact notices across hosts', async () => {
    await Promise.all([
      runWithNewHostSession(
        { id: 'sess-pol-a', cwd: '/pol-a', originalCwd: '/pol-a' },
        async () => {
          const hostA = leftoverPolicyLimitsHost()
          expect(typeof hostA.verdict?.complianceTaintsSettled).toBe('function')

          hostA.complianceTaints.push('hipaa')
          hostA.hipaaEvidence.seen.push('acct-a')
          hostA.failOpenVerdict = true
          hintFromRefusedPolicyBody({
            compliance_taints: ['hipaa'],
            restrictions: { allow_telemetry: { allowed: false } },
          })
          hostA.sessionCache = { require_trusted_devices: { allowed: true } }
          _setArtifactCreateNoticeForTesting({ text: 'Host A artifact notice' })

          await Promise.resolve()

          expect(leftoverTaintsInclude('hipaa')).toBe(true)
          expect(isPolicyEnforced('require_trusted_devices')).toBe(true)
          expect(leftoverPolicyLimitsHost().hipaaEvidence.seen).toEqual([
            'acct-a',
          ])
          expect(getArtifactCreateNotice()).toBe('Host A artifact notice')

          dropLeftoverPolicyHints()
          expect(leftoverPolicyLimitsHost().hintedTaints).toEqual([])
          _resetPolicyLimitsForTesting()
          expect(getArtifactCreateNotice()).toBeNull()
        },
      ),
      runWithNewHostSession(
        { id: 'sess-pol-b', cwd: '/pol-b', originalCwd: '/pol-b' },
        async () => {
          const hostB = leftoverPolicyLimitsHost()
          expect(typeof hostB.verdict?.complianceTaintsSettled).toBe('function')
          _setArtifactCreateNoticeForTesting({ text: 'Host B artifact notice' })

          await Promise.resolve()
          await Promise.resolve()

          // Host B never sees Host A's HIPAA taint, evidence, sessionCache, or reset
          expect(leftoverTaintsInclude('hipaa')).toBe(false)
          expect(isPolicyEnforced('require_trusted_devices')).toBe(false)
          expect(leftoverPolicyLimitsHost().hipaaEvidence.seen).toEqual([])
          expect(leftoverPolicyLimitsHost().failOpenVerdict).toBe(false)
          expect(getArtifactCreateNotice()).toBe('Host B artifact notice')
        },
      ),
    ])
  })

  test('permissions security & auto-mode state isolate across concurrent hosts and root sessions', async () => {
    const prevEvenMore =
      process.env.CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS
    const prevHeldToAuto = process.env.CLAUDE_CODE_BRIDGE_CHILD_HELD_TO_AUTO
    process.env.CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS = '1'
    process.env.CLAUDE_CODE_BRIDGE_CHILD_HELD_TO_AUTO = '1'

    const origConsoleError = console.error
    const consoleErrors: string[] = []
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '))
    }

    try {
      const recheckA: number[] = []
      const recheckB: number[] = []
      const restoredA: unknown[] = []
      const restoredB: unknown[] = []

      const rootA = makeTempDir('perm-host-a-')
      const rootB = makeTempDir('perm-host-b-')

      await Promise.all([
        runWithNewHostSession(
          { id: 'sess-perm-a', cwd: rootA, originalCwd: rootA },
          async sessionA => {
            // 1. bypassPermissionsKillswitch [W-381]
            let bypassUpdatesA = 0
            await checkAndDisableBypassPermissionsIfNeeded(
              getEmptyToolPermissionContext(),
              updater => {
                bypassUpdatesA += 1
                updater(getDefaultAppState())
              },
            )
            expect(bypassUpdatesA).toBe(1)

            // 2. autoModeState [W-068]
            setAutoModeActive(true)
            setAutoModeFlagCli(true)
            setAutoModeCircuitBroken(true)
            setAutoModeFromFallback(true)
            setAutoDefaultAwaitsServedSettings(true)

            // 3. permissions.ts [$e-095]: removalWaiverRulesClear, classifierOverflowCompactByAgent, permissionPipelineResultsByToolUseId
            checkAndLatchRemovalWaiverRulesClear({
              ...getEmptyToolPermissionContext(),
              blockReadsOutsideWorkingDirectories: true,
            })
            expect(getRemovalWaiverRulesClearForTesting()).toBe(false)
            // Fork of Session A shares root session's RootSessionSlot
            const forkA = sessionA.withProject({ cwd: join(rootA, 'sub') })
            runWithSession(forkA, () => {
              expect(getRemovalWaiverRulesClearForTesting()).toBe(false)
            })

            consumeClassifierOverflowCompact(
              'agent-1',
              [{ uuid: 'ep-1' }],
              true,
            )
            expect(
              requestClassifierOverflowCompact('agent-1', [{ uuid: 'ep-1' }], {
                toolName: 'Bash',
                denied: true,
                mode: 'auto',
              }),
            ).toBe('requested')
            recordPermissionPipelineResult('tu-shared', {
              behavior: 'deny',
              message: 'denied in A',
              decisionReason: { type: 'other', reason: 'test-a' },
            })

            // 4. permissionSetup.ts [W-268]: worktreeAddDirPinState & autoModeGateEnabledOverride
            setAdditionalDirectoriesForClaudeMd(['./sub-a'])
            pinAddDirsForWorktreeLaunch(rootA, false, rootA)
            expect(getWorktreeAddDirPinState().launchFolder).toBe(rootA)
            _setAutoModeGateEnabledForTesting(true)
            expect(isAutoModeGateEnabled()).toBe(true)

            // 5. permissionRecheck.ts
            const unsubRecheckA = onPermissionRecheck(() => recheckA.push(1))

            // 6. planModeResume.ts
            setSkipPlanModeResumeBecauseContinue(true)
            const unsubRestoredA = subscribeRestoredWorkerForPlanResume(r =>
              restoredA.push(r),
            )
            stashRestoredWorkerForPlanResume({
              internal: { worker_permission_mode: 'plan' },
            })

            // 7. autoModeRepoVisibility.ts [W-214/215/216]
            seedRepoOriginCache('/shared/repo', {
              branch: 'branch-a',
              host: 'github.com',
              slug: 'org-a/repo-a',
              visibility: 'public',
            })

            // 8. skillAllowedToolsTrust [W-128], projectGrantsGate [W-130], yoloClassifier [$e-153]
            withholdUntrustedSkillAllowedTools(
              'my-skill',
              'projectSettings',
              undefined,
              ['Bash'],
            )
            filterGatedAllowRules([
              {
                source: 'projectSettings',
                ruleBehavior: 'allow',
                ruleValue: { toolName: 'Bash', ruleContent: 'echo a' },
              },
            ])
            expect(vetClassifierModel('claude-opus-5', 'env')).toBeUndefined()

            await Promise.resolve()

            // Emit inside Host A: only Host A's listener fires
            emitPermissionRecheck()
            expect(recheckA).toEqual([1])
            expect(recheckB).toEqual([])
            expect(restoredA).toHaveLength(1)
            expect(restoredB).toHaveLength(0)

            expect(consumePermissionPipelineResult('tu-shared')?.behavior).toBe(
              'deny',
            )
            expect(await resolveCurrentBranch('/shared/repo')).toBe('branch-a')
            expect(await resolveOriginRepoState('/shared/repo')).toEqual({
              host: 'github.com',
              slug: 'org-a/repo-a',
              visibility: 'public',
            })
            markClassifierOverflowCompactSpent('agent-1', 'ep-1')

            unsubRecheckA()
            unsubRestoredA()
          },
        ),
        runWithNewHostSession(
          { id: 'sess-perm-b', cwd: rootB, originalCwd: rootB },
          async () => {
            await Promise.resolve()

            // 1. bypassPermissionsKillswitch MUST still run in Host B (not blocked by Host A's run-once latch)
            let bypassUpdatesB = 0
            await checkAndDisableBypassPermissionsIfNeeded(
              getEmptyToolPermissionContext(),
              updater => {
                bypassUpdatesB += 1
                updater(getDefaultAppState())
              },
            )
            expect(bypassUpdatesB).toBe(1)

            // 2. autoModeState is clean in Host B
            expect(isAutoModeActive()).toBe(false)
            expect(getAutoModeFlagCli()).toBe(false)
            expect(isAutoModeCircuitBroken()).toBe(false)
            expect(isAutoModeFromFallback()).toBe(false)
            expect(isAutoDefaultAwaitsServedSettings()).toBe(false)

            // 3. permissions.ts RootSessionSlot is clean in Session B
            expect(getRemovalWaiverRulesClearForTesting()).toBeUndefined()
            checkAndLatchRemovalWaiverRulesClear(
              getEmptyToolPermissionContext(),
            )
            expect(getRemovalWaiverRulesClearForTesting()).toBe(true)

            expect(
              requestClassifierOverflowCompact('agent-1', [{ uuid: 'ep-1' }], {
                toolName: 'Bash',
                denied: false,
                mode: 'auto',
              }),
            ).toBeUndefined()
            expect(consumePermissionPipelineResult('tu-shared')).toBeUndefined()

            // 4. permissionSetup.ts HostSlot is clean in Host B
            expect(getWorktreeAddDirPinState().launchFolder).toBeUndefined()
            expect(isAutoModeGateEnabled()).toBe(false)

            // 5. permissionRecheck.ts isolated
            const unsubRecheckB = onPermissionRecheck(() => recheckB.push(1))

            // 6. planModeResume.ts isolated
            expect(isPlanModeResumeSkippedBecauseContinue()).toBe(false)
            expect(peekRestoredWorkerForPlanResume()).toBeNull()
            const unsubRestoredB = subscribeRestoredWorkerForPlanResume(r =>
              restoredB.push(r),
            )
            expect(takeRestoredWorkerForPlanResume()).toBeNull()

            // 7. autoModeRepoVisibility.ts isolated
            seedRepoOriginCache('/shared/repo', {
              branch: 'branch-b',
              host: 'github.com',
              slug: 'org-b/repo-b',
              visibility: 'private',
            })
            expect(await resolveCurrentBranch('/shared/repo')).toBe('branch-b')
            expect(await resolveOriginRepoState('/shared/repo')).toEqual({
              host: 'github.com',
              slug: 'org-b/repo-b',
              visibility: 'private',
            })

            // 8. projectGrantsGate warns independently in Host B (console.error called twice total: once in A, once in B)
            const errorsBeforeB = consoleErrors.length
            filterGatedAllowRules([
              {
                source: 'projectSettings',
                ruleBehavior: 'allow',
                ruleValue: { toolName: 'Bash', ruleContent: 'echo b' },
              },
            ])
            expect(consoleErrors.length).toBe(errorsBeforeB + 1)
            withholdUntrustedSkillAllowedTools(
              'my-skill',
              'projectSettings',
              undefined,
              ['Bash'],
            )
            expect(vetClassifierModel('claude-opus-5', 'env')).toBeUndefined()

            unsubRecheckB()
            unsubRestoredB()
          },
        ),
      ])
    } finally {
      console.error = origConsoleError
      if (prevEvenMore === undefined) {
        delete process.env.CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS
      } else {
        process.env.CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS =
          prevEvenMore
      }
      if (prevHeldToAuto === undefined) {
        delete process.env.CLAUDE_CODE_BRIDGE_CHILD_HELD_TO_AUTO
      } else {
        process.env.CLAUDE_CODE_BRIDGE_CHILD_HELD_TO_AUTO = prevHeldToAuto
      }
    }
  })

  test('symlinkedDenyScrub & wrapPreflight isolate per-host scrub state, getCwd(), and staging dir FDs', async () => {
    const dirA = makeTempDir('sbx-scrub-a-')
    const dirB = makeTempDir('sbx-scrub-b-')
    const targetA = join(dirA, 'target-a.txt')
    const linkA = join(dirA, 'link-a.txt')
    const regularB = join(dirB, 'regular-b.txt')
    writeFileSync(targetA, 'a')
    symlinkSync(targetA, linkA)
    writeFileSync(regularB, 'b')

    const stageA = join(dirA, 'stage')
    const stageB = join(dirB, 'stage')
    mkdirSync(stageA, { recursive: true })
    mkdirSync(stageB, { recursive: true })

    let fdB: number | undefined

    try {
      await Promise.all([
        runWithNewHostSession(
          { id: 'sess-scrub-a', cwd: dirA, originalCwd: dirA },
          async () => {
            recordSymlinkedDenyPath(linkA)
            recordWrapWriteRoots({
              filesystem: { allowWrite: ['.'], denyWrite: [] },
            })
            const fdA = openSync(stageA, 'r')
            recordStagingDirIdentity(stageA, 10, 100, fdA)

            await Promise.resolve()

            expect(getSymlinkedDenyScrubPaths().length).toBe(1)
            expect(getDenyLiteralSymlinkCandidates()).toEqual([])
            const rootsA = deriveScrubWriteRoots({
              filesystem: { allowWrite: ['.'], denyWrite: [] },
            })
            expect(rootsA).toContain(dirA)
            expect(getStagingDirIdentity(stageA)?.fd).toBe(fdA)
            expect(getStagingDirIdentity(stageB)).toBeUndefined()

            // Resetting Host A closes Host A's FD only and clears Host A's scrub state only
            resetSymlinkedDenyScrubState()
            expect(getSymlinkedDenyScrubPaths()).toEqual([])
            expect(getStagingDirIdentity(stageA)).toBeUndefined()
          },
        ),
        runWithNewHostSession(
          { id: 'sess-scrub-b', cwd: dirB, originalCwd: dirB },
          async () => {
            recordSymlinkedDenyPath(regularB)
            fdB = openSync(stageB, 'r')
            recordStagingDirIdentity(stageB, 20, 200, fdB)

            // Wait until Host A finishes resetSymlinkedDenyScrubState() / resetStagingDirIdentities()
            await Promise.resolve()
            await Promise.resolve()

            // Host B's scrub state and open directory FD MUST remain intact!
            expect(getSymlinkedDenyScrubPaths()).toEqual([])
            expect(getDenyLiteralSymlinkCandidates()).toEqual([regularB])
            expect(getStagingDirIdentity(stageB)).toEqual({
              dev: 20,
              ino: 200,
              fd: fdB,
            })
            // Verify fdB is still genuinely open in the OS!
            expect(fstatSync(fdB).isDirectory()).toBe(true)

            resetStagingDirIdentities()
            fdB = undefined
          },
        ),
      ])
    } finally {
      if (fdB !== undefined) {
        try {
          closeSync(fdB)
        } catch {
          // already closed
        }
      }
    }
  })

  test('sandbox-adapter multi-host lifecycle: Host B init join, sessionAllowedHosts union, askCallback routing, isolated reset, and settings hot-reload', async () => {
    const tempConfigDir = makeTempDir('sbx-lifecycle-cfg-')
    writeFileSync(
      join(tempConfigDir, 'settings.json'),
      JSON.stringify({ sandbox: { enabled: true } }),
    )
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tempConfigDir
    resetSettingsCache()

    const origInitialize = BaseSandboxManager.initialize
    const origUpdateConfig = BaseSandboxManager.updateConfig
    const origReset = BaseSandboxManager.reset
    const origCheckDeps = BaseSandboxManager.checkDependencies

    let initCalls = 0
    let resetCalls = 0
    const updatedConfigs: SandboxRuntimeConfig[] = []
    let capturedWrappedAsk: SandboxAskCallback | undefined

    BaseSandboxManager.checkDependencies = () => ({
      errors: [],
      warnings: [],
    })
    BaseSandboxManager.initialize = async (
      runtimeConfig: SandboxRuntimeConfig,
      askCallback?: SandboxAskCallback,
    ) => {
      initCalls += 1
      updatedConfigs.push(runtimeConfig)
      capturedWrappedAsk = askCallback
    }
    BaseSandboxManager.updateConfig = (runtimeConfig: SandboxRuntimeConfig) => {
      updatedConfigs.push(runtimeConfig)
    }
    BaseSandboxManager.reset = async () => {
      resetCalls += 1
    }

    // Ensure clean starting state before test
    await SandboxManager.reset()
    resetCalls = 0
    updatedConfigs.length = 0

    try {
      if (!SandboxManager.isSupportedPlatform()) {
        return
      }

      const askACalls: string[] = []
      const askBCalls: string[] = []
      const askA: SandboxAskCallback = async pattern => {
        askACalls.push(pattern.host)
        return true
      }
      const askB: SandboxAskCallback = async pattern => {
        askBCalls.push(pattern.host)
        return false
      }

      const wsA = makeTempDir('sbx-ws-a-')
      const wsB = makeTempDir('sbx-ws-b-')
      const wsC = makeTempDir('sbx-ws-c-')

      await runWithNewHostSession(
        { id: 'sess-sbx-life-a', cwd: wsA, originalCwd: wsA },
        async sessionA => {
          await SandboxManager.initialize(askA)
          expect(initCalls).toBe(1)
          expect(hasSandboxStartedOnce()).toBe(true)
          expect(getLastSandboxAskCallbackForTests()).toBe(askA)

          addSessionAllowedHost('a.com')
          expect([...getSessionAllowedHosts()]).toEqual(['a.com'])

          // Fix 1 + Fix 2 + Fix 3: Host B joins while Host A is live
          await runWithNewHostSession(
            { id: 'sess-sbx-life-b', cwd: wsB, originalCwd: wsB },
            async sessionB => {
              await SandboxManager.initialize(askB)
              // Shared BaseSandboxManager.initialize was NOT called a second time
              expect(initCalls).toBe(1)
              // Fix 1: Host B STILL marks itself started and records its askCallback
              expect(hasSandboxStartedOnce()).toBe(true)
              expect(getLastSandboxAskCallbackForTests()).toBe(askB)

              // Fix 2: Host B adds b.com -> synced BaseSandboxManager config MUST retain BOTH a.com and b.com!
              addSessionAllowedHost('b.com')
              const lastCfg = updatedConfigs[updatedConfigs.length - 1]
              expect(lastCfg?.network?.allowedDomains).toContain('a.com')
              expect(lastCfg?.network?.allowedDomains).toContain('b.com')

              // Fix 3: wrappedCallback routes per-host in ALS and denies when a host has no registered callback
              expect(capturedWrappedAsk).toBeDefined()
              const resA = await runWithSession(sessionA, () =>
                capturedWrappedAsk!({ host: 'from-a.example', port: 443 }),
              )
              expect(resA).toBe(true)
              expect(askACalls).toEqual(['from-a.example'])

              const resB = await capturedWrappedAsk!({
                host: 'from-b.example',
                port: 443,
              })
              expect(resB).toBe(false)
              expect(askBCalls).toEqual(['from-b.example'])

              const resC = await runWithNewHostSession(
                { id: 'sess-sbx-life-c', cwd: wsC, originalCwd: wsC },
                () =>
                  capturedWrappedAsk!({ host: 'from-c.example', port: 443 }),
              )
              expect(resC).toBe(false)
              // Neither askA nor askB was leaked to Host C
              expect(askACalls).toEqual(['from-a.example'])
              expect(askBCalls).toEqual(['from-b.example'])

              // Fix 5: settingsChangeDetector hot-reload refreshes live started hosts via runWithSession
              const countBeforeNotify = updatedConfigs.length
              settingsChangeDetector.notifyChange('userSettings')
              expect(updatedConfigs.length).toBeGreaterThanOrEqual(
                countBeforeNotify + 2,
              )
              const afterReload = updatedConfigs[updatedConfigs.length - 1]
              expect(afterReload?.network?.allowedDomains).toContain('a.com')
              expect(afterReload?.network?.allowedDomains).toContain('b.com')

              // Fix 4: Host A resets inside ALS while Host B is still started -> singleton MUST NOT reset!
              await runWithSession(sessionA, async () => {
                await SandboxManager.reset()
                expect(hasSandboxStartedOnce()).toBe(false)
                expect(getLastSandboxAskCallbackForTests()).toBeUndefined()
              })
              expect(resetCalls).toBe(0)
              // Host B remains started and singleton config keeps b.com while dropping Host A's cleared a.com
              expect(hasSandboxStartedOnce()).toBe(true)
              const afterHostAReset = updatedConfigs[updatedConfigs.length - 1]
              expect(afterHostAReset?.network?.allowedDomains).toContain(
                'b.com',
              )
              expect(afterHostAReset?.network?.allowedDomains).not.toContain(
                'a.com',
              )

              // Now Host B also resets -> no other live started hosts remain -> singleton BaseSandboxManager.reset() runs!
              expect(sessionB.root).toBe(sessionB)
              await SandboxManager.reset()
              expect(hasSandboxStartedOnce()).toBe(false)
              expect(resetCalls).toBe(1)
            },
          )
        },
      )
    } finally {
      BaseSandboxManager.initialize = origInitialize
      BaseSandboxManager.updateConfig = origUpdateConfig
      BaseSandboxManager.reset = origReset
      BaseSandboxManager.checkDependencies = origCheckDeps
      await SandboxManager.reset().catch(() => {})
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
      resetSettingsCache()
    }
  })

  test('bashPermissions speculativeChecks keyed by (cwd, command): worktree runWithCwd never overwrites or deletes parent speculative check', async () => {
    const parentResult: ClassifierResult = {
      matches: true,
      matchedDescription: 'parent allow',
      confidence: 'high',
      reason: 'approved for parent cwd',
    }
    const worktreeResult: ClassifierResult = {
      matches: true,
      matchedDescription: 'worktree allow',
      confidence: 'high',
      reason: 'approved for worktree cwd',
    }

    await runWithNewHostSession(
      {
        id: 'sess-bash-wt',
        cwd: '/repo-parent',
        originalCwd: '/repo-parent',
      },
      async () => {
        expect(getCwd()).toBe('/repo-parent')
        _setSpeculativeClassifierCheckForTesting(
          'npm test',
          Promise.resolve(parentResult),
        )

        // Worktree subagent runs the exact same command under runWithCwd
        await runWithCwd('/repo-parent/.claude/worktrees/wt-1', async () => {
          expect(getCwd()).toBe('/repo-parent/.claude/worktrees/wt-1')
          // Must neither see nor delete the parent session's pending check
          expect(peekSpeculativeClassifierCheck('npm test')).toBeUndefined()
          expect(consumeSpeculativeClassifierCheck('npm test')).toBeUndefined()

          // Seeding and consuming in the worktree must not clobber parent's entry
          _setSpeculativeClassifierCheckForTesting(
            'npm test',
            Promise.resolve(worktreeResult),
          )
          const wtConsumed = await consumeSpeculativeClassifierCheck('npm test')
          expect(wtConsumed).toEqual(worktreeResult)
        })

        // Back in parent CWD: parent's speculative check is still intact and consumable!
        expect(peekSpeculativeClassifierCheck('npm test')).toBeDefined()
        const parentConsumed =
          await consumeSpeculativeClassifierCheck('npm test')
        expect(parentConsumed).toEqual(parentResult)
      },
    )
  })
})
