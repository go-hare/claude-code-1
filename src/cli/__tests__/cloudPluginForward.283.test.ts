import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  PLUGIN_FORWARD_UNDECIDED_COPY,
  cloudPluginAdmissionOff,
  isCloudPluginForwardingOptedOut,
  isDialogSettled,
  mapCloudNoticeLevel,
  pluginDistrustCopy,
  waitCloudPluginConsentPin,
} from '../cloudPluginForward.js'

const src = readFileSync(
  join(import.meta.dir, '../cloudPluginForward.ts'),
  'utf8',
)

const ENV_KEY = 'CLAUDE_CODE_DISABLE_PLUGIN_FORWARDING'
const prevEnv = process.env[ENV_KEY]

afterEach(() => {
  if (prevEnv === undefined) {
    delete process.env[ENV_KEY]
  } else {
    process.env[ENV_KEY] = prevEnv
  }
})

describe('densable 2.1.283 plugin forwarding leftover wrap', () => {
  test('locks gold event name tengu_cloud_plugins_admission', () => {
    expect(src).toContain('tengu_cloud_plugins_admission')
    expect(src).toContain('ccr_cloud_plugins_forward')
    expect(src).toContain('admission:')
    expect(src).toContain('reattach')
    cloudPluginAdmissionOff('no_consent', 'no_consent', 'undecided', false)
  })

  test('isCloudPluginForwardingOptedOut is Boolean(env) (gold ln optedOut)', () => {
    delete process.env[ENV_KEY]
    expect(isCloudPluginForwardingOptedOut()).toBe(false)
    process.env[ENV_KEY] = '1'
    expect(isCloudPluginForwardingOptedOut()).toBe(true)
    process.env[ENV_KEY] = '0'
    expect(isCloudPluginForwardingOptedOut()).toBe(true)
  })

  test('pluginDistrustCopy is gold Po four strings 1:1', () => {
    expect(pluginDistrustCopy('in_launch_dir')).toBe(
      'Your plugins are not used in this cloud session: the folder or repository it runs in holds your Claude settings, where that choice is saved, so it could change it. Start it from a folder outside them.',
    )
    expect(pluginDistrustCopy('in_sync_root')).toBe(
      'Your plugins are not used in this cloud session: the folder it syncs contains your Claude settings, where that choice is saved, so the session could change it. Sync a folder that does not hold them.',
    )
    expect(pluginDistrustCopy('in_other_root')).toBe(
      'Your plugins are not used in this cloud session: a folder it may write on this machine (an added directory or a settings write grant) holds your Claude settings, so it could change that choice.',
    )
    expect(pluginDistrustCopy('unknown')).toBe(
      'Your plugins are not used in this cloud session: this machine could not check whether the session is able to change that saved choice from its folder, so the choice is not relied on here.',
    )
    expect(pluginDistrustCopy('in_launch_dir').length).toBe(200)
  })

  test('PLUGIN_FORWARD_UNDECIDED_COPY is gold Oo', () => {
    expect(PLUGIN_FORWARD_UNDECIDED_COPY).toBe(
      'Your plugins are not used in cloud sessions from this machine yet: run /cloud-plugins in claude on this machine to decide.',
    )
  })

  test('cloudPluginAdmissionOff report matches gold ye', () => {
    const off = cloudPluginAdmissionOff(
      'no_consent',
      'no_consent',
      'untrusted_store',
      true,
      {
        source: 'default',
        message: pluginDistrustCopy('in_launch_dir'),
      },
    )
    expect(off.feature).toBe('plugins')
    expect(off.report()).toEqual({
      state: 'off',
      reason: 'no_consent',
      source: 'default',
      message: pluginDistrustCopy('in_launch_dir'),
    })
    const undecided = cloudPluginAdmissionOff(
      'no_consent',
      'no_consent',
      'undecided',
      false,
      { source: 'default', message: PLUGIN_FORWARD_UNDECIDED_COPY },
    )
    expect(undecided.report()).toEqual({
      state: 'off',
      reason: 'no_consent',
      source: 'default',
      message: PLUGIN_FORWARD_UNDECIDED_COPY,
    })
    const declined = cloudPluginAdmissionOff(
      'declined',
      'opted_out',
      'stored',
      false,
      { source: 'stored' },
    )
    expect(declined.report()).toEqual({
      state: 'off',
      reason: 'declined',
      source: 'stored',
    })
  })

  test('isDialogSettled is gold dn settled && !answerPending', () => {
    expect(isDialogSettled({ settled: true, answerPending: false })).toBe(true)
    expect(isDialogSettled({ settled: true, answerPending: true })).toBe(false)
    expect(isDialogSettled({ settled: false, answerPending: false })).toBe(
      false,
    )
  })

  test('mapCloudNoticeLevel is gold Do', () => {
    expect(mapCloudNoticeLevel('warning')).toBe('warning')
    expect(mapCloudNoticeLevel('notice')).toBe('info')
    expect(mapCloudNoticeLevel('debug')).toBe('debug')
    expect(mapCloudNoticeLevel('info')).toBe('info')
  })

  test('waitCloudPluginConsentPin: no pin host → unreadable; abort; timeout', async () => {
    const aborted = new AbortController()
    aborted.abort()
    expect(await waitCloudPluginConsentPin(undefined, aborted.signal)).toBe(
      'aborted',
    )

    expect(
      await waitCloudPluginConsentPin(null, new AbortController().signal),
    ).toBe('unreadable')

    let timedOut: (() => void) | undefined
    const clock = {
      now: () => 0,
      setTimeout(fn: () => void, ms: number) {
        expect(ms).toBe(5000)
        timedOut = fn
        return () => {
          timedOut = undefined
        }
      },
    }
    const hanging = waitCloudPluginConsentPin(
      { read: () => new Promise(() => {}) },
      new AbortController().signal,
      clock,
    )
    expect(timedOut).toBeTypeOf('function')
    timedOut?.()
    expect(await hanging).toBe('unreadable')

    expect(
      await waitCloudPluginConsentPin(
        { read: async () => 'accepted' },
        new AbortController().signal,
        {
          now: () => 0,
          setTimeout: () => () => {},
        },
      ),
    ).toBe('accepted')
  })

  test('does not invent device-key / settings.set / amati / soundpost', () => {
    expect(src).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(src).not.toContain('settings.set(')
    expect(src).not.toContain('amati')
    expect(src).not.toContain('soundpost')
    expect(src).not.toContain('function WBe')
  })
})
