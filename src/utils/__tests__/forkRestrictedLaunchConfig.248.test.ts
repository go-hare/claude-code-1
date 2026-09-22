/**
 * densable 2.1.248 leftover Cwn / GC — host.launchOptions.#w.
 * NOT #1 Yk / STATE.restrictedSession.
 *
 * Gold (SEA official-248/package/claude.exe, 226708128):
 * - Ie.#w methods @178537404
 * - GC @178553257 sha=c75e51a6d6ddf107
 * - Cwn @178553330 sha=c836daccafc6bb62
 * - Cwn as setForkRestrictedLaunchConfig @192785069
 * - GC as getForkRestrictedLaunchConfig @192776753
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  getRestrictedSession,
  setRestrictedSession,
} from '../../bootstrap/state.js'
import {
  getForkRestrictedLaunchConfig,
  isForkRestrictedLaunchOptions,
  resetForkReplayLaunchConfig,
  setForkRestrictedLaunchConfig,
} from '../forkReplayLaunchConfig.js'
import { FORK_RESTRICTED_LAUNCH_FLAGS_DESCRIPTION } from '../tuiRelaunchCarry.js'
import {
  getBootstrapSessionHost,
  resetSessionHostForTests,
} from '../sessionHost.js'
import {
  FORK_NOTHING_YET_ERROR,
  FORK_PERSISTENCE_OFF_ERROR,
  FORK_RESTRICTED_LAUNCH_ERROR,
  isForkRestrictedLaunch,
} from '../spawnBackgroundSessionFork.js'

const savedYk = getRestrictedSession()

function src(rel: string): string {
  return readFileSync(join(import.meta.dir, rel), 'utf8')
}

beforeEach(() => {
  resetSessionHostForTests()
  resetForkReplayLaunchConfig()
  setRestrictedSession(savedYk)
})

afterEach(() => {
  resetForkReplayLaunchConfig()
  resetSessionHostForTests()
  setRestrictedSession(savedYk)
})

describe('densable 2.1.248 leftover Cwn / GC (not #1 Yk)', () => {
  test('official wrappers go through n().host.launchOptions', () => {
    const wrappers = src('../forkReplayLaunchConfig.ts')
    expect(wrappers).toContain('Cwn')
    expect(wrappers).toContain('GC')
    expect(wrappers).toContain('replaceForkRestrictedLaunchConfig')
    expect(wrappers).toContain('n().host.launchOptions')
    expect(wrappers).toContain(
      'function Cwn(e){n().host.launchOptions.replaceForkRestrictedLaunchConfig(e)}',
    )
    expect(wrappers).toContain(
      'function GC(){return n().host.launchOptions.forkRestrictedLaunchConfig()}',
    )
    expect(wrappers).toContain('@178553330')
    expect(wrappers).toContain('c836daccafc6bb62')
    expect(wrappers).toContain('@178553257')
    expect(wrappers).toContain('c75e51a6d6ddf107')
    expect(wrappers).toContain('Cwn as setForkRestrictedLaunchConfig')
    expect(wrappers).toContain('GC as getForkRestrictedLaunchConfig')
  })

  test('leftover host is official Ie slots, not class Yt', () => {
    const host = src('../sessionHost.ts')
    expect(host).toContain('replaceForkRestrictedLaunchConfig')
    expect(host).toContain('forkRestrictedLaunchConfig()')
    expect(host).toContain('launchOptions: new LaunchOptions()')
    expect(host).toContain('#w = false')
    expect(host).toContain('restrictedSession()')
    expect(host).toContain('todoToolsOptIn()')
    expect(host).toContain('forkReplayLaunchConfig()')
    expect(host).not.toContain('class Yt')
    expect(host).not.toContain('class Ie')
  })

  test('Cwn / GC read and write host.launchOptions.#w', () => {
    expect(getForkRestrictedLaunchConfig()).toBe(false)
    expect(
      getBootstrapSessionHost().launchOptions.forkRestrictedLaunchConfig(),
    ).toBe(false)

    setForkRestrictedLaunchConfig(true)
    expect(getForkRestrictedLaunchConfig()).toBe(true)
    expect(
      getBootstrapSessionHost().launchOptions.forkRestrictedLaunchConfig(),
    ).toBe(true)

    getBootstrapSessionHost().launchOptions.replaceForkRestrictedLaunchConfig(
      false,
    )
    expect(getForkRestrictedLaunchConfig()).toBe(false)
  })

  test('reminting Xi() host resets leftover #w', () => {
    setForkRestrictedLaunchConfig(true)
    resetSessionHostForTests()
    expect(getForkRestrictedLaunchConfig()).toBe(false)
    expect(
      getBootstrapSessionHost().launchOptions.forkRestrictedLaunchConfig(),
    ).toBe(false)
  })

  test('Cwn does not write Yk / STATE.restrictedSession', () => {
    setRestrictedSession(false)
    setForkRestrictedLaunchConfig(true)
    expect(getRestrictedSession()).toBe(false)
    expect(getForkRestrictedLaunchConfig()).toBe(true)

    setRestrictedSession(true)
    setForkRestrictedLaunchConfig(false)
    expect(getRestrictedSession()).toBe(true)
    expect(getForkRestrictedLaunchConfig()).toBe(false)
  })

  test('Cwn(Win) write and Hei/GC read still use leftover export names', () => {
    const main = src('../../main.tsx')
    expect(main).toContain('setForkRestrictedLaunchConfig(')
    expect(main).toContain('isForkRestrictedLaunchOptions({')
    expect(main).toContain('Cwn(Win(C))')
    expect(main).not.toContain('setRestrictedSession(isForkRestricted')

    const hei = src('../spawnBackgroundSessionFork.ts')
    expect(hei).toContain('getForkRestrictedLaunchConfig()')

    expect(isForkRestrictedLaunchOptions({ systemPrompt: 'x' })).toBe(true)
    setForkRestrictedLaunchConfig(isForkRestrictedLaunchOptions({}))
    expect(getForkRestrictedLaunchConfig()).toBe(false)
    setForkRestrictedLaunchConfig(
      isForkRestrictedLaunchOptions({ tools: ['Bash'] }),
    )
    expect(isForkRestrictedLaunch(['node', 'cli'])).toBe(true)
  })

  test('official tae gates fullscreen upsell on GC() (#w), not Yk', () => {
    const gate = src('../fullscreenUpsellGate.ts')
    expect(gate).toContain('getForkRestrictedLaunchConfig()')
    expect(gate).toContain('if(GC())return!1')
    expect(gate).toContain('Not Yk / restrictedSession')
    expect(gate).toContain('isBgSession()')
    expect(gate).toContain('getIsRemoteMode')
    expect(gate).toContain('getBgJobTakeover')
    expect(gate).toContain('isFullscreenUpsellAutoOffReason')
    expect(gate).toContain('isFullscreenStickyAutoDisabled')
    expect(gate).not.toContain('isRestrictedSession()')
    expect(gate).not.toContain('getRestrictedSession()')

    const { shouldShowFullscreenUpsell } =
      require('../fullscreenUpsellGate.js') as typeof import('../fullscreenUpsellGate.js')

    // Pin tae arms so tip default-on GHe/ant_default does not swallow GC cases.
    const base = {
      isNonInteractiveOrDemo: false,
      isBgSession: false,
      isRemoteWorkspace: false,
      hasBgTakeover: false,
      isFullscreenAlready: false,
      isHardDisabled: false,
      hasExplicitTuiSetting: false,
      isLatchedFullscreen: false,
      isAutoOffGateReason: false,
      isGrowthBookFallback: false,
      isStickyAutoDisabled: false,
      seenCount: 0,
    } as const

    setRestrictedSession(true)
    setForkRestrictedLaunchConfig(false)
    expect(shouldShowFullscreenUpsell({ ...base })).toBe(true)

    setForkRestrictedLaunchConfig(true)
    expect(shouldShowFullscreenUpsell({ ...base })).toBe(false)
  })

  test('nZ_ #w refuse is official wr||No||GC copy, not Yk', () => {
    expect(FORK_RESTRICTED_LAUNCH_ERROR).toBe(
      `Can't fork: this session was started with launch flags (safe or bare mode, ${FORK_RESTRICTED_LAUNCH_FLAGS_DESCRIPTION}) that the copy wouldn't inherit, so it would run with fewer restrictions than this session. Run the task here, or start a session without those flags and fork from there.`,
    )
    expect(FORK_PERSISTENCE_OFF_ERROR).toBe(
      "Can't fork: session persistence is off, so the new session would have nothing to start from. Run the task here, or fork from a session that saves its transcript.",
    )
    expect(FORK_NOTHING_YET_ERROR).toBe(
      'Nothing to fork yet. Send a message first.',
    )

    const hei = src('../spawnBackgroundSessionFork.ts')
    expect(hei).toContain('wr()||No()||GC()')
    expect(hei).toContain('@209796532')

    setForkRestrictedLaunchConfig(false)
    const beforeYk = isForkRestrictedLaunch(['node', 'cli'])
    setRestrictedSession(true)
    expect(isForkRestrictedLaunch(['node', 'cli'])).toBe(beforeYk)
  })
})
