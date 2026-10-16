/**
 * densable 2.1.289 Rzo / TZt account-boundary wipe subset.
 * Gold: accountEpoch++, accountBoundaryAt, probeBoots.clear on non-same_account.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  noteArtifactAccountChanged,
  resetArtifactAutoReactStoreForTests,
  un,
} from '../index.js'
import { rememberProbeBoot } from '../ownership.js'
import {
  provenanceState,
  resetProvenanceStateForTests,
} from '../readPerm/provenance.js'

const SLUG = '11111111-1111-1111-1111-111111111111'

afterEach(() => {
  resetProvenanceStateForTests()
  resetArtifactAutoReactStoreForTests()
})

function seedProbeBoot(): void {
  rememberProbeBoot(
    SLUG,
    {
      err: null,
      data: { mode: 'owner', lean: false },
      ver: 'v7',
      assetToken: 'tok',
    },
    { toolUseId: 'tu-boundary', issuedAt: Date.now() },
  )
}

describe('noteArtifactAccountChanged (densable Rzo subset)', () => {
  test('signed_out bumps epoch, stamps boundary, clears probeBoots', () => {
    seedProbeBoot()
    expect(un().shareStatus.probeBoots.has(SLUG)).toBe(true)
    const epochBefore = un().accountEpoch
    const before = Date.now()

    noteArtifactAccountChanged('signed_out')

    expect(un().accountEpoch).toBe(epochBefore + 1)
    expect(un().shareStatus.probeBoots.size).toBe(0)
    const at = provenanceState().accountBoundaryAt
    expect(at).toBeDefined()
    expect(at!).toBeGreaterThanOrEqual(before)
  })

  test('account_switch also wipes; same_account is a no-op', () => {
    seedProbeBoot()
    const epoch0 = un().accountEpoch
    noteArtifactAccountChanged('same_account')
    expect(un().accountEpoch).toBe(epoch0)
    expect(un().shareStatus.probeBoots.has(SLUG)).toBe(true)
    expect(provenanceState().accountBoundaryAt).toBeUndefined()

    noteArtifactAccountChanged('account_switch')
    expect(un().accountEpoch).toBe(epoch0 + 1)
    expect(un().shareStatus.probeBoots.size).toBe(0)
    expect(provenanceState().accountBoundaryAt).toBeDefined()
  })

  test('Rzo bySlug scrub drops role / probeErrorCode identity fields', () => {
    un().shareStatus.bySlug.set(SLUG, {
      mode: 'org',
      isSharedLive: true,
      role: 'reader',
      probeErrorCode: 'boot_failed',
      cowritten: true,
    })
    noteArtifactAccountChanged('signed_out')
    const row = un().shareStatus.bySlug.get(SLUG)
    expect(row).toBeDefined()
    expect(row?.mode).toBe('org')
    expect(row?.isSharedLive).toBe(true)
    expect(row?.cowritten).toBe(true)
    expect(row?.role).toBeUndefined()
    expect(row?.probeErrorCode).toBeUndefined()
  })
})
