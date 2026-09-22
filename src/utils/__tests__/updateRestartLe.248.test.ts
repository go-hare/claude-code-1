/**
 * densable 2.1.248 /update|/restart (Mhr) + gateway le — GC(#w) refuse arms.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  isSessionPersistenceDisabled,
  setSessionPersistenceDisabled,
} from '../../bootstrap/state.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import {
  getForkRestrictedLaunchConfig,
  resetForkReplayLaunchConfig,
  setForkRestrictedLaunchConfig,
} from '../forkReplayLaunchConfig.js'
import {
  capturePolicySnapshot,
  formatGatewayRestartFailedMessage,
  formatGatewayRestartingMessage,
  hasPolicyDiverged,
  relaunchAfterGatewayLogin,
  resetPolicySnapshotForTests,
  shouldRelaunchAfterGatewayManagedSettings,
} from '../gatewayLoginRelaunch.js'
import {
  formatUpdateUncarriableRefuseMessage,
  getSessionRelaunchUncarriableReasons,
} from '../sessionRelaunchUncarriable.js'
import {
  formatUpdateActiveTaskRefuseMessage,
  formatUpdateBgSessionRefuseMessage,
  formatUpdateTranscriptDriftRefuseMessage,
} from '../../commands/update/update.js'
import {
  getBootstrapSessionHost,
  resetSessionHostForTests,
} from '../sessionHost.js'

function src(rel: string): string {
  return readFileSync(join(import.meta.dir, rel), 'utf8')
}

const savedPersist = isSessionPersistenceDisabled()
const savedGc = getForkRestrictedLaunchConfig()

beforeEach(() => {
  resetSessionHostForTests()
  resetForkReplayLaunchConfig()
  resetPolicySnapshotForTests()
  setSessionPersistenceDisabled(false)
  setForkRestrictedLaunchConfig(false)
})

afterEach(() => {
  resetForkReplayLaunchConfig()
  resetSessionHostForTests()
  resetPolicySnapshotForTests()
  setSessionPersistenceDisabled(savedPersist)
  setForkRestrictedLaunchConfig(savedGc)
})

describe('densable 2.1.248 /update Mhr + gateway le (GC #w)', () => {
  test('slash /update tip SEA: body present, gate closed', () => {
    const index = src('../../commands/update/index.ts')
    expect(index).toContain("name: 'update'")
    expect(index).toContain("aliases: ['restart']")
    expect(index).toContain('isEnabled: () => false')
    expect(index).toContain('isHidden: true')
    expect(index).toContain('Switch to the latest version')
    expect(index).toContain('fleetHostCall')
    expect(index).toContain('relaunch')

    const body = src('../../commands/update/update.ts')
    expect(body).toContain('getSessionRelaunchUncarriableReasons')
    expect(body).toContain('formatUpdateUncarriableRefuseMessage')
    expect(body).toContain('tengu_update_refused')
    expect(body).toContain('formatUpdateBgSessionRefuseMessage')
    expect(body).toContain('formatUpdateTranscriptDriftRefuseMessage')
    expect(body).toContain('formatUpdateActiveTaskRefuseMessage')
    expect(body).toContain('isDaemonBgBackend')
    expect(body).toContain('replBridgeSkipNextArchive')
    expect(body).toContain('tengu_update_bg_respawn')
    expect(body).toContain('autoRepliesCarried')
    expect(body).toContain('flushSessionStorage')
    expect(body).toContain('[...o5(w,wle(t)),...i5(w,AL())]')
    expect(body).toContain('injectTuiSwitch: false')
    expect(body).toContain('to latest')
    expect(body).toContain('conversation will continue')
    expect(body).toContain('CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME')
    expect(body).toContain('buildBridgeReattachEnv')
    expect(body).toContain('resolveBridgeReattachOwnerMeta')
    expect(body).toContain('getPersistedBridgeSession')
    expect(body).toContain('withRelaunchKet')
    expect(body).toContain('preSpawn:')
    expect(body).toContain('g(!0)')
    expect(body).toContain('await lUe()')
    expect(body).toContain('zL(t.messages,"relaunch"')
    expect(body).toContain('createRelaunchSdkAssistantMessage')
    expect(body).toContain('isAssistantTeamEnvSkipped')
    expect(body).toContain('getProactivityLevel')
    expect(body).toContain('proactivity:')
    expect(body).not.toContain('isRestrictedSession')
    expect(body).not.toContain('Yk()')

    const commands = src('../../commands.ts')
    expect(commands).toContain("from './commands/update/index.js'")
    expect(commands).toContain('updateCommand')
  })

  test('Mhr bg / drift / hoe copy matches official', () => {
    expect(formatUpdateBgSessionRefuseMessage('abcd1234', false)).toContain(
      'claude respawn abcd1234',
    )
    expect(formatUpdateBgSessionRefuseMessage(undefined, true)).toContain(
      'agents view',
    )
    expect(formatUpdateTranscriptDriftRefuseMessage(true)).toContain(
      'resumed from a different project directory',
    )
    expect(formatUpdateTranscriptDriftRefuseMessage(true)).toContain(
      'auto-replies to artifact comments',
    )
    expect(
      formatUpdateActiveTaskRefuseMessage({
        kind: 'comment_monitor',
        activeTasks: false,
      }),
    ).toContain("Can't restart while auto-replying")
    expect(
      formatUpdateActiveTaskRefuseMessage({
        kind: 'tasks',
        activeTasks: true,
      }),
    ).toContain("Can't restart while work is running")
  })

  test('fleetHostCall on exit/login/update + AgentView Lc wire', () => {
    const exit = src('../../commands/exit/index.ts')
    expect(exit).toContain('fleetHostCall')
    expect(exit).toContain('hostExit')

    const login = src('../../commands/login/index.ts')
    expect(login).toContain('fleetHostCall')
    expect(login).toContain('hostLogin')

    const types = src('../../types/command.ts')
    expect(types).toContain('fleetHostCall?:')
    expect(types).toContain('FleetHostCallContext')

    const agentView = src('../../screens/AgentView.tsx')
    expect(agentView).toContain('fleetHostCall')
    expect(agentView).toContain('isCommandEnabled(cmd)')
  })

  test('wU(...,GC()) refuse uses #w not Yk', () => {
    const ctx = getEmptyToolPermissionContext()
    setForkRestrictedLaunchConfig(false)
    expect(getSessionRelaunchUncarriableReasons(ctx)).toEqual([])
    setForkRestrictedLaunchConfig(true)
    expect(getSessionRelaunchUncarriableReasons(ctx)).toEqual([
      expect.stringContaining('launch flags:'),
    ])
    expect(
      getBootstrapSessionHost().launchOptions.forkRestrictedLaunchConfig(),
    ).toBe(true)
    expect(getBootstrapSessionHost().launchOptions.restrictedSession()).toBe(
      false,
    )
  })

  test('update uncarriable copy matches official Mhr g()', () => {
    const msg = formatUpdateUncarriableRefuseMessage(['launch flags: x'], {
      sessionPersistenceDisabled: false,
    })
    expect(msg).toContain(
      "Can't switch to the new version from inside this session",
    )
    expect(msg).toContain("restrictions a restart can't carry over")
    expect(msg).toContain('--continue')
  })

  test('gateway le refuse uses official copy + GC', async () => {
    setForkRestrictedLaunchConfig(true)
    const result = await relaunchAfterGatewayLogin({
      hostname: 'gw.example',
      accountSwitched: true,
      spawn: false,
    })
    expect(result.kind).toBe('ended')
    if (result.kind === 'ended') {
      expect(result.message).toContain(
        "restrictions a restart can't carry over",
      )
      expect(result.message).toContain('launch flags:')
      expect(result.message).toContain('Signed in to Cloud gateway gw.example')
      expect(result.message).toContain('this session is ending instead')
    }
  })

  test('inr / snr copy', () => {
    expect(
      formatGatewayRestartingMessage('gw.example', undefined, true, true),
    ).toContain('Restarting Claude Code to apply')
    expect(
      formatGatewayRestartFailedMessage(
        'gw.example',
        { errorKind: 'timeout' },
        'a background session cannot restart itself',
        false,
        true,
      ),
    ).toContain('has to restart to retry')
  })

  test('LNe / hasPolicyDiverged: undefined snapshot ⇒ true', () => {
    resetPolicySnapshotForTests()
    expect(hasPolicyDiverged()).toBe(true)
    capturePolicySnapshot()
    expect(typeof hasPolicyDiverged()).toBe('boolean')
  })

  test('shouldRelaunch on failed / stale_cache', () => {
    expect(shouldRelaunchAfterGatewayManagedSettings({ state: 'failed' })).toBe(
      true,
    )
    expect(
      shouldRelaunchAfterGatewayManagedSettings({ state: 'stale_cache' }),
    ).toBe(true)
  })

  test('login wires capturePolicySnapshot + le', () => {
    const login = src('../../commands/login/login.tsx')
    expect(login).toContain('capturePolicySnapshot()')
    expect(login).toContain('relaunchAfterGatewayLogin')
    expect(login).toContain('shouldRelaunchAfterGatewayManagedSettings')
    expect(login).not.toContain('isRestrictedSession()')
  })

  test('gatewayLoginRelaunch cites GC not Yk', () => {
    const gate = src('../gatewayLoginRelaunch.ts')
    expect(gate).toContain('wU(c,GC())')
    expect(gate).toContain('getSessionRelaunchUncarriableReasons')
    expect(gate).not.toContain('isRestrictedSession')
    expect(gate).toContain('hasPolicyDiverged')
    expect(gate).toContain('isBgSession()')
    expect(gate).toContain('flushSessionStorage')
    expect(gate).toContain('[...o5(c,wle(o)),...i5(c,AL())]')
    expect(gate).toContain('injectTuiSwitch: false')
    expect(gate).toContain('env $B()')
  })

  test('leftover _G/Ket (injectTuiSwitch:false) still applies Yet after extraInjectEnv', () => {
    const relaunch = src('../cliRelaunch.ts')
    const plan = relaunch.slice(
      relaunch.indexOf('export function buildTuiRelaunchPlan'),
      relaunch.indexOf('export type RelaunchSpawnResult'),
    )
    const extraIdx = plan.indexOf(
      'Object.assign(injectEnv, input.extraInjectEnv)',
    )
    const yetIdx = plan.indexOf('buildRelaunchTerminalSizeEnv')
    expect(extraIdx).toBeGreaterThan(-1)
    expect(yetIdx).toBeGreaterThan(extraIdx)
    // Official `_G` Yet is always-on after extra — not gated on TUI switch.
    expect(plan).not.toMatch(
      /if \(input\.injectTuiSwitch !== false\) \{[\s\S]*buildRelaunchTerminalSizeEnv/,
    )
    expect(plan).toContain(
      'Object.assign(injectEnv, buildRelaunchTerminalSizeEnv(input.terminalSize))',
    )
  })

  test('leftover _G body has official flush/cleanup/signal/exit hosts', () => {
    const relaunch = src('../cliRelaunch.ts')
    expect(relaunch).toContain('claimShutdown')
    expect(relaunch).toContain('cleanupTerminalModes')
    expect(relaunch).toContain('emitScrollTelemetrySummary')
    expect(relaunch).toContain('flush timeout (relaunch)')
    expect(relaunch).toContain('cleanup timeout')
    expect(relaunch).toContain('analytics flush timeout')
    expect(relaunch).toContain('debug flush timeout (relaunch)')
    expect(relaunch).toContain('diag flush timeout (relaunch)')
    expect(relaunch).toContain('pre-exit flush timeout (relaunch)')
    expect(relaunch).toContain('write queue drain timeout (relaunch)')
    expect(relaunch).toContain('flushDiagLogs')
    expect(relaunch).toContain('runPreExitFlush')
    expect(relaunch).toContain('resolveRelaunchCwd')
    expect(relaunch).toContain('SIGINT')
    expect(relaunch).toContain('relaunch_spawn_error')
    expect(relaunch).toContain('CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE')
    // Leftover: spawn fail returns to UI callers (no exit-on-spawn-error).
    // Teardown/commit + process.exit only after spawn.ok.
    expect(relaunch).toContain('runOfficialRelaunchGPrep')
    expect(relaunch).toContain('runOfficialRelaunchGCommit')
    const accept = relaunch.slice(
      relaunch.indexOf('export async function acceptTuiRelaunch'),
    )
    expect(accept).toMatch(
      /if\s*\(\s*!spawn\.ok\s*\)[\s\S]*?return\s*\{\s*mode:\s*'spawned'/,
    )
    expect(accept).toContain('runOfficialRelaunchGCommit()')
    expect(accept.indexOf('runOfficialRelaunchGCommit()')).toBeLessThan(
      accept.indexOf('await spawn.exited'),
    )
    expect(accept).toContain('process.exit(exited.status')
    expect(accept).toContain('beginCliRelaunch({')
  })

  test('leftover E/C: isAbsolute + Xet + no windowsHide on spawnSync', () => {
    const relaunch = src('../cliRelaunch.ts')
    // official E: B()==="windows"||!A(e) early return
    expect(relaunch).toContain("process.platform === 'win32'")
    expect(relaunch).toContain('isAbsolute(launch.execPath)')
    // official Xet for execve env
    expect(relaunch).toContain('sanitizeEnvForExecve')
    expect(relaunch).toContain("key === '__proto__'")
    expect(relaunch).toContain('Object.defineProperty(out, key')
    expect(relaunch).toContain('sanitizeEnvForExecve(launch.env)')
    // official E argv shape [cmd,...prefix,...cli]
    expect(relaunch).toContain('[launch.execPath, ...launch.args]')
    expect(relaunch).toContain('falling back to spawn')
    expect(relaunch).toContain('execReplaceProcess:')
    // official C = raw spawnSync — no windowsHide on this call
    const spawnFn = relaunch.slice(
      relaunch.indexOf('export function spawnCliRelaunch'),
      relaunch.indexOf('export function relaunchIntoTui'),
    )
    expect(spawnFn).toContain("stdio: 'inherit'")
    expect(spawnFn).toContain('cwd: input.cwd ?? process.cwd()')
    expect(spawnFn).not.toContain('windowsHide')
    // official _G removes beforeExit/exit then status/signal exit
    expect(relaunch).toContain("process.removeAllListeners('beforeExit')")
    expect(relaunch).toContain("process.removeAllListeners('exit')")
    expect(relaunch).toContain(
      'process.exit(exited.status ?? (exited.signal ? 1 : 0))',
    )
  })

  test('leftover gKt = sessionFile dirname vs getProjectDir(originalCwd) else projectRoot', () => {
    const relaunch = src('../cliRelaunch.ts')
    const gkt = relaunch.slice(
      relaunch.indexOf('export function resolveRelaunchCwd'),
      relaunch.indexOf('async function runRelaunchGFlush'),
    )
    expect(gkt).toContain('getProject().sessionFile')
    expect(gkt).toContain('getOriginalCwd()')
    expect(gkt).toContain('getProjectDir(originalCwd)')
    expect(gkt).toContain('dirname(sessionFile)')
    expect(gkt).toContain('getProjectRoot()')
    expect(relaunch).toContain('input.cwd ?? resolveRelaunchCwd()')
  })

  test('leftover Qbt/svt bags are host WeakOwnerCache drains', () => {
    const diag = src('../diagLogs.ts')
    expect(diag).toContain('export function flushDiagLogs')
    expect(diag).toContain('registerCleanup(() => this.flush())')
    expect(diag).toContain('getBootstrapSessionHost()')
    const cleanup = src('../cleanupRegistry.ts')
    expect(cleanup).toContain('preExitFlush')
    expect(cleanup).toContain('export async function runPreExitFlush')
    expect(cleanup).toContain('export function registerPreExitFlush')
    expect(cleanup).toContain('getBootstrapSessionHost()')
  })

  test('AgentView setInfo is not setError', () => {
    const agentView = src('../../screens/AgentView.tsx')
    expect(agentView).toContain('setInfo(msg)')
    expect(agentView).not.toContain('setInfo: msg => setError(msg)')
  })
})
