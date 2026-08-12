/**
 * densable 2.1.227 #2 — CLAUDE_CODE_SUBPROCESS_ENV_SCRUB forces permission mode
 * default (iTu early return) under claude-code-action allowed_non_write_users.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { initialPermissionModeFromCLI } from '../permissionSetup.js'

const SCRUB_KEY = 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB'

describe('initialPermissionModeFromCLI under CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', () => {
  const prev = process.env[SCRUB_KEY]

  afterEach(() => {
    if (prev === undefined) delete process.env[SCRUB_KEY]
    else process.env[SCRUB_KEY] = prev
  })

  test('forces default with notification when bypass requested', () => {
    process.env[SCRUB_KEY] = '1'
    const result = initialPermissionModeFromCLI({
      permissionModeCli: undefined,
      dangerouslySkipPermissions: true,
    })
    expect(result.mode).toBe('default')
    expect(result.fromAutoFallback).toBe(false)
    expect(result.notification).toContain('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB')
    expect(result.notification).toContain('allowed_non_write_users')
  })

  test('forces default with notification when non-default permissionModeCli', () => {
    process.env[SCRUB_KEY] = '1'
    const result = initialPermissionModeFromCLI({
      permissionModeCli: 'bypassPermissions',
      dangerouslySkipPermissions: undefined,
    })
    expect(result.mode).toBe('default')
    expect(result.notification).toContain('Permission mode forced to default')
  })

  test('forces default without notification when already default', () => {
    process.env[SCRUB_KEY] = '1'
    const result = initialPermissionModeFromCLI({
      permissionModeCli: 'default',
      dangerouslySkipPermissions: undefined,
    })
    expect(result.mode).toBe('default')
    expect(result.notification).toBeUndefined()
    expect(result.fromAutoFallback).toBe(false)
  })

  test('does not force when scrub env unset', () => {
    delete process.env[SCRUB_KEY]
    const result = initialPermissionModeFromCLI({
      permissionModeCli: undefined,
      dangerouslySkipPermissions: true,
    })
    // Without scrub, dangerouslySkipPermissions should yield bypass (or
    // org-disabled notification path) — not the scrub force string.
    expect(result.notification ?? '').not.toContain(
      'allowed_non_write_users hardening',
    )
  })
})
