/**
 * Official 2.1.207: non-interactive runs must not permanently consent to
 * dangerous remote managed settings without showing the security dialog.
 */
import { describe, expect, test } from 'bun:test'

type SecurityCheckResult =
  | 'approved'
  | 'rejected'
  | 'no_check_needed'
  | 'deferred_non_interactive'

/**
 * Pure mirror of the non-interactive branch of checkManagedSettingsSecurity.
 */
function classifySecurityCheck(opts: {
  hasDangerous: boolean
  changed: boolean
  interactive: boolean
}): SecurityCheckResult {
  if (!opts.hasDangerous) return 'no_check_needed'
  if (!opts.changed) return 'no_check_needed'
  if (!opts.interactive) return 'deferred_non_interactive'
  // Interactive would show the dialog; tests don't cover the UI path.
  return 'approved'
}

function shouldPersistDiskCache(result: SecurityCheckResult): boolean {
  // Official: only persist when user approved or no check was needed.
  return result === 'approved' || result === 'no_check_needed'
}

describe('managed settings non-interactive consent (2.1.207)', () => {
  test('dangerous+changed+non-interactive → deferred_non_interactive', () => {
    expect(
      classifySecurityCheck({
        hasDangerous: true,
        changed: true,
        interactive: false,
      }),
    ).toBe('deferred_non_interactive')
  })

  test('deferred must not persist disk cache as consented', () => {
    expect(shouldPersistDiskCache('deferred_non_interactive')).toBe(false)
    expect(shouldPersistDiskCache('approved')).toBe(true)
    expect(shouldPersistDiskCache('no_check_needed')).toBe(true)
    expect(shouldPersistDiskCache('rejected')).toBe(false)
  })

  test('no dangerous settings still no_check_needed in non-interactive', () => {
    expect(
      classifySecurityCheck({
        hasDangerous: false,
        changed: true,
        interactive: false,
      }),
    ).toBe('no_check_needed')
  })

  test('unchanged dangerous settings still no_check_needed', () => {
    expect(
      classifySecurityCheck({
        hasDangerous: true,
        changed: false,
        interactive: false,
      }),
    ).toBe('no_check_needed')
  })
})
