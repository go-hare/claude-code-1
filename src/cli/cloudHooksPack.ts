/**
 * densable 2.1.283 leftover gold `ke` @202311651 + `Ot` @202308188
 * + leftover `CWt` @202277705 + leftover `zn` @202310643 + leftover `Wn` @202309915.
 *
 * Semantic exports; minify names stay in comments.
 * No hook fleet compositor. Accepted path wraps leftover `RWt`
 * (`createBoundCreatePack`). No settings.set / amati / soundpost / WS.
 * leftover `Jrn` standing-idle compositor is not unique here — idle copy only.
 */
import { getPlatform } from 'src/utils/platform.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { isViolinWoodEnabled } from './violinWood.js'

type BoundCreatePack = {
  sender: {
    unregister: (reason?: string) => void
    servingMute: (muted: boolean) => void
  }
  servingMuted: boolean
}

type CreateBoundCreatePack = (opts: {
  launchDir: string
  cloudSessionId?: string
  storageV5?: unknown
  syncRoot?: unknown
}) => BoundCreatePack

/** gold `Gn` */
export const HOOKS_FORWARD_UNDECIDED_COPY =
  'Hooks from this machine are not used in cloud sessions yet: run /hooks in claude on this machine to decide.'

/** gold leftover `jn.dormant` @202310271 */
export const HOOKS_FORWARD_IDLE_COPY =
  'Hooks from this machine are idle for this cloud session: nothing has used it for a while, so their registration was allowed to lapse; it is made again when the session is next used.'

/** gold leftover `jn.not_registered` @202310271 */
export const HOOKS_FORWARD_NOT_REGISTERED_COPY =
  'Hooks from this machine are not registered with this cloud session yet: it has not answered (it may be asleep); they are registered when it is next used.'

const HOOKS_FORWARD_IDLE_BY_REASON = {
  dormant: HOOKS_FORWARD_IDLE_COPY,
  not_registered: HOOKS_FORWARD_NOT_REGISTERED_COPY,
} as const

export type HooksIdleReason = keyof typeof HOOKS_FORWARD_IDLE_BY_REASON

export type HooksFeatureOff = {
  feature: 'hooks'
  report: () => {
    state: 'off'
    reason: string
    source?: string
    message?: string
  }
}

export type HooksFeatureForwarded = {
  feature: 'hooks'
  report: () => {
    state: 'forwarded'
    source: string
    pending?: true
  }
  dispose?: () => Promise<void> | void
}

export type CloudHooksConsentPin =
  | 'accepted'
  | 'declined'
  | 'aborted'
  | 'unreadable'
  | 'unset'

export type CloudHooksAttachContext = {
  trigger?: string
  bound?: boolean
  sessionId?: string
  storageV5?: unknown
  dirSync?: { sync: { state: () => { state: string } }; gitRoot?: string }
}

export type CloudHooksPackSeams = {
  enabled?: () => boolean | Promise<boolean>
  readConsentPin?: () => Promise<CloudHooksConsentPin>
  createPack?: CreateBoundCreatePack
  launchDir?: () => string
}

export type CloudHooksForwardingSeams = {
  platform?: () => string
  violinWood?: () => boolean | Promise<boolean>
}

/** leftover `zn` snapshot (`phase` / `lastOutcome` / `stoppedReason`). */
export type HooksOutcomeSnapshot = {
  phase: string
  lastOutcome: string | null
  stoppedReason?: string
}

/** leftover `zn` standing (`n.kind`). */
export type HooksStanding = {
  kind: string
}

export type CloudHooksStandingReport =
  | { state: 'off'; reason: string; source?: string; message?: string }
  | {
      state: 'idle'
      source: 'stored'
      reason: HooksIdleReason
      message: string
    }
  | { state: 'forwarded'; source: 'stored'; message?: string }

