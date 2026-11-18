import { afterEach, describe, expect, test } from 'bun:test'
import { isGzipRequestBodiesEnabled } from '../gzipRequestBodies.js'

const savedEnv = process.env.CLAUDE_CODE_GZIP_REQUEST_BODIES

afterEach(() => {
  if (savedEnv === undefined) delete process.env.CLAUDE_CODE_GZIP_REQUEST_BODIES
  else process.env.CLAUDE_CODE_GZIP_REQUEST_BODIES = savedEnv
})

describe('isGzipRequestBodiesEnabled (#813)', () => {
  test('defaults to true when env var is unset (even when telemetry/GB is off)', () => {
    delete process.env.CLAUDE_CODE_GZIP_REQUEST_BODIES
    expect(isGzipRequestBodiesEnabled({ env: {} })).toBe(true)
  })

  test('CLAUDE_CODE_GZIP_REQUEST_BODIES=0 disables gzip', () => {
    expect(
      isGzipRequestBodiesEnabled({
        env: { CLAUDE_CODE_GZIP_REQUEST_BODIES: '0' },
      }),
    ).toBe(false)
  })
})
