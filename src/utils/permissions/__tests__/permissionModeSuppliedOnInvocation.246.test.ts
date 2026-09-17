/**
 * densable 2.1.246 #40 — official `Ko` `d = Boolean(r||a||i)`.
 * Scrub early-return pins `modeSuppliedOnInvocation: true`.
 */
import { afterEach, describe, expect, test } from 'bun:test'

import { permissionModeSuppliedOnInvocationFromKo } from '../permissionSetup.js'

const SCRUB_KEY = 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB'

describe('permissionModeSuppliedOnInvocationFromKo', () => {
  const prev = process.env[SCRUB_KEY]

  afterEach(() => {
    if (prev === undefined) delete process.env[SCRUB_KEY]
    else process.env[SCRUB_KEY] = prev
  })

  test('skip-only → true', () => {
    delete process.env[SCRUB_KEY]
    expect(
      permissionModeSuppliedOnInvocationFromKo({
        permissionModeCli: undefined,
        dangerouslySkipPermissions: true,
      }),
    ).toBe(true)
  })

  test('neither → false', () => {
    delete process.env[SCRUB_KEY]
    expect(
      permissionModeSuppliedOnInvocationFromKo({
        permissionModeCli: undefined,
      }),
    ).toBe(false)
  })

  test('CLI permission mode → true', () => {
    delete process.env[SCRUB_KEY]
    expect(
      permissionModeSuppliedOnInvocationFromKo({
        permissionModeCli: 'plan',
      }),
    ).toBe(true)
  })

  test('agent frontmatter → true', () => {
    delete process.env[SCRUB_KEY]
    expect(
      permissionModeSuppliedOnInvocationFromKo({
        permissionModeCli: undefined,
        agentPermissionMode: 'plan',
      }),
    ).toBe(true)
  })

  test('scrub → true even with no flags', () => {
    process.env[SCRUB_KEY] = '1'
    expect(
      permissionModeSuppliedOnInvocationFromKo({
        permissionModeCli: undefined,
      }),
    ).toBe(true)
  })
})
