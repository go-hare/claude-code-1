/**
 * densable 2.1.222 #3 — dismissed usage-credit request must not block re-request.
 * SEA BTr: cyp("limit_increase", ["pending"]) only; $$n confirms before iea create.
 */
import { describe, expect, test } from 'bun:test'
import {
  extractAdminRequestErrorMessage,
  hasBlockingPendingAdminRequest,
  USAGE_CREDITS_ADMIN_REQUEST_INTERACTIVE_HINT,
} from '../extra-usage-core.js'

describe('hasBlockingPendingAdminRequest (densable 2.1.222 #3)', () => {
  test('null / empty → not blocking', () => {
    expect(hasBlockingPendingAdminRequest(null)).toBe(false)
    expect(hasBlockingPendingAdminRequest(undefined)).toBe(false)
    expect(hasBlockingPendingAdminRequest([])).toBe(false)
  })

  test('pending → blocking (already-sent message path)', () => {
    expect(hasBlockingPendingAdminRequest([{ status: 'pending' }])).toBe(true)
  })

  test('dismissed alone → NOT blocking (changelog #3 re-request)', () => {
    expect(hasBlockingPendingAdminRequest([{ status: 'dismissed' }])).toBe(
      false,
    )
  })

  test('approved alone → NOT blocking', () => {
    expect(hasBlockingPendingAdminRequest([{ status: 'approved' }])).toBe(false)
  })

  test('dismissed + pending → still blocking', () => {
    expect(
      hasBlockingPendingAdminRequest([
        { status: 'dismissed' },
        { status: 'pending' },
      ]),
    ).toBe(true)
  })
})

describe('densable copy constants', () => {
  test('UTr interactive hint present', () => {
    expect(USAGE_CREDITS_ADMIN_REQUEST_INTERACTIVE_HINT).toContain(
      'run /usage-credits in an interactive',
    )
  })

  test('extractAdminRequestErrorMessage surfaces 4xx body message', () => {
    expect(
      extractAdminRequestErrorMessage({
        response: {
          status: 400,
          data: { error: { message: 'Rate limited by org policy' } },
        },
      }),
    ).toBe('Rate limited by org policy')
  })

  test('extractAdminRequestErrorMessage ignores 5xx', () => {
    expect(
      extractAdminRequestErrorMessage({
        response: {
          status: 503,
          data: { message: 'upstream' },
        },
      }),
    ).toBeNull()
  })
})

describe('source wiring densable BTr / pending-only', () => {
  test('extra-usage-core queries only pending statuses', async () => {
    const src = await Bun.file(
      new URL('../extra-usage-core.ts', import.meta.url),
    ).text()
    // densable cyp(..., ["pending"]) — must not pass dismissed into the query
    expect(src).toMatch(
      /getMyAdminRequests\(\s*'limit_increase',\s*\[\s*'pending',\s*\]/,
    )
    expect(src).not.toMatch(/getMyAdminRequests\([^)]*'dismissed'/)
    expect(src).toContain(
      "You've already sent a usage credit request to your admin.",
    )
    expect(src).toContain("type: 'confirm-admin-request'")
    expect(src).toContain('submitAdminUsageCreditRequest')
  })

  test('interactive mounts ConfirmAdminUsageRequest on confirm', async () => {
    const src = await Bun.file(
      new URL('../extra-usage.tsx', import.meta.url),
    ).text()
    expect(src).toContain('ConfirmAdminUsageRequest')
    expect(src).toContain("result.type === 'confirm-admin-request'")
  })

  test('noninteractive defers confirm with UTr (no auto-create)', async () => {
    const src = await Bun.file(
      new URL('../extra-usage-noninteractive.ts', import.meta.url),
    ).text()
    expect(src).toContain('USAGE_CREDITS_ADMIN_REQUEST_INTERACTIVE_HINT')
    expect(src).toContain('confirm-admin-request')
    expect(src).not.toContain('createAdminRequest')
  })
})
