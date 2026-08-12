/**
 * densable YXd / JXd — non-interactive + no-consent-surface branches.
 * Pure mirror of checkManagedSettingsSecurity control flow (no Ink UI).
 */
import { describe, expect, test } from 'bun:test'

type SecurityCheckResult =
  | 'approved'
  | 'rejected'
  | 'no_check_needed'
  | 'deferred_non_interactive'
  | 'deferred_no_consent_surface'

/**
 * Pure mirror of densable YXd early branches of checkManagedSettingsSecurity.
 */
function classifySecurityCheck(opts: {
  hasDangerous: boolean
  changed: boolean
  interactive: boolean
  showSecurityDialog?: boolean
}): SecurityCheckResult {
  if (!opts.hasDangerous) return 'no_check_needed'
  if (!opts.changed) return 'no_check_needed'
  if (!opts.interactive) return 'deferred_non_interactive'
  // densable: r === void 0 → deferred_no_consent_surface
  if (
    opts.showSecurityDialog === undefined ||
    opts.showSecurityDialog === false
  ) {
    // treat missing surface as undefined
    if (opts.showSecurityDialog === undefined) {
      return 'deferred_no_consent_surface'
    }
  }
  // Interactive with surface would show the dialog; tests don't cover the UI path.
  return 'approved'
}

function shouldPersistDiskCache(result: SecurityCheckResult): boolean {
  // Official: only persist when user approved or no check was needed.
  return result === 'approved' || result === 'no_check_needed'
}

/** densable JXd */
function handleSecurityCheckResultMirror(result: SecurityCheckResult): boolean {
  if (result === 'rejected') return false
  if (result === 'deferred_no_consent_surface') return false
  return true
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
    expect(shouldPersistDiskCache('deferred_no_consent_surface')).toBe(false)
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

describe('densable 2.1.224 YXd deferred_no_consent_surface', () => {
  test('interactive + dangerous + changed + no dialog surface → deferred_no_consent_surface', () => {
    expect(
      classifySecurityCheck({
        hasDangerous: true,
        changed: true,
        interactive: true,
        // showSecurityDialog omitted
      }),
    ).toBe('deferred_no_consent_surface')
  })

  test('interactive + surface present → approved (dialog path)', () => {
    expect(
      classifySecurityCheck({
        hasDangerous: true,
        changed: true,
        interactive: true,
        showSecurityDialog: true,
      }),
    ).toBe('approved')
  })

  test('JXd: deferred_no_consent_surface stops apply (false)', () => {
    expect(handleSecurityCheckResultMirror('deferred_no_consent_surface')).toBe(
      false,
    )
    expect(handleSecurityCheckResultMirror('deferred_non_interactive')).toBe(
      true,
    )
    expect(handleSecurityCheckResultMirror('approved')).toBe(true)
    expect(handleSecurityCheckResultMirror('rejected')).toBe(false)
  })
})
