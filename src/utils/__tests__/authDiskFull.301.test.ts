import { describe, expect, test } from 'bun:test'
import { isDiskFullError, OAuthRefreshDiskFullError } from '../auth.js'

describe('2.1.301 #851 OAuth refresh disk full error', () => {
  test('isDiskFullError detects ENOSPC and EDQUOT directly and via .cause', () => {
    expect(isDiskFullError({ code: 'ENOSPC' })).toBe(true)
    expect(isDiskFullError({ code: 'EDQUOT' })).toBe(true)
    expect(isDiskFullError({ cause: { code: 'ENOSPC' } })).toBe(true)
    expect(isDiskFullError({ code: 'EACCES' })).toBe(false)
    expect(isDiskFullError(null)).toBe(false)
  })

  test('OAuthRefreshDiskFullError has official YX name and message', () => {
    const err = new OAuthRefreshDiskFullError()
    expect(err.name).toBe('OAuthRefreshDiskFullError')
    expect(err.message).toBe(
      'OAuth access token could not be refreshed: the disk that holds the Claude Code config directory, or the disk quota on it, is full; delete files you no longer need on that disk and try again',
    )
  })
})
