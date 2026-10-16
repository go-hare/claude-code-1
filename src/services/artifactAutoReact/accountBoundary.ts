/**
 * densable Rzo / TZt account-boundary subset for tip (2.1.289).
 * Semantic export only — invent-ban `export function Rzo`.
 *
 * Gold Rzo(e!=="same_account") bumps accountEpoch, stamps
 * shareStatus.accountBoundaryAt, and clears probeBoots (plus richer wipes tip
 * may not host). Tip stamps provenance accountBoundaryAt via
 * noteShareAccountBoundary.
 */
import { noteShareAccountBoundary } from './readPerm/provenance.js'
import { un } from './store.js'

export type ArtifactAccountChangeReason =
  | 'signed_out'
  | 'same_account'
  | 'account_switch'

/**
 * densable Rzo bySlug identity scrub — drop fields that name the prior
 * account's probe/role relation. Tip only strips fields it actually stores
 * (no invent of endpointConnectors bags).
 */
function scrubShareStatusIdentityFields(): void {
  const { bySlug } = un().shareStatus
  for (const [slug, row] of bySlug) {
    if (
      row.probeErrorCode === undefined &&
      row.role === undefined &&
      Reflect.get(row, 'outsideOrgReader') === undefined &&
      Reflect.get(row, 'external') === undefined &&
      Reflect.get(row, 'probeGone') === undefined
    ) {
      continue
    }
    const { probeErrorCode: _pe, role: _role, ...rest } = row
    const next = { ...rest } as typeof row
    Reflect.deleteProperty(next, 'outsideOrgReader')
    Reflect.deleteProperty(next, 'external')
    Reflect.deleteProperty(next, 'probeGone')
    bySlug.set(slug, next)
  }
}

/**
 * densable Rzo portable — call on logout / oauth accountUuid|orgUuid change.
 * `same_account` is a no-op for the tip wipe subset (gold still runs lighter
 * Zzr work tip does not host).
 */
export function noteArtifactAccountChanged(
  reason: ArtifactAccountChangeReason = 'signed_out',
): void {
  if (reason === 'same_account') return
  un().accountEpoch++
  noteShareAccountBoundary()
  scrubShareStatusIdentityFields()
}
