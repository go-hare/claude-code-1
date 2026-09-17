/**
 * densable 2.1.227 #2 — CLAUDE_CODE_SUBPROCESS_ENV_SCRUB forces permission mode
 * default (iTu early return) under claude-code-action allowed_non_write_users.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  initialPermissionModeFromCLI,
  subprocessEnvScrubNotification,
} from '../permissionSetup.js'

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
    expect(result.modeSuppliedOnInvocation).toBe(true)
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
    expect(result.modeSuppliedOnInvocation).toBe(true)
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
    expect(result.modeSuppliedOnInvocation).toBe(true)
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
    expect(result.modeSuppliedOnInvocation).toBe(true)
  })

  test('scrub pins modeSuppliedOnInvocation even with no invocation flags', () => {
    process.env[SCRUB_KEY] = '1'
    const result = initialPermissionModeFromCLI({
      permissionModeCli: undefined,
      dangerouslySkipPermissions: undefined,
    })
    expect(result.mode).toBe('default')
    expect(result.modeSuppliedOnInvocation).toBe(true)
    expect(result.notification).toBeUndefined()
  })

  test('scrub notifies when agent frontmatter is non-default', () => {
    process.env[SCRUB_KEY] = '1'
    const result = initialPermissionModeFromCLI({
      permissionModeCli: undefined,
      dangerouslySkipPermissions: undefined,
      agentPermissionMode: 'plan',
    })
    expect(result.mode).toBe('default')
    expect(result.modeSuppliedOnInvocation).toBe(true)
    expect(result.notification).toContain('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB')
  })
})

/**
 * main.tsx computes the permission mode before agents load, so it re-runs this
 * helper at the initial-notification pass with the resolved main-thread agent.
 * Without that second pass an --agent frontmatter mode is silently forced to
 * default with no notice.
 */
describe('subprocessEnvScrubNotification', () => {
  const prev = process.env[SCRUB_KEY]

  afterEach(() => {
    if (prev === undefined) delete process.env[SCRUB_KEY]
    else process.env[SCRUB_KEY] = prev
  })

  test('returns undefined when scrub is not set', () => {
    delete process.env[SCRUB_KEY]
    expect(
      subprocessEnvScrubNotification({
        permissionModeCli: 'plan',
        dangerouslySkipPermissions: true,
        agentPermissionMode: 'plan',
      }),
    ).toBeUndefined()
  })

  test('agent frontmatter alone is enough to notify', () => {
    process.env[SCRUB_KEY] = '1'
    expect(
      subprocessEnvScrubNotification({
        permissionModeCli: undefined,
        agentPermissionMode: 'acceptEdits',
      }),
    ).toContain('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB')
  })

  test('default agent mode and no flags stay quiet', () => {
    process.env[SCRUB_KEY] = '1'
    expect(
      subprocessEnvScrubNotification({
        permissionModeCli: undefined,
        agentPermissionMode: 'default',
      }),
    ).toBeUndefined()
    expect(
      subprocessEnvScrubNotification({ permissionModeCli: undefined }),
    ).toBeUndefined()
  })

  test('unparseable CLI mode alone does not notify', () => {
    process.env[SCRUB_KEY] = '1'
    expect(
      subprocessEnvScrubNotification({ permissionModeCli: 'nonsense' }),
    ).toBeUndefined()
  })
})