function verified(
  value: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * leftover `CWt` @202277705 —
 * `H()!=="windows"&&es()&&bzn()&&!a.CLAUDE_CODE_DISABLE_HOOK_FORWARDING`.
 * `es`/`bzn` map to existing violin-wood (no amati flag).
 */
export async function isCloudHooksForwardingEnabled(
  seams: CloudHooksForwardingSeams = {},
): Promise<boolean> {
  const platform = (seams.platform ?? getPlatform)()
  const wood = await (seams.violinWood ?? isViolinWoodEnabled)()
  return (
    platform !== 'windows' &&
    wood &&
    !process.env.CLAUDE_CODE_DISABLE_HOOK_FORWARDING
  )
}

/**
 * leftover `zn` @202310643 — lastOutcome → ke-style off reason.
 * Unique case `consent_distrusted`. No consent store.
 */
export function hooksOffReasonFromStanding(
  snapshot: HooksOutcomeSnapshot,
  standing: HooksStanding,
): string | null {
  if (snapshot.phase === 'stopped') return snapshot.stoppedReason ?? 'stopped'
  switch (snapshot.lastOutcome) {
    case 'no_consent':
    case 'consent_distrusted':
    case 'disabled':
    case 'unsupported':
    case 'invalid':
    case 'nothing_to_offer':
      return snapshot.lastOutcome
    case 'muted':
      return snapshot.phase === 'registering' ? null : 'muted'
    case 'unregistered':
      return standing.kind === 'kept_none' ? 'kept_none' : 'nothing_to_offer'
    case 'not_ready':
    case 'stale_epoch':
      return standing.kind === 'paused' && snapshot.phase !== 'registering'
        ? 'paused'
        : null
    case 'failed':
      if (
        snapshot.phase === 'registering' ||
        snapshot.phase === 'registered' ||
        standing.kind === 'dormant'
      ) {
        return null
      }
      return standing.kind === 'paused' ? 'paused' : 'failed'
    case null:
    case 'registered':
    case 'superseded':
    case 'dormant':
      return null
  }
  return null
}

/**
 * leftover `Wn` @202309915 — off via zn, else idle copy, else forwarded.
 * `Jrn` standing-idle compositor is not landed; pass `idleReason` when known.
 * gold idle is `state:"idle"` (not ke). consent_distrusted is ke-shaped off.
 */
export function reportCloudHooksFromStanding(
  snapshot: HooksOutcomeSnapshot,
  standing: HooksStanding,
  line?: { line?: string; warning?: string },
  idleReason?: HooksIdleReason | null,
): CloudHooksStandingReport {
  const reason = hooksOffReasonFromStanding(snapshot, standing)
  if (reason !== null) {
    const message = line?.warning ?? line?.line
    return {
      state: 'off',
      reason,
      ...(reason === 'declined' && { source: 'stored' }),
      ...(message !== undefined && { message }),
    }
  }
  if (idleReason === 'dormant' || idleReason === 'not_registered') {
    return {
      state: 'idle',
      source: 'stored',
      reason: idleReason,
      message: HOOKS_FORWARD_IDLE_BY_REASON[idleReason],
    }
  }
  return {
    state: 'forwarded',
    source: 'stored',
    ...(line?.line !== undefined && { message: line.line }),
  }
}

/**
 * gold `ke` @202311651 — tengu_device_hooks_headless_off.
 * `no_consent` includes Gn. consent_distrusted is an off reason (zn), no Gn.
 */
export function hooksFeatureOff(
  reason: string,
  reattach: boolean,
  source?: string,
): HooksFeatureOff {
  logEvent('tengu_device_hooks_headless_off', {
    reason: verified(reason),
    reattach,
  })
  return {
    feature: 'hooks',
    report: () => ({
      state: 'off',
      reason,
      ...(source && { source }),
      ...(reason === 'no_consent' && { message: HOOKS_FORWARD_UNDECIDED_COPY }),
    }),
  }
}

/**
 * gold `Ot` @202308188 — factory. Default enabled leftover `CWt`
 * (`isCloudHooksForwardingEnabled`). No consent store: seam `readConsentPin`.
 */
export function createCloudHooksPack(
  seams: CloudHooksPackSeams = {},
): (
  ctx: CloudHooksAttachContext,
) => Promise<HooksFeatureOff | HooksFeatureForwarded | undefined> {
  const enabled = seams.enabled ?? isCloudHooksForwardingEnabled
  return async ctx => {
    if (!(await enabled())) return
    const reattach = ctx.trigger === 'attach'
    if (!ctx.bound) return hooksFeatureOff('not_bound', reattach)
    const pin = await (
      seams.readConsentPin ?? (async () => 'unreadable' as const)
    )()
    switch (pin) {
      case 'declined':
        return hooksFeatureOff('declined', reattach, 'stored')
      case 'aborted':
        return hooksFeatureOff('detached', reattach)
      case 'unreadable':
        logEvent('tengu_feature_bad', {
          feature_name: verified('device_hooks_client_register'),
          error_code: verified('consent_unreadable'),
        })
        return hooksFeatureOff('unreadable', reattach)
      case 'unset':
        return hooksFeatureOff('no_consent', reattach, 'default')
      case 'accepted':
        break
    }
    const createPack =
      seams.createPack ??
      (await import('./leftoverUnique.js')).createBoundCreatePack
    const pack = createPack({
      launchDir: (seams.launchDir ?? (() => process.cwd()))(),
      cloudSessionId: ctx.sessionId,
      storageV5: ctx.storageV5,
      syncRoot: () => {
        const x = ctx.dirSync
        if (!x) return null
        const { state: z } = x.sync.state()
        return z === 'armed' || z === 'seeding' ? x.gitRoot : null
      },
    })
    void pack
    return {
      feature: 'hooks',
      report: () => ({
        state: 'forwarded',
        source: 'stored',
        pending: true,
      }),
    }
  }
}
