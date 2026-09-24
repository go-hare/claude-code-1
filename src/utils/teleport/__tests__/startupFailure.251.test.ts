/**
 * densable 2.1.251 #38 — gold j8/K8/G8 (startup_failure → poll startupFailure).
 */
import { describe, expect, test } from 'bun:test'
import {
  CLOUD_INIT_ERROR_STALE_MS,
  deriveSessionStartupFailure,
  formatCloudEnvironmentStartError,
} from '../startupFailure.js'

describe('formatCloudEnvironmentStartError (K8)', () => {
  test('prefers message when present and not <nil>', () => {
    expect(
      formatCloudEnvironmentStartError({
        message: '  clone failed  ',
        error_kind: 'git_clone',
      }),
    ).toBe('clone failed')
  })

  test('drops <nil> message and uses typed kind', () => {
    expect(
      formatCloudEnvironmentStartError({
        message: '<nil>',
        error_kind: 'environment_deleted',
      }),
    ).toBe('the cloud environment failed to start (environment_deleted)')
  })

  test('generic fallback when kind is not an identifier', () => {
    expect(
      formatCloudEnvironmentStartError({
        message: '',
        error_kind: 'not a kind',
      }),
    ).toBe('the cloud environment failed to start')
  })
})

describe('deriveSessionStartupFailure (j8)', () => {
  const now = 1_700_000_000_000

  test('bridge environment_kind ignores last_init_error', () => {
    expect(
      deriveSessionStartupFailure(
        {
          environment_kind: 'bridge',
          worker_status: 'starting',
          external_metadata: {
            last_init_error: { message: 'boom', error_kind: 'x' },
          },
        },
        now,
      ),
    ).toBeUndefined()
  })

  test('environment_deleted is terminal even while worker is running', () => {
    expect(
      deriveSessionStartupFailure(
        {
          worker_status: 'running',
          external_metadata: {
            last_init_error: {
              error_kind: 'environment_deleted',
              message: 'gone',
            },
          },
        },
        now,
      ),
    ).toBe('gone')
  })

  test('recoverable init error is ignored while worker is down and fresh', () => {
    expect(
      deriveSessionStartupFailure(
        {
          worker_status: 'starting',
          external_metadata: {
            last_init_error: {
              recoverable: 'true',
              at: new Date(now - 1_000).toISOString(),
              message: 'retrying',
            },
          },
        },
        now,
      ),
    ).toBeUndefined()
  })

  test('stale recoverable init error (G8) is terminal when worker is down', () => {
    expect(
      deriveSessionStartupFailure(
        {
          worker_status: 'starting',
          external_metadata: {
            last_init_error: {
              recoverable: true,
              at: new Date(now - CLOUD_INIT_ERROR_STALE_MS - 1).toISOString(),
              message: 'gave up',
            },
          },
        },
        now,
      ),
    ).toBe('gave up')
  })

  test('status failed with no init error is provision failure', () => {
    expect(deriveSessionStartupFailure({ status: 'failed' }, now)).toBe(
      'the cloud environment could not be provisioned',
    )
  })
})
