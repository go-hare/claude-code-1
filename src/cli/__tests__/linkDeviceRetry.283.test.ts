/**
 * densable 2.1.283 leftover `as`/`us` POST `/device` retry wrap.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 * - `as` @202317879
 * - `us` @202321401
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  BIND_ATTESTATION_STALE_RESOURCE,
  busyRetryDelaysMs,
  classifyLinkDeviceResponse,
  DEVICE_NOT_FOUND_RESOURCE,
  LATE_BIND_REFUSED_RESOURCE,
  LINK_DEVICE_RETRY_DEADLINE_MS,
  linkSessionDeviceWithRetry,
  SESSION_ALREADY_BOUND_ELSEWHERE_DETAIL,
  SESSION_WORKER_BUSY_DETAIL,
  TOOL_HOST_GRANT_REFUSED_RESOURCE,
  TOOL_HOST_PROOF_INVALID_SUBREASON,
  transientRetryDelaysMs,
  type LinkDevicePrepared,
} from '../linkDeviceRetry.js'

const src = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8')

const UUID = '11111111-1111-1111-1111-111111111111'
const key = { sign: async (payload: Buffer) => payload }
const prepared: LinkDevicePrepared = {
  ok: true,
  local: { ok: true, sessionUuid: UUID, accountUuid: UUID },
  registered: { deviceUUID: UUID, key },
}

describe('linkDeviceRetry 283 leftover wrap', () => {
  test('source-locks gold as/us delays, resources, and attach-serve logs', () => {
    const body = src('../linkDeviceRetry.ts')
    expect(body).toContain('gold `as` @202317879')
    expect(body).toContain('gold `us` @202321401')
    expect(body).toContain('gold `ss`')
    expect(body).toContain('gold `is`')
    expect(body).toContain('gold `os`')
    expect(body).toContain('gold `ts`')
    expect(body).toContain('gold `Jn`')
    expect(body).toContain('gold `Xn`')
    expect(body).toContain('gold `Zn`')
    expect(body).toContain('gold `Tt`')
    expect(body).toContain('gold `Yn`')
    expect(body).toContain('gold `Ft`')
    expect(body).toContain('`/v1/code/sessions/${e}/device`')
    expect(body).toContain('session_worker_busy')
    expect(body).toContain('session_already_bound_elsewhere')
    expect(body).toContain('device_not_found')
    expect(body).toContain('bind_attestation_stale')
    expect(body).toContain('late_bind_refused')
    expect(body).toContain('tool_host_grant_refused')
    expect(body).toContain('tool_host_proof_invalid')
    expect(body).toContain(
      '[attach-serve] the service did not take the v2 link proof; sending the v1 proof without the capability list',
    )
    expect(body).toContain('[attach-serve] signing the link proof failed:')
    expect(body).toContain('[attach-serve] link failed unexpectedly:')
    expect(body).toContain('linkSessionDeviceCaught')
    expect(body).toContain(
      '[attach-serve] could not read what this computer declares on a link; declaring nothing:',
    )
    expect(body).toContain('prepareLocalServeRegistration')
    expect(body).toContain('postSessionDeviceBind')
    expect(body).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(body).not.toContain('tengu_violin_amati')
    expect(body).not.toContain('export async function as')
    expect(body).not.toContain('export function us')
    expect(busyRetryDelaysMs).toEqual([
      2000, 4000, 8000, 12000, 15000, 15000, 15000,
    ])
    expect(transientRetryDelaysMs).toEqual([2000, 4000, 8000])
    expect(LINK_DEVICE_RETRY_DEADLINE_MS).toBe(90_000)
  })

  test('us: !ok auth vs local egress; 200 linked vs bound_elsewhere', () => {
    expect(
      classifyLinkDeviceResponse({ ok: false, reason: 'no-auth' }, UUID),
    ).toEqual({ next: 'final', refusal: { kind: 'auth' } })
    expect(
      classifyLinkDeviceResponse({ ok: false, reason: 'egress' }, UUID),
    ).toEqual({
      next: 'final',
      refusal: { kind: 'local', reason: 'egress' },
    })
    expect(
      classifyLinkDeviceResponse(
        {
          ok: true,
          status: 200,
          data: {},
          response: { headers: { 'request-id': 'r1' } },
        },
        UUID,
      ),
    ).toEqual({ next: 'linked' })
    expect(
      classifyLinkDeviceResponse(
        {
          ok: true,
          status: 200,
          data: { session: { bound_device_uuid: UUID } },
          response: { headers: {} },
        },
        UUID,
      ),
    ).toEqual({ next: 'linked' })
    expect(
      classifyLinkDeviceResponse(
        {
          ok: true,
          status: 200,
          data: {
            session: {
              bound_device_uuid: '22222222-2222-2222-2222-222222222222',
            },
          },
          response: { headers: {} },
        },
        UUID,
      ),
    ).toEqual({ next: 'final', refusal: { kind: 'bound_elsewhere' } })
  })

  test('us: 409 busy / bound elsewhere / else unavailable', () => {
    expect(
      classifyLinkDeviceResponse(
        {
          ok: true,
          status: 409,
          data: { error: { details: SESSION_WORKER_BUSY_DETAIL } },
          response: { headers: {} },
        },
        UUID,
      ),
    ).toEqual({ next: 'busy' })
    expect(
      classifyLinkDeviceResponse(
        {
          ok: true,
          status: 409,
          data: { error: { details: SESSION_ALREADY_BOUND_ELSEWHERE_DETAIL } },
          response: { headers: {} },
        },
        UUID,
      ),
    ).toEqual({ next: 'final', refusal: { kind: 'bound_elsewhere' } })
    expect(
      classifyLinkDeviceResponse(
        {
          ok: true,
          status: 409,
          data: { error: { details: 'other' } },
          response: { headers: {} },
        },
        UUID,
      ),
    ).toEqual({ next: 'final', refusal: { kind: 'unavailable', status: 409 } })
  })

  test('us: 403 device_unknown / clock / proof_invalid / refused', () => {
    expect(
      classifyLinkDeviceResponse(
        {
          ok: true,
          status: 403,
          data: { error: { resource: DEVICE_NOT_FOUND_RESOURCE } },
          response: { headers: {} },
        },
        UUID,
      ),
    ).toEqual({ next: 'device_unknown' })
    expect(
      classifyLinkDeviceResponse(
        {
          ok: true,
          status: 403,
          data: { error: { resource: BIND_ATTESTATION_STALE_RESOURCE } },
          response: { headers: {} },
        },
        UUID,
      ),
    ).toEqual({ next: 'final', refusal: { kind: 'clock' } })
    expect(
      classifyLinkDeviceResponse(
        {
          ok: true,
          status: 403,
          data: {
            error: {
              resource: LATE_BIND_REFUSED_RESOURCE,
              sub_reason: TOOL_HOST_PROOF_INVALID_SUBREASON,
            },
          },
          response: { headers: {} },
        },
        UUID,
      ),
    ).toEqual({ next: 'proof_invalid' })
    expect(
      classifyLinkDeviceResponse(
        {
          ok: true,
          status: 403,
          data: {
            error: {
              resource: LATE_BIND_REFUSED_RESOURCE,
              sub_reason: 'terminal',
            },
          },
          response: { headers: {} },
        },
        UUID,
      ),
    ).toEqual({
      next: 'final',
      refusal: { kind: 'refused', subReason: 'terminal' },
    })
    expect(
      classifyLinkDeviceResponse(
        {
          ok: true,
          status: 403,
          data: { error: { resource: TOOL_HOST_GRANT_REFUSED_RESOURCE } },
          response: { headers: {} },
        },
        UUID,
      ),
    ).toEqual({
      next: 'final',
      refusal: { kind: 'refused', subReason: 'other' },
    })
  })

  test('us: 412 / 401 / 404 / 5xx / 429 / 408 / else unavailable', () => {
    expect(
      classifyLinkDeviceResponse(
        { ok: true, status: 412, data: {}, response: { headers: {} } },
        UUID,
      ),
    ).toEqual({ next: 'final', refusal: { kind: 'dispatch_disabled' } })
    expect(
      classifyLinkDeviceResponse(
        { ok: true, status: 401, data: {}, response: { headers: {} } },
        UUID,
      ),
    ).toEqual({ next: 'final', refusal: { kind: 'auth' } })
    expect(
      classifyLinkDeviceResponse(
        { ok: true, status: 404, data: {}, response: { headers: {} } },
        UUID,
      ),
    ).toEqual({ next: 'final', refusal: { kind: 'not_found' } })
    expect(
      classifyLinkDeviceResponse(
        { ok: true, status: 500, data: {}, response: { headers: {} } },
        UUID,
      ),
    ).toEqual({ next: 'transient', status: 500 })
    expect(
      classifyLinkDeviceResponse(
        { ok: true, status: 429, data: {}, response: { headers: {} } },
        UUID,
      ),
    ).toEqual({ next: 'transient', status: 429 })
    expect(
      classifyLinkDeviceResponse(
        { ok: true, status: 408, data: {}, response: { headers: {} } },
        UUID,
      ),
    ).toEqual({ next: 'transient', status: 408 })
    expect(
      classifyLinkDeviceResponse(
        { ok: true, status: 418, data: {}, response: { headers: {} } },
        UUID,
      ),
    ).toEqual({ next: 'final', refusal: { kind: 'unavailable', status: 418 } })
  })

  test('as: 200 linked; 200 bound_device_uuid mismatch bound_elsewhere', async () => {
    const linked = await linkSessionDeviceWithRetry({
      sessionId: 'cse_1',
      orgUuid: UUID,
      prepared,
      seams: {
        post: async () => ({
          ok: true,
          status: 200,
          data: {},
          response: { headers: {} },
        }),
      },
    })
    expect(linked).toEqual({ ok: true, deviceId: UUID })
    const elsewhere = await linkSessionDeviceWithRetry({
      sessionId: 'cse_1',
      orgUuid: UUID,
      prepared,
      seams: {
        post: async () => ({
          ok: true,
          status: 200,
          data: {
            session: {
              bound_device_uuid: '22222222-2222-2222-2222-222222222222',
            },
          },
          response: { headers: {} },
        }),
      },
    })
    expect(elsewhere.ok).toBe(false)
    if (!elsewhere.ok) {
      expect(elsewhere.refusal).toEqual({ kind: 'bound_elsewhere' })
      expect(elsewhere.message).toContain(
        'the session is already linked to a different computer.',
      )
    }
  })

  test('as: 409 busy then 200; 409 bound elsewhere', async () => {
    let n = 0
    const slept: number[] = []
    const linked = await linkSessionDeviceWithRetry({
      sessionId: 'cse_1',
      orgUuid: UUID,
      prepared,
      seams: {
        busyRetryDelaysMs: [0],
        sleep: async ms => {
          slept.push(ms)
        },
        post: async () => {
          n += 1
          if (n === 1) {
            return {
              ok: true,
              status: 409,
              data: { error: { details: SESSION_WORKER_BUSY_DETAIL } },
              response: { headers: {} },
            }
          }
          return {
            ok: true,
            status: 200,
            data: {},
            response: { headers: {} },
          }
        },
      },
    })
    expect(linked).toEqual({ ok: true, deviceId: UUID })
    expect(slept).toEqual([0])
    const bound = await linkSessionDeviceWithRetry({
      sessionId: 'cse_1',
      orgUuid: UUID,
      prepared,
      seams: {
        post: async () => ({
          ok: true,
          status: 409,
          data: { error: { details: SESSION_ALREADY_BOUND_ELSEWHERE_DETAIL } },
          response: { headers: {} },
        }),
      },
    })
    expect(bound.ok).toBe(false)
    if (!bound.ok) expect(bound.refusal).toEqual({ kind: 'bound_elsewhere' })
  })

  test('as: 403/500/412/401/404; 500 retries then linked', async () => {
    const forbidden = await linkSessionDeviceWithRetry({
      sessionId: 'cse_1',
      orgUuid: UUID,
      prepared,
      seams: {
        post: async () => ({
          ok: true,
          status: 403,
          data: { error: { resource: BIND_ATTESTATION_STALE_RESOURCE } },
          response: { headers: {} },
        }),
      },
    })
    expect(forbidden.ok).toBe(false)
    if (!forbidden.ok) expect(forbidden.refusal).toEqual({ kind: 'clock' })

    let n = 0
    const recovered = await linkSessionDeviceWithRetry({
      sessionId: 'cse_1',
      orgUuid: UUID,
      prepared,
      seams: {
        transientRetryDelaysMs: [0],
        sleep: async () => {},
        post: async () => {
          n += 1
          if (n === 1) {
            return {
              ok: true,
              status: 500,
              data: {},
              response: { headers: {} },
            }
          }
          return {
            ok: true,
            status: 200,
            data: {},
            response: { headers: {} },
          }
        },
      },
    })
    expect(recovered).toEqual({ ok: true, deviceId: UUID })

    const disabled = await linkSessionDeviceWithRetry({
      sessionId: 'cse_1',
      orgUuid: UUID,
      prepared,
      seams: {
        post: async () => ({
          ok: true,
          status: 412,
          data: {},
          response: { headers: {} },
        }),
      },
    })
    expect(disabled.ok).toBe(false)
    if (!disabled.ok) {
      expect(disabled.refusal).toEqual({ kind: 'dispatch_disabled' })
    }
  })

  test('as: without key.sign calls prepare and refuses no_device_key without signing', async () => {
    let signed = 0
    let preparedCalls = 0
    const got = await linkSessionDeviceWithRetry({
      sessionId: 'cse_1',
      orgUuid: UUID,
      seams: {
        servingOff: async () => undefined,
        identity: async () => {
          preparedCalls += 1
          return { ok: true, accountUuid: UUID }
        },
        register: async () => {
          throw Object.assign(new Error('deviceRegistry: no_device_key'), {
            errorClass: 'no_device_key',
          })
        },
        sign: async opts => {
          signed += 1
          return {
            deviceUUID: opts.deviceUUID,
            kid: `creg_${opts.deviceUUID}`,
            signature: 'nope',
            issuedAt: new Date(0).toISOString(),
          }
        },
        post: async () => ({
          ok: true,
          status: 200,
          data: {},
          response: { headers: {} },
        }),
      },
    })
    expect(signed).toBe(0)
    expect(preparedCalls).toBe(1)
    expect(got.ok).toBe(false)
    if (!got.ok) {
      expect(got.refusal.kind).toBe('register')
      expect(
        got.refusal.kind === 'register' &&
          (got.refusal.reason === 'register' ||
            got.refusal.reason === 'no_device_key'),
      ).toBe(true)
      expect(got.message).toContain(
        'Error: cannot serve cloud session cse_1 from this computer:',
      )
    }

    const noSign = await linkSessionDeviceWithRetry({
      sessionId: 'cse_1',
      orgUuid: UUID,
      prepared: {
        ok: true,
        local: { ok: true, sessionUuid: UUID, accountUuid: UUID },
        registered: { deviceUUID: UUID, key: {} },
      },
      seams: {
        sign: async opts => {
          signed += 1
          return {
            deviceUUID: opts.deviceUUID,
            kid: `creg_${opts.deviceUUID}`,
            signature: 'nope',
            issuedAt: new Date(0).toISOString(),
          }
        },
      },
    })
    expect(signed).toBe(0)
    expect(noSign.ok).toBe(false)
    if (!noSign.ok) {
      expect(noSign.refusal).toEqual({
        kind: 'register',
        reason: 'no_device_key',
      })
    }
  })

  test('as: proof_invalid drops v2 capabilities and retries v1', async () => {
    const posts: Array<Record<string, unknown>> = []
    const proofSent = { form: undefined, retriedAsV1: false }
    const got = await linkSessionDeviceWithRetry({
      sessionId: 'cse_1',
      orgUuid: UUID,
      prepared,
      request: { workId: 'cse_work', environmentId: 'env_a' },
      proofSent,
      seams: {
        linkCapabilities: async () => ['a', 'b'],
        post: async (_path, body) => {
          posts.push(body)
          if (posts.length === 1) {
            return {
              ok: true,
              status: 403,
              data: {
                error: {
                  resource: LATE_BIND_REFUSED_RESOURCE,
                  sub_reason: TOOL_HOST_PROOF_INVALID_SUBREASON,
                },
              },
              response: { headers: {} },
            }
          }
          return {
            ok: true,
            status: 200,
            data: {},
            response: { headers: {} },
          }
        },
      },
    })
    expect(got).toEqual({ ok: true, deviceId: UUID })
    expect(posts[0]?.capabilities).toEqual(['a', 'b'])
    expect(posts[1]?.capabilities).toBeUndefined()
    expect(proofSent).toEqual({ form: 'v1', retriedAsV1: true })
  })

  test('as: linkCapabilities throw declares nothing; sign throw is register/sign', async () => {
    const caps = await linkSessionDeviceWithRetry({
      sessionId: 'cse_1',
      orgUuid: UUID,
      prepared,
      request: { workId: 'cse_work', environmentId: 'env_a' },
      seams: {
        linkCapabilities: async () => {
          throw new Error('caps')
        },
        post: async (_path, body) => {
          expect(body.capabilities).toBeUndefined()
          return {
            ok: true,
            status: 200,
            data: {},
            response: { headers: {} },
          }
        },
      },
    })
    expect(caps).toEqual({ ok: true, deviceId: UUID })

    const signed = await linkSessionDeviceWithRetry({
      sessionId: 'cse_1',
      orgUuid: UUID,
      prepared,
      seams: {
        sign: async () => {
          throw new Error('nope')
        },
        post: async () => ({
          ok: true,
          status: 200,
          data: {},
          response: { headers: {} },
        }),
      },
    })
    expect(signed.ok).toBe(false)
    if (!signed.ok) {
      expect(signed.refusal).toEqual({ kind: 'register', reason: 'sign' })
    }
  })
})
