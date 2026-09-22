/**
 * densable 2.1.248 leftover official `class Ie` on `LaunchOptions`.
 * Not `class Yt`. Wrappers Yk/c7e / KEn/YEn / AL/Rwn / GC/Cwn go through host.
 *
 * Gold (SEA official-248/package/claude.exe, 226708128):
 * - class Ie @178534988
 * - Yk @178565128 sha=004e8eb906e6711a
 * - c7e @178565192 sha=97529dc3fc652d06
 * - KEn / YEn @178566074
 * - AL / Rwn @178553301
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  getClientType,
  getInitJsonSchema,
  getIsInteractive,
  getIsNonInteractiveSession,
  getQuestionPreviewFormat,
  getRestrictedSession,
  getScheduledTasksEnabled,
  getSdkAgentProgressSummariesEnabled,
  getSessionBypassPermissionsMode,
  getStrictToolResultPairing,
  getTodoToolsOptIn,
  getUserMsgOptIn,
  isSessionPersistenceDisabled,
  preferThirdPartyAuthentication,
  resetSdkInitState,
  setClientType,
  setInitJsonSchema,
  setIsInteractive,
  setQuestionPreviewFormat,
  setRestrictedSession,
  setScheduledTasksEnabled,
  setSdkAgentProgressSummariesEnabled,
  setSessionBypassPermissionsMode,
  setSessionPersistenceDisabled,
  setStrictToolResultPairing,
  setTodoToolsOptIn,
  setUserMsgOptIn,
} from '../../bootstrap/state.js'
import {
  getForkReplayLaunchConfig,
  getForkRestrictedLaunchConfig,
  getReplConfigArgv,
  resetForkReplayLaunchConfig,
  setForkReplayLaunchConfig,
  setForkRestrictedLaunchConfig,
  setReplConfigArgv,
} from '../forkReplayLaunchConfig.js'
import {
  getBootstrapSessionHost,
  resetSessionHostForTests,
} from '../sessionHost.js'

function src(rel: string): string {
  return readFileSync(join(import.meta.dir, rel), 'utf8')
}

beforeEach(() => {
  resetSessionHostForTests()
  resetForkReplayLaunchConfig()
  setRestrictedSession(false)
  setTodoToolsOptIn(false)
})

afterEach(() => {
  resetForkReplayLaunchConfig()
  resetSessionHostForTests()
})

describe('densable 2.1.248 leftover LaunchOptions is official Ie', () => {
  test('class body has official Ie slots and reset, not Yt', () => {
    const host = src('../sessionHost.ts')
    expect(host).toContain('Official Ie @178534988')
    expect(host).toContain('restrictedSession()')
    expect(host).toContain('replaceRestrictedSession')
    expect(host).toContain('todoToolsOptIn()')
    expect(host).toContain('replaceTodoToolsOptIn')
    expect(host).toContain('forkReplayLaunchConfig()')
    expect(host).toContain('replaceForkReplayLaunchConfig')
    expect(host).toContain('replConfigArgv()')
    expect(host).toContain('replaceReplConfigArgv')
    expect(host).toContain('reset()')
    expect(host).toContain("#c = 'cli'")
    expect(host).toContain("#p = 'fresh'")
    expect(host).toContain('#x = true')
    expect(host).not.toContain('class Yt')
    expect(host).not.toContain('class Ie')
  })

  test('Yk / c7e go through n().host.launchOptions.restrictedSession', () => {
    const state = src('../../bootstrap/state.ts')
    expect(state).toContain(
      'function Yk(){return n().host.launchOptions.restrictedSession()}',
    )
    expect(state).toContain(
      'function c7e(e){n().host.launchOptions.replaceRestrictedSession(e)}',
    )
    expect(getRestrictedSession()).toBe(false)
    setRestrictedSession(true)
    expect(getRestrictedSession()).toBe(true)
    expect(getBootstrapSessionHost().launchOptions.restrictedSession()).toBe(
      true,
    )
    expect(getForkRestrictedLaunchConfig()).toBe(false)
  })

  test('KEn / YEn go through host.todoToolsOptIn', () => {
    const state = src('../../bootstrap/state.ts')
    expect(state).toContain(
      'function KEn(){return n().host.launchOptions.todoToolsOptIn()}',
    )
    expect(state).toContain(
      'function YEn(e){n().host.launchOptions.replaceTodoToolsOptIn(e)}',
    )
    expect(getTodoToolsOptIn()).toBe(false)
    setTodoToolsOptIn(true)
    expect(getTodoToolsOptIn()).toBe(true)
    expect(getBootstrapSessionHost().launchOptions.todoToolsOptIn()).toBe(true)
  })

  test('AL / Rwn / rti go through host #L / #g', () => {
    const wrappers = src('../forkReplayLaunchConfig.ts')
    expect(wrappers).toContain(
      'function AL(){return n().host.launchOptions.forkReplayLaunchConfig()}',
    )
    expect(wrappers).toContain(
      'function Rwn(e){n().host.launchOptions.replaceForkReplayLaunchConfig(e)}',
    )
    setForkReplayLaunchConfig({ agent: 'explorer' })
    expect(getForkReplayLaunchConfig()).toEqual({ agent: 'explorer' })
    expect(
      getBootstrapSessionHost().launchOptions.forkReplayLaunchConfig(),
    ).toEqual({ agent: 'explorer' })
    setReplConfigArgv(['--settings', 'x.json'])
    expect(getReplConfigArgv()).toEqual(['--settings', 'x.json'])
    expect(getBootstrapSessionHost().launchOptions.replConfigArgv()).toEqual([
      '--settings',
      'x.json',
    ])
  })

  test('Cwn #w stays a different bit from Yk #l', () => {
    setRestrictedSession(true)
    setForkRestrictedLaunchConfig(false)
    expect(getRestrictedSession()).toBe(true)
    expect(getForkRestrictedLaunchConfig()).toBe(false)
    setForkRestrictedLaunchConfig(true)
    setRestrictedSession(false)
    expect(getRestrictedSession()).toBe(false)
    expect(getForkRestrictedLaunchConfig()).toBe(true)
  })

  test('Ie.reset restores official defaults', () => {
    const opts = getBootstrapSessionHost().launchOptions
    opts.replaceRestrictedSession(true)
    opts.replaceTodoToolsOptIn(true)
    opts.replaceForkRestrictedLaunchConfig(true)
    opts.replaceForkReplayLaunchConfig({ agent: 'x' })
    opts.replaceReplConfigArgv(['--add-dir', '/tmp'])
    opts.replaceClientType('sdk')
    opts.reset()
    expect(opts.restrictedSession()).toBe(false)
    expect(opts.todoToolsOptIn()).toBe(false)
    expect(opts.forkRestrictedLaunchConfig()).toBe(false)
    expect(opts.forkReplayLaunchConfig()).toEqual({})
    expect(opts.replConfigArgv()).toEqual([])
    expect(opts.clientType()).toBe('cli')
    expect(opts.sessionStartType()).toBe('fresh')
    expect(opts.mayForwardHomeSettings()).toBe(true)
  })

  test('leftover STATE wrappers go through host.launchOptions', () => {
    const state = src('../../bootstrap/state.ts')
    expect(state).toContain(
      'function De(){return!n().host.launchOptions.isInteractive()}',
    )
    expect(state).toContain(
      'function vu(){return n().host.launchOptions.isInteractive()}',
    )
    expect(state).toContain(
      'function AEn(e){n().host.launchOptions.replaceIsInteractive(e)}',
    )
    expect(state).toContain(
      'function a7e(){return n().host.launchOptions.clientType()}',
    )
    expect(state).toContain(
      'function $En(e){n().host.launchOptions.replaceClientType(e)}',
    )
    expect(state).toContain(
      'function _de(){return n().host.launchOptions.sdkAgentProgressSummariesEnabled()}',
    )
    expect(state).toContain(
      'function FEn(e){n().host.launchOptions.replaceSdkAgentProgressSummariesEnabled(e)}',
    )
    expect(state).toContain(
      'function BEn(){return n().host.launchOptions.strictToolResultPairing()}',
    )
    expect(state).toContain(
      'function hEr(e){n().host.launchOptions.replaceStrictToolResultPairing(e)}',
    )
    expect(state).toContain(
      'function _x(){return n().host.launchOptions.userMsgOptIn()}',
    )
    expect(state).toContain(
      'function c7(e){n().host.launchOptions.replaceUserMsgOptIn(e)}',
    )
    expect(state).toContain(
      'function NGt(){return n().host.launchOptions.questionPreviewFormat()}',
    )
    expect(state).toContain(
      'function $Gt(e){n().host.launchOptions.replaceQuestionPreviewFormat(e)}',
    )
    expect(state).toContain(
      'function Tkn(e){n().host.launchOptions.replaceSessionBypassPermissionsMode(e)}',
    )
    expect(state).toContain(
      'function H4(){return n().host.launchOptions.sessionBypassPermissionsMode()}',
    )
    expect(state).toContain(
      'function V$(e){n().host.launchOptions.replaceScheduledTasksEnabled(e)}',
    )
    expect(state).toContain(
      'function b7e(){return n().host.launchOptions.scheduledTasksEnabled()}',
    )
    expect(state).toContain(
      'function Rkn(e){n().host.launchOptions.replaceSessionPersistenceDisabled(e)}',
    )
    expect(state).toContain(
      'function qC(){return n().host.launchOptions.sessionPersistenceDisabled()}',
    )
    expect(state).toContain(
      'function Dkn(e){n().host.launchOptions.replaceInitJsonSchema(e)}',
    )
    expect(state).toContain(
      'function xvt(){return n().host.launchOptions.initJsonSchema()}',
    )
    expect(state).toContain(
      'function f7e(){return De()&&n().host.launchOptions.clientType()!=="claude-vscode"}',
    )
    expect(state).not.toContain('isForceSessionPersistenceEnabled')
    expect(state).not.toContain('export function getSessionStartType')
    expect(state).not.toContain('export function setSessionStartType')

    const opts = getBootstrapSessionHost().launchOptions
    expect(getIsInteractive()).toBe(false)
    expect(getIsNonInteractiveSession()).toBe(true)
    setIsInteractive(true)
    expect(getIsInteractive()).toBe(true)
    expect(getIsNonInteractiveSession()).toBe(false)
    expect(opts.isInteractive()).toBe(true)

    expect(getClientType()).toBe('cli')
    setClientType('sdk')
    expect(getClientType()).toBe('sdk')
    expect(opts.clientType()).toBe('sdk')

    setSdkAgentProgressSummariesEnabled(true)
    expect(getSdkAgentProgressSummariesEnabled()).toBe(true)
    expect(opts.sdkAgentProgressSummariesEnabled()).toBe(true)

    setStrictToolResultPairing(true)
    expect(getStrictToolResultPairing()).toBe(true)
    expect(opts.strictToolResultPairing()).toBe(true)

    setUserMsgOptIn(true)
    expect(getUserMsgOptIn()).toBe(true)
    expect(opts.userMsgOptIn()).toBe(true)

    setQuestionPreviewFormat('html')
    expect(getQuestionPreviewFormat()).toBe('html')
    expect(opts.questionPreviewFormat()).toBe('html')

    setSessionBypassPermissionsMode(true)
    expect(getSessionBypassPermissionsMode()).toBe(true)
    expect(opts.sessionBypassPermissionsMode()).toBe(true)

    setScheduledTasksEnabled(true)
    expect(getScheduledTasksEnabled()).toBe(true)
    expect(opts.scheduledTasksEnabled()).toBe(true)

    setSessionPersistenceDisabled(true)
    expect(opts.sessionPersistenceDisabled()).toBe(true)
    expect(isSessionPersistenceDisabled()).toBe(true)

    setInitJsonSchema({ type: 'object' })
    expect(getInitJsonSchema()).toEqual({ type: 'object' })
    expect(opts.initJsonSchema()).toEqual({ type: 'object' })
    resetSdkInitState()
    expect(getInitJsonSchema()).toBeNull()
    expect(opts.initJsonSchema()).toBeNull()

    setIsInteractive(false)
    setClientType('cli')
    expect(preferThirdPartyAuthentication()).toBe(true)
    setIsInteractive(true)
    expect(preferThirdPartyAuthentication()).toBe(false)
    setIsInteractive(false)
    setClientType('claude-vscode')
    expect(preferThirdPartyAuthentication()).toBe(false)

    resetSessionHostForTests()
    expect(getIsInteractive()).toBe(false)
    expect(getClientType()).toBe('cli')
    expect(getSdkAgentProgressSummariesEnabled()).toBe(false)
    expect(getStrictToolResultPairing()).toBe(false)
    expect(getUserMsgOptIn()).toBe(false)
    expect(getQuestionPreviewFormat()).toBeUndefined()
    expect(getSessionBypassPermissionsMode()).toBe(false)
    expect(getScheduledTasksEnabled()).toBe(false)
    expect(getInitJsonSchema()).toBeNull()
  })
})
