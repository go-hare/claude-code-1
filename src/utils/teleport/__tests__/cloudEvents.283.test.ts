/**
 * densable 2.1.283 PJ/We/Le/hPe/pBe source-lock + GET `/events` desc wrap.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 * - `PJ` @202122311
 * - `Le` GET `${sessionUrl}/events`
 * - `We` reverse `data` + 403 device-token renew
 * - `hPe` @202123784 `fetchLatestEvents` + `assistant_history_load`
 * - `pBe` cursor `fetchOlderEvents`
 * - `Ve` `X-Trusted-Device-Token`
 * - `nht=5`
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { setupAxiosMock } from '../../../../tests/mocks/axios.js'

const src = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8')

const axiosHandle = setupAxiosMock()

beforeAll(() => {
  axiosHandle.useStubs = true
})
afterAll(() => {
  axiosHandle.useStubs = false
})

describe('cloudEvents 283 PJ/We/Le/hPe/pBe source-lock', () => {
  test('api.ts lands gold events GET + 403 strings', () => {
    const body = src('../api.ts')
    expect(body).toContain('fetchLatestEvents')
    expect(body).toContain('assistant_history_load')
    expect(body).toContain('X-Trusted-Device-Token')
    expect(body).toContain("sort_order: 'desc'")
    expect(body).toContain('untrusted_device')
    expect(body).toContain(
      'the service does not accept a trusted-device token from this computer',
    )
    expect(body).toContain('no answer after renewing the device token')
    expect(body).toContain('openCloudEventsSession')
    expect(body).toContain('getCloudSessionEventsPage')
    expect(body).toContain('loadCloudSessionEvents')
    expect(body).toContain('fetchLatestCloudEvents')
    expect(body).toContain('fetchOlderEvents')
    expect(body).toContain('headersForRenewedDeviceToken')
    expect(body).toContain('recoverTrustedDeviceTokenAfterUntrusted')
    expect(body).toContain('isViolinWoodEnabled')
    expect(body).toContain('isTrustedDeviceGateEnabled')
    expect(body).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
  })

  test('We reverses payload rows and keeps next_cursor', async () => {
    const { loadCloudSessionEvents } = await import('../api.js')
    axiosHandle.stubs.get = async (
      url: string,
      config?: { params?: Record<string, unknown> },
    ) => {
      expect(url).toBe('https://api.example/v1/code/sessions/cse_1/events')
      expect(config?.params).toEqual({ limit: 5, sort_order: 'desc' })
      return {
        status: 200,
        data: {
          data: [
            { payload: { type: 'newer' }, sequence_num: '2', created_at: 'b' },
            { payload: { type: 'older' }, sequence_num: '1', created_at: 'a' },
            { sequence_num: '0' },
          ],
          next_cursor: 'cur_1',
        },
        headers: {},
        statusText: 'OK',
        config: {},
      }
    }
    const page = await loadCloudSessionEvents(
      {
        sessionUrl: 'https://api.example/v1/code/sessions/cse_1',
        headers: { Authorization: 'Bearer t' },
      },
      { limit: 5, sort_order: 'desc' },
      'fetchLatestEvents',
    )
    expect(page).toMatchObject({
      firstId: 'cur_1',
      hasMore: true,
      droppedRows: 1,
      newestSequenceNum: 2,
    })
    expect(page?.events.map(e => (e.payload as { type: string }).type)).toEqual(
      ['older', 'newer'],
    )
  })

  test('403 untrusted_device after renew: gold We throws only when wV()', async () => {
    const { loadCloudSessionEvents } = await import('../api.js')
    axiosHandle.stubs.get = async () => ({
      status: 403,
      data: { error: { resource: 'untrusted_device' } },
      headers: {},
      statusText: 'Forbidden',
      config: {},
    })
    const page = await loadCloudSessionEvents(
      {
        sessionUrl: 'https://api.example/v1/code/sessions/cse_1',
        headers: { 'X-Trusted-Device-Token': 'old' },
        headersForRenewedDeviceToken: async token => ({
          'X-Trusted-Device-Token': token,
        }),
      },
      { limit: 5, sort_order: 'desc' },
      'fetchLatestEvents',
    )
    expect(page).toBeNull()
  })

  test('no answer after renewing the device token returns null', async () => {
    const { loadCloudSessionEvents } = await import('../api.js')
    axiosHandle.stubs.get = async () => ({
      status: 403,
      data: { error: { resource: 'untrusted_device' } },
      headers: {},
      statusText: 'Forbidden',
      config: {},
    })
    const page = await loadCloudSessionEvents(
      {
        sessionUrl: 'https://api.example/v1/code/sessions/cse_1',
        headers: {},
        headersForRenewedDeviceToken: async () => {
          throw new Error('renew failed')
        },
      },
      { limit: 5, sort_order: 'desc' },
      'fetchLatestEvents',
    )
    expect(page).toBeNull()
  })
})
