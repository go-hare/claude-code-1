/**
 * densable 2.1.283 leftover unique wrap — settings-to-cloud pack.
 *
 * Gold SEA `/tmp/official-283/package/claude` — Mo/Se/un/Ao/To.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  createSettingsToCloudPack,
  isSuccessfulSettingsUpload,
  settingsToCloudHomeSeed,
  settingsToCloudOff,
  settingsToCloudReport,
} from '../settingsToCloudPack.js'

const src = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8')

describe('settingsToCloudPack 283 leftover gold un wrap', () => {
  test('source-locks gold Mo/Se/un/Ao/To; no settings.set', () => {
    const body = src('../settingsToCloudPack.ts')
    expect(body).toContain('gold `Mo` @202411165')
    expect(body).toContain('gold `Se` @202411280')
    expect(body).toContain('gold `un` @202411365')
    expect(body).toContain('gold `Ao` @202411620')
    expect(body).toContain('gold `To` @202411780')
    expect(body).toContain('nothing_to_forward')
    expect(body).toContain('plan_failed')
    expect(body).not.toContain('settings.set(')
    expect(body).not.toContain('export function Mo')
    expect(body).not.toContain('export function un')
    expect(body).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(body).not.toContain('tengu_violin_amati')
  })

  test('Ao successful outcomes', () => {
    expect(isSuccessfulSettingsUpload('sent')).toBe(true)
    expect(isSuccessfulSettingsUpload('unchanged')).toBe(true)
    expect(isSuccessfulSettingsUpload('conflict_resolved')).toBe(true)
    expect(isSuccessfulSettingsUpload('raced')).toBe(false)
    expect(isSuccessfulSettingsUpload('failed')).toBe(false)
    expect(isSuccessfulSettingsUpload('aborted')).toBe(false)
  })

  test('To pending / uploaded / nothing_to_send / failed', () => {
    expect(settingsToCloudReport(undefined, 'stored')).toEqual({
      state: 'forwarded',
      source: 'stored',
      pending: true,
    })
    expect(
      settingsToCloudReport({ kind: 'uploaded', outcome: 'sent' }, 'host'),
    ).toEqual({ state: 'forwarded', source: 'host' })
    expect(
      settingsToCloudReport({ kind: 'uploaded', outcome: 'raced' }, 'stored'),
    ).toEqual({ state: 'off', source: 'stored', reason: 'raced' })
    expect(
      settingsToCloudReport(
        {
          kind: 'uploaded',
          outcome: 'sent',
          settingsRefused: 'policy',
        },
        'stored',
      ),
    ).toEqual({ state: 'off', source: 'stored', reason: 'policy' })
    expect(
      settingsToCloudReport(
        { kind: 'not_uploaded', reason: 'nothing_to_send' },
        'stored',
      ),
    ).toEqual({
      state: 'off',
      source: 'stored',
      reason: 'nothing_to_forward',
    })
    expect(
      settingsToCloudReport({ kind: 'not_uploaded', reason: 'failed' }, 'host'),
    ).toEqual({ state: 'off', source: 'host', reason: 'plan_failed' })
    expect(
      settingsToCloudReport(
        { kind: 'not_uploaded', reason: 'unavailable' },
        'default',
      ),
    ).toEqual({ state: 'off', source: 'default', reason: 'unavailable' })
  })

  test('un: launch_flag / flag_off / declined / no_consent / unbound / not_seeded', async () => {
    expect(
      (
        await createSettingsToCloudPack({ forwardHomeSettings: false })({})
      ).report(),
    ).toEqual({ state: 'off', reason: 'launch_flag' })
    expect(
      (
        await createSettingsToCloudPack({ forwardHomeSettings: true })({
          settingsToCloud: false,
        })
      ).report(),
    ).toEqual({ state: 'off', reason: 'flag_off' })
    expect(
      (
        await createSettingsToCloudPack({
          forwardHomeSettings: true,
          consentMode: 'keep_local',
        })({ settingsToCloud: true })
      ).report(),
    ).toEqual({ state: 'off', reason: 'declined', source: 'host' })
    expect(
      (
        await createSettingsToCloudPack({
          forwardHomeSettings: true,
          storedConsent: () => undefined,
        })({ settingsToCloud: true })
      ).report(),
    ).toEqual({ state: 'off', reason: 'no_consent', source: 'default' })
    expect(
      (
        await createSettingsToCloudPack({
          forwardHomeSettings: true,
          consentMode: 'forward',
        })({ settingsToCloud: true, bound: false })
      ).report(),
    ).toEqual({ state: 'off', reason: 'unbound', source: 'host' })
    expect(
      (
        await createSettingsToCloudPack({
          forwardHomeSettings: true,
          consentMode: 'forward',
        })({ settingsToCloud: true, bound: true, trigger: 'create' })
      ).report(),
    ).toEqual({ state: 'off', reason: 'not_seeded', source: 'host' })
    expect(
      (
        await createSettingsToCloudPack({
          forwardHomeSettings: true,
          consentMode: 'forward',
        })({ settingsToCloud: true, bound: true, trigger: 'attach' })
      ).report(),
    ).toEqual({ state: 'off', reason: 'flag_off', source: 'host' })
  })

  test('un homeSeed uses Mo; source stored vs host', async () => {
    const seed = {
      status: 'uploading',
      outcome: () => undefined as undefined,
      completion: Promise.resolve(),
    }
    const stored = await createSettingsToCloudPack({
      forwardHomeSettings: true,
    })({ homeSeed: seed })
    expect(stored.feature).toBe('settings')
    expect(stored.report()).toEqual({
      state: 'forwarded',
      source: 'stored',
      pending: true,
    })
    const host = await createSettingsToCloudPack({
      forwardHomeSettings: false,
      consentMode: 'keep_local',
    })({ homeSeed: seed })
    expect(host.report()).toEqual({
      state: 'forwarded',
      source: 'host',
      pending: true,
    })
  })

  test('Mo onSettled fires after completion', async () => {
    let resolve!: () => void
    const completion = new Promise<void>(r => {
      resolve = r
    })
    const pack = settingsToCloudHomeSeed(
      {
        status: 'uploading',
        outcome: () => ({ kind: 'uploaded', outcome: 'sent' }),
        completion,
      },
      'stored',
    )
    let settled = false
    pack.onSettled(() => {
      settled = true
    })
    expect(settled).toBe(false)
    resolve()
    await completion
    await Promise.resolve()
    expect(settled).toBe(true)
    expect(pack.report()).toEqual({ state: 'forwarded', source: 'stored' })
  })

  test('Se omits source when absent', () => {
    expect(settingsToCloudOff('launch_flag').report()).toEqual({
      state: 'off',
      reason: 'launch_flag',
    })
  })
})
