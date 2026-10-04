/**
 * densable 2.1.283 leftover wrap source-lock for cloudCreateError.ts.
 *
 * Gold SEA `/tmp/official-283/package/claude` — gold `Pn` @200204633.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  reportRemoteCreateSessionError,
  UNABLE_TO_CREATE_CLOUD_SESSION_ERROR,
} from '../cloudCreateError.js'

const src = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8')

describe('cloudCreateError 283 leftover wrap', () => {
  test('cloudCreateError.ts locks gold Pn event names and unable copy', () => {
    const body = src('../cloudCreateError.ts')
    expect(body).toContain('gold `Pn` @200204633')
    expect(body).toContain('tengu_remote_create_session_error')
    expect(body).toContain('tengu_feature_bad')
    expect(body).toContain('remote_headless_session')
    expect(body).toContain('create_failed')
    expect(body).toContain('Unable to create cloud session')
    expect(body).toContain('create_endpoint')
    expect(body).toContain('server_reason')
    expect(body).toContain('deny_transient')
    expect(body).toContain('const CREATE_SESSION_ERROR_CLIP = 2000')
    expect(UNABLE_TO_CREATE_CLOUD_SESSION_ERROR).toBe(
      'Error: Unable to create cloud session',
    )
    expect(body).not.toMatch(/^export (async )?function Pn\b/m)
    expect(body).not.toContain("from './cloudSession.js'")
    expect(body).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(body).not.toContain('settings.set')
    expect(body).not.toContain('tengu_violin_amati')
    expect(body).not.toContain('device-key')
  })

  test('Pn returns failed + Unable to create cloud session when fail is absent', async () => {
    const result = await reportRemoteCreateSessionError({
      aborted: false,
      branchMode: 'new',
      entryPoint: 'cloud_headless_bare',
    })
    expect(result).toEqual({
      kind: 'failed',
      message: 'Error: Unable to create cloud session',
    })
    expect(result.message).toBe(UNABLE_TO_CREATE_CLOUD_SESSION_ERROR)
  })

  test('Pn clips fail.message at vt=2000 and still kind failed', async () => {
    const long = 'x'.repeat(2500)
    const result = await reportRemoteCreateSessionError({
      aborted: true,
      fail: { message: long, reason: 'bundle_failed' },
      branchMode: 'on_branch',
      entryPoint: 'cloud_headless_bare',
    })
    expect(result.kind).toBe('failed')
    expect(result.message).toBe(`Error: ${'x'.repeat(2000)}`)
    expect(result.message.length).toBe('Error: '.length + 2000)
  })

  test('Pn includes create fail detail fields in source and prefixes Error:', async () => {
    const result = await reportRemoteCreateSessionError({
      aborted: false,
      fail: {
        message: 'env create exploded',
        reason: 'env_create_failed',
        detail: {
          endpoint: 'https://example.invalid/create',
          serverReason: 'quota',
          preflightTransient: true,
        },
      },
      branchMode: 'ref',
      entryPoint: 'cloud_headless_bare',
    })
    expect(result).toEqual({
      kind: 'failed',
      message: 'Error: env create exploded',
    })
  })
})
