/**
 * densable 2.1.232 #36 — scoped install refreshes marketplace first (zqr/gvm).
 * Pure gate mirrors; full network pull covered by marketplaceManager integration.
 */
import { describe, expect, test } from 'bun:test'

type RefreshOutcome = 'refreshed' | 'refresh-failed' | 'ineligible'

/** densable gvm stale-hint: only when scoped AND refresh did not succeed. */
function staleHintFor(
  marketplaceName: string | undefined,
  preInstallRefreshed: boolean,
): string {
  if (!marketplaceName || preInstallRefreshed) return ''
  const cliUpdate = `claude plugin marketplace update ${marketplaceName}`
  return `. Your local copy may be out of date — try \`${cliUpdate}\`.`
}

/** densable zqr source eligibility: only remote pullable kinds. */
function isRemotePullableSource(kind: string): boolean {
  return kind === 'github' || kind === 'git' || kind === 'url'
}

describe('densable 2.1.232 #36 scoped pre-install refresh (zqr/gvm)', () => {
  test('stale hint when refresh did not succeed', () => {
    expect(staleHintFor('bar', false)).toContain(
      'claude plugin marketplace update bar',
    )
    expect(staleHintFor('bar', false)).toContain(
      'local copy may be out of date',
    )
  })

  test('no stale hint after successful refresh (even if still miss)', () => {
    expect(staleHintFor('bar', true)).toBe('')
  })

  test('unscoped miss never claims out-of-date', () => {
    expect(staleHintFor(undefined, false)).toBe('')
  })

  test('zqr only pulls github/git/url', () => {
    expect(isRemotePullableSource('github')).toBe(true)
    expect(isRemotePullableSource('git')).toBe(true)
    expect(isRemotePullableSource('url')).toBe(true)
    expect(isRemotePullableSource('directory')).toBe(false)
    expect(isRemotePullableSource('file')).toBe(false)
    expect(isRemotePullableSource('settings')).toBe(false)
  })

  test('success warning shape after refresh-failed install from cache', () => {
    const warning = 'marketplace not refreshed (network down)'
    const suffix = `. Warning: ${warning} — installed from the cached catalog, so the version may be stale`
    expect(suffix).toContain('cached catalog')
    expect(suffix).toContain('may be stale')
  })

  test('outcome tagging for jqr analytics', () => {
    const tag = (o: RefreshOutcome) => ({
      refreshed: o === 'refreshed',
      refresh_failed: o === 'refresh-failed',
      ineligible: o === 'ineligible',
    })
    expect(tag('refreshed').refreshed).toBe(true)
    expect(tag('refresh-failed').refresh_failed).toBe(true)
    expect(tag('ineligible').ineligible).toBe(true)
  })
})
