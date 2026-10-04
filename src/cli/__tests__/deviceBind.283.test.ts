/**
 * densable 2.1.283 Far / $ar / tTn / Xwt / eTn / Nar / Ito / oZe source-lock.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  $ar,
  A2o,
  D2o,
  DEVICE_BIND_KID_PREFIX,
  eTn,
  Far,
  gqo,
  I2o,
  Ito,
  K,
  k4t,
  loadDeviceKeyRow,
  M2o,
  Nar,
  nzt,
  O2o,
  oZe,
  pWe,
  q,
  Qwt,
  Re,
  tTn,
  DeviceRegistrationUnavailableError,
  XGt,
  Xwt,
  y,
} from '../deviceBind.js'

const src = readFileSync(join(import.meta.dir, '../deviceBind.ts'), 'utf8')

const UUID = '11111111-1111-1111-1111-111111111111'
const key = { sign: async (payload: Buffer) => payload }

describe('deviceBind 283 Far/$ar/tTn/eTn/Nar', () => {
  test('source-locks gold prefixes, pack strings, and signer wrap', () => {
    expect(src).toContain('anthropic.ccr.create_session_bind.v1')
    expect(src).toContain('anthropic.ccr.session_bind.v1')
    expect(src).toContain('anthropic.ccr.tool_host_link.v1')
    expect(src).toContain('anthropic.ccr.tool_host_link.v2')
    expect(src).toContain('export const Xwt = DEVICE_BIND_KID_PREFIX')
    expect(Xwt).toBe('creg_')
    expect(DEVICE_BIND_KID_PREFIX).toBe('creg_')
    expect(src).toContain(
      'deviceBind: tool-host link capabilities must be 1 to 8 sorted, distinct names of a-z, 0-9, _ and .',
    )
    expect(src).toContain(
      'deviceBind: tool-host link request ids must be 1 to 65535 bytes',
    )
    expect(src).toContain('client_event_signer')
    expect(src).toContain('[clientEventSigner] could not load the device key')
    expect(src).toContain('no_device_key')
    expect(src).toContain('load_failed')
    expect(src).toContain('P({accountUuid,boundDeviceUuid,credentials,held})')
    expect(src).toContain('p(n.rowPk, n.key)')
    expect(src).toContain('coworkRemoteDevice')
    expect(src).toContain('anthropic.ccr.client_event.v1')
    expect(src).toContain('claude-code-jcs@1')
    expect(src).toContain('createClientEventSigner')
    expect(src).toContain('loadDeviceKeyForAccount')
    expect(src).toContain('signSessionBindAttestation')
    expect(src).not.toContain('generateKeyPairSync')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(src).not.toContain('amati')
    expect(src).toContain('async function Qwt')
    expect(src).toContain('client egress policy')
    expect(src).toContain('isCloudEgressAllowed')
    expect(src).toContain('deviceRegistry: no_device_key')
    expect(src).toContain('deviceRegistry: register request failed')
    expect(src).toContain('deviceRegistry: register not sent')
    expect(src).toContain('deviceRegistry: register HTTP error')
    expect(src).toContain(
      "deviceRegistry: the removed device's key could not be retired (",
    )
    expect(src).toContain('deviceRegistry: device key not retired')
    expect(src).toContain(
      '[deviceKey] device key stays in the credentials store for now (',
    )
    expect(src).toContain('Claude Code on ${hostname()} · ${platform()}')
    expect(src).toContain('tengu_device_bind_skipped')
    expect(src).toContain('tengu_device_bind_failed')
    expect(src).toContain('e.onBound?.(n.value)')
    expect(src).toContain('e.onUnbound?.(n.error)')
    expect(src).toContain('bind_attestation_stale')
    expect(src).toContain('postBoundCreateSession')
    expect(src).not.toContain('onBound(sessionId)')
  })

  test('tTn accepts already-sorted distinct 1–8 names', () => {
    expect(tTn(['a', 'b'])).toEqual(['a', 'b'])
    expect(tTn(['b', 'a'])).toBeUndefined()
    expect(tTn([])).toBeUndefined()
    expect(tTn(['Bad'])).toBeUndefined()
    expect(tTn(['a', 'a'])).toBeUndefined()
  })

  test('Far kid is creg_+deviceUUID', async () => {
    const att = await Far({
      orgUuid: UUID,
      accountUuid: UUID,
      sessionUuid: UUID,
      deviceUUID: UUID,
      key,
      now: () => 0,
    })
    expect(att.kid).toBe(`creg_${UUID}`)
    expect(att.deviceUUID).toBe(UUID)
    expect(att.issuedAt).toBe(new Date(0).toISOString())
    expect(att.signature.length).toBeGreaterThan(0)
  })

  test('$ar v1 vs v2; malformed capabilities throw', async () => {
    const base = {
      orgUuid: UUID,
      accountUuid: UUID,
      sessionUuid: UUID,
      deviceUUID: UUID,
      request: { workId: 'w', environmentId: 'e' },
      key,
      now: () => 0,
    }
    const v1 = await $ar(base)
    const v2 = await $ar({ ...base, capabilities: ['a', 'b'] })
    expect(v1.kid).toBe(`creg_${UUID}`)
    expect(v2.signature).not.toBe(v1.signature)
    await expect($ar({ ...base, capabilities: ['b', 'a'] })).rejects.toThrow(
      'deviceBind: tool-host link capabilities must be 1 to 8 sorted, distinct names of a-z, 0-9, _ and .',
    )
  })

  test('Ito/oZe/loadDeviceKeyRow/eTn/Nar wrap nothing without a store', async () => {
    expect(await Ito(UUID)).toBeUndefined()
    expect(await oZe(UUID)).toBeUndefined()
    expect(await oZe(UUID, { accountUuid: UUID, rowPk: 'held' })).toBe('held')
    expect(await loadDeviceKeyRow(UUID)).toEqual({
      status: 'no_device_key',
    })
    expect(await eTn(UUID, {})).toBeUndefined()
    expect(await Nar(UUID, {})).toBeUndefined()
    expect(
      await loadDeviceKeyRow(UUID, {}, { accountUuid: UUID, rowPk: UUID, key }),
    ).toEqual({ status: 'loaded', rowPk: UUID, key })
  })

  test('Qwt/Re refuse no_device_key; K logs only; k4t no-op; pWe hostname', async () => {
    await expect(Re(UUID, 'n', {}, false)).rejects.toMatchObject({
      errorClass: 'no_device_key',
    })
    await expect(
      Qwt(UUID, 'n', {}, { relearn: false, isEgressAllowed: () => false }),
    ).rejects.toMatchObject({ errorClass: 'registration_unavailable' })
    await expect(
      Qwt(UUID, 'n', {}, { relearn: false, isEgressAllowed: () => true }),
    ).rejects.toMatchObject({ errorClass: 'no_device_key' })
    expect(K(UUID, 'legacy_delete_failed')).toBe('legacy')
    await k4t(UUID)
    expect(pWe()).toContain('Claude Code on ')
    expect(pWe()).toContain(' · ')
    expect(src).toContain('return Qwt(e, r, i, { relearn: true })')
  })

  test('gqo gate skip + XGt only calls provided onBound', async () => {
    const skipped = q('gate')
    expect(skipped).toEqual({ ok: false, error: 'gate' })
    expect(
      y(
        'register',
        new DeviceRegistrationUnavailableError('client egress policy'),
      ),
    ).toBe('registration_unavailable')
    const out = await gqo({ isEnabled: async () => false })
    expect(out).toEqual({ ok: false, error: 'gate' })
    const bound: string[] = []
    const unbound: Array<string | undefined> = []
    XGt(
      { onBound: id => bound.push(id), onUnbound: r => unbound.push(r) },
      { ok: true, value: UUID },
    )
    XGt(
      { onBound: id => bound.push(id), onUnbound: r => unbound.push(r) },
      { ok: false, error: 'gate' },
    )
    XGt(undefined, { ok: true, value: UUID })
    expect(bound).toEqual([UUID])
    expect(unbound).toEqual(['gate'])
  })

  test('A2o/M2o/I2o/O2o/D2o map bind_attestation_stale; nzt wraps unsigned post', async () => {
    expect(A2o(400)).toBe(true)
    expect(A2o(500)).toBe(false)
    expect(M2o('bind_attestation_stale')).toBe(true)
    expect(I2o({ error: { reason: 'bind_attestation_stale' } })).toBe(
      'bind_attestation_stale',
    )
    expect(O2o(404, undefined)).toBe('device_unknown')
    expect(O2o(400, 'other')).toBe('create_refused')
    expect(D2o({ session: { bound_device_uuid: UUID.toUpperCase() } })).toBe(
      UUID,
    )
    const posted: unknown[] = []
    const wrap = await nzt({
      prepared: { ok: false },
      buildBody: att => {
        posted.push(att)
        return { unsigned: true }
      },
      post: async body => ({ status: 201, body }),
      postBoundCreateSession: async opts => ({
        response: await opts.post(opts.buildBody(undefined)),
        bind: opts.prepared,
        attested: false,
        firstPromptDeferred: false,
      }),
    })
    expect(posted).toEqual([undefined])
    expect(wrap.attested).toBe(false)
    expect(wrap.bind).toEqual({ ok: false })
  })
})
