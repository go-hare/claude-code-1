import { describe, expect, test } from 'bun:test'
import {
  buildReinitSuccessResponse,
  reinitRedeliveryTelemetry,
  TENG_U_REINIT_PENDING_REDELIVERY,
} from '../sdkReinitRedelivery.js'

describe('buildReinitSuccessResponse densable #5', () => {
  test('reinit is success (not Already initialized error) with pending fields', () => {
    const res = buildReinitSuccessResponse({
      requestId: 'init-2',
      initResponse: { commands: [], agents: [], pid: 1 },
      pendingPermissionRequests: [{ request_id: 'p1' }],
      pendingUserDialogRequests: [{ request_id: 'd1' }],
    })
    expect(res.subtype).toBe('success')
    expect(res.request_id).toBe('init-2')
    expect(res.response).toEqual({ commands: [], agents: [], pid: 1 })
    expect(res.pending_permission_requests).toEqual([{ request_id: 'p1' }])
    expect(res.pending_user_dialog_requests).toEqual([{ request_id: 'd1' }])
    // Must not look like the pre-216 error path
    expect(res).not.toHaveProperty('error')
  })

  test('empty pending arrays still success (idle reconnect with no parks)', () => {
    const res = buildReinitSuccessResponse({
      requestId: 'init-idle',
      initResponse: { pid: 9 },
      pendingPermissionRequests: [],
      pendingUserDialogRequests: [],
    })
    expect(res.subtype).toBe('success')
    expect(res.pending_permission_requests).toEqual([])
    expect(res.pending_user_dialog_requests).toEqual([])
  })
})

describe('reinitRedeliveryTelemetry densable tengu_reinit_pending_redelivery', () => {
  test('event name is densable gold', () => {
    expect(TENG_U_REINIT_PENDING_REDELIVERY).toBe(
      'tengu_reinit_pending_redelivery',
    )
  })

  test('counts match densable n_pending_permissions / n_pending_dialogs', () => {
    expect(reinitRedeliveryTelemetry(2, 1)).toEqual({
      n_pending_permissions: 2,
      n_pending_dialogs: 1,
    })
  })
})
