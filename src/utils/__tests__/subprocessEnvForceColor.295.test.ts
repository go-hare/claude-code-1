import { afterEach, describe, expect, test } from 'bun:test'
import { subprocessEnv } from '../subprocessEnv.js'

describe('subprocessEnv #383 FORCE_COLOR=3 stripping', () => {
  const origBgBackend = process.env.CLAUDE_BG_BACKEND
  const origForceColor = process.env.FORCE_COLOR

  afterEach(() => {
    if (origBgBackend === undefined) delete process.env.CLAUDE_BG_BACKEND
    else process.env.CLAUDE_BG_BACKEND = origBgBackend
    if (origForceColor === undefined) delete process.env.FORCE_COLOR
    else process.env.FORCE_COLOR = origForceColor
  })

  test('strips daemon-injected FORCE_COLOR=3 from child env', () => {
    process.env.CLAUDE_BG_BACKEND = 'daemon'
    process.env.FORCE_COLOR = '3'
    const env = subprocessEnv()
    expect(env.FORCE_COLOR).toBeUndefined()
  })

  test('preserves non-daemon FORCE_COLOR', () => {
    delete process.env.CLAUDE_BG_BACKEND
    process.env.FORCE_COLOR = '3'
    const env = subprocessEnv()
    expect(env.FORCE_COLOR).toBe('3')
  })
})
