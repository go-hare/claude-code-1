/**
 * densable 2.1.214 Batch A #14 — docker/podman daemon-redirect flags (oGr + aQn)
 */
import { describe, expect, test } from 'bun:test'
import {
  DOCKER_DAEMON_REDIRECT_FLAGS,
  dockerDaemonRedirectIsDangerous,
} from '../readOnlyCommandValidation.js'

describe('dockerDaemonRedirectIsDangerous densable aQn (#14)', () => {
  test('exports oGr flag set including url/connection/identity/remote', () => {
    for (const flag of [
      '--url',
      '--connection',
      '--identity',
      '--remote',
      '-H',
      '--host',
      '--context',
      '--config',
    ] as const) {
      expect(DOCKER_DAEMON_REDIRECT_FLAGS).toContain(flag)
    }
  })

  test('detects long flags and =value form', () => {
    expect(dockerDaemonRedirectIsDangerous(['--url', 'ssh://x'])).toBe(true)
    expect(dockerDaemonRedirectIsDangerous(['--url=ssh://x'])).toBe(true)
    expect(dockerDaemonRedirectIsDangerous(['--connection=remote'])).toBe(true)
    expect(dockerDaemonRedirectIsDangerous(['--identity', 'key'])).toBe(true)
    expect(dockerDaemonRedirectIsDangerous(['--remote'])).toBe(true)
    expect(dockerDaemonRedirectIsDangerous(['--host', 'tcp://1.2.3.4'])).toBe(
      true,
    )
  })

  test('detects short -H and clustered short flags', () => {
    expect(dockerDaemonRedirectIsDangerous(['-H', 'tcp://x'])).toBe(true)
    expect(dockerDaemonRedirectIsDangerous(['-Htcp://x'])).toBe(true)
    expect(dockerDaemonRedirectIsDangerous(['-Hc'])).toBe(true)
    expect(dockerDaemonRedirectIsDangerous(['-cr'])).toBe(true)
  })

  test('safe docker logs args are not dangerous', () => {
    expect(dockerDaemonRedirectIsDangerous(['--tail', '10', 'cid'])).toBe(false)
    expect(dockerDaemonRedirectIsDangerous(['-f', 'cid'])).toBe(false)
    expect(dockerDaemonRedirectIsDangerous(['--timestamps'])).toBe(false)
  })
})
