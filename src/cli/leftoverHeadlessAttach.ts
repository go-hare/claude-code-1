/**
 * densable 2.1.283 leftover `Yo` compositor BODY.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 *   leftover `Yo` @202433401 BODY 5407 B next `function An(`
 *
 * Wraps leftoverHeadlessCopy / leftoverCloudCopy / attachDirSync /
 * cloudSession / serveIdentity hosts. Gold `U=H.ok||(local&&no_device_proof)`
 * CALLs `isLocalServeLinkAllowed` — do not invent a proof store.
 * NEVER `export function Yo`. Keep existing minify hosts:
 *   pushCreatePermissionMode / startAttachSync /
 *   logRemoteHeadlessClientWorkerInitialize /
 *   leftover qo serve-only /
 *   `[headlessCloud] attach preflight failed (continuing via the stream)`
 * leftover tn `[headlessCloudClient] attach preflight failed:` is ADDITIVE.
 */
import { errorMessage, TeleportOperationError } from 'src/utils/errors.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { startAttachSync } from './attachDirSync.js'
import {
  formatCloudSessionId,
  logRemoteHeadlessFeatureBad,
} from './cloudSession.js'
import {
  ATTACH_DIR_SYNC_ELSEWHERE_UNKNOWN,
  attachDirSyncElsewhereUnknownReason,
} from './leftoverCloudCopy.js'
import { logHeadlessAttachPreflightFailed } from './leftoverHeadlessCopy.js'
import { eTn } from './deviceBind.js'
import { isLocalServeLinkAllowed } from './serveIdentity.js'
import type { ServeIdentityFail, ServeIdentityOk } from './serveIdentity.js'

export {
  applyHeadlessOpeningRequests,
  filterSupportedDialogKindsForInitialize,
  headlessWorkerInitializeReason,
  initializeHeadlessCloudWorker,
  isRetryableWorkerInitializePost,
  noteHeadlessUndeclaredDialog,
} from './leftoverHeadlessWorker.js'

export type HeadlessAttachDirSyncLookup = {
  handle?: unknown
  why?: string
  line?: string
  kind?: string
}

export type HeadlessAttachOpened = {
  kind: 'opened'
  sessionId: string
  initialSequenceNum: number
  workerAwaitsAnswer?: boolean
  notices?: Array<{ level: string; text: string }>
  dirSync?: unknown
  controlOnly?: boolean
  stillLinkedHere?: boolean
  eventSigner?: unknown
}

export type HeadlessAttachFailed = {
  kind: 'failed'
  message: string
  reason: string
}

export type HeadlessAttachResult = HeadlessAttachOpened | HeadlessAttachFailed

export type HeadlessAttachSeams = {
  fetchSession?: (sessionId: string) => Promise<{
    session_status?: string
    bound_device_uuid?: string
    created_at?: string
    session_context?: { sources?: unknown }
  }>
  localServeLinkIdentity?: (opts: {
    sessionId: string
    credentials?: unknown
  }) => Promise<ServeIdentityOk | ServeIdentityFail>
  linkForServing?: (opts: {
    sessionId: string
    localIdentity?: ServeIdentityOk
  }) => Promise<
    | {
        ok: true
        deviceId?: string
        heldKey?: {
          accountUuid: string
          rowPk: string
          key: import('./deviceBind.js').DeviceBindKey
        }
      }
    | { ok: false; message: string }
  >
  linkPreparationOverlapOn?: () => boolean
  prepareLink?: (opts: unknown) => Promise<unknown>
  hostedServeDialogsGateOn?: () => boolean | Promise<boolean>
  askDeviceMcpConsent?: (opts: unknown) => Promise<unknown>
  resolveBinding?: (opts: unknown) => Promise<{
    status: 'bound' | 'unbound'
    deviceId?: string
  }>
  attachDirSync?: (
    sessionId: string,
    boundToThisMachine: boolean | Promise<boolean>,
  ) => Promise<HeadlessAttachDirSyncLookup>
  startAttachSync?: typeof startAttachSync
  registerDevice?: (opts: unknown) => { stop: () => void }
  settingsToCloudEnabled?: () => Promise<boolean>
  remoteFileMode?: (gitRoot?: string) => Promise<string | undefined>
  readStreamPosition?: (
    sessionId: string,
    opts?: { recoverDeviceProof?: boolean },
  ) => Promise<number>
  formatCloudSessionId?: (sessionId: string) => string
  logRemoteHeadlessFeatureBad?: (
    errorCode: string,
    extra?: Record<string, string>,
  ) => void
  attachHeadlessFeatures?: (opts: unknown) => Promise<unknown>
}

function logRemoteHeadlessFeatureOk(): void {
  logEvent('tengu_feature_ok', {
    feature_name:
      'remote_headless_session' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/** gold `an` clip used by leftover `Yo` stream-stands / refused. */
function clipAttachError(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}

export function attachStreamStandsFailedCopy(
  sessionId: string,
  error: string,
  formatId: (id: string) => string = formatCloudSessionId,
): string {
  return `Error: could not read where cloud session ${formatId(sessionId)}'s stream stands (${clipAttachError(error, 200)}).`
}

/**
 * leftover `Yo` @202433401 BODY wrap.
 * Gold `U=H.ok||(local&&no_device_proof)` CALLs serveIdentity.
 */
export async function attachHeadlessCloudSession(
  args: {
    sessionId: string
    apiCreds?: { orgUUID?: string }
    host?: {
      initialize?: unknown
      dialogs?: unknown
      signal?: AbortSignal
    }
    features?: unknown[]
    storageV5?: unknown
    credentials?: unknown
    sessionHost?: unknown
    openingRequests?: unknown[]
    serveOnly?: boolean
  },
  seams: HeadlessAttachSeams = {},
): Promise<HeadlessAttachResult> {
  const sessionId = args.sessionId
  const serveOnly = args.serveOnly === true
  const featureBad =
    seams.logRemoteHeadlessFeatureBad ?? logRemoteHeadlessFeatureBad
  const formatId = seams.formatCloudSessionId ?? formatCloudSessionId
  logEvent('tengu_remote_attach_session', {
    session_id:
      sessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    entry_point:
      'cloud_headless' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  const fetchSession = seams.fetchSession
  const fetched = fetchSession
    ? await fetchSession(sessionId).then(
        session => ({ session }),
        (error: unknown) => ({ error }),
      )
    : { error: new Error('unreadable') }

  let preflight:
    | { archived: boolean; awaitsAnswer: boolean; unreadable: boolean }
    | { refused: string }
  if ('session' in fetched) {
    preflight = {
      archived: fetched.session.session_status === 'archived',
      awaitsAnswer: fetched.session.session_status === 'requires_action',
      unreadable: false,
    }
  } else if (fetched.error instanceof TeleportOperationError) {
    preflight = {
      refused: fetched.error.formattedMessage || errorMessage(fetched.error),
    }
  } else {
    // KEEP existing minify host string — leftover unique is ADDITIVE.
    logForDebugging(
      `[headlessCloud] attach preflight failed (continuing via the stream): ${errorMessage(fetched.error)}`,
    )
    logHeadlessAttachPreflightFailed(fetched.error)
    preflight = { archived: false, awaitsAnswer: false, unreadable: true }
  }

  if ('refused' in preflight) {
    await featureBad('attach_refused')
    return {
      kind: 'failed',
      reason: 'attach_refused',
      message: `Error: ${clipAttachError(preflight.refused ?? '', 300)}`,
    }
  }
  if (preflight.archived) {
    logEvent('tengu_remote_attach_session_rejected', {
      reason:
        'archived' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      entry_point:
        'cloud_headless' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    await featureBad('attach_archived')
    return {
      kind: 'failed',
      reason: 'attach_archived',
      message: `Error: cloud session ${sessionId} is archived and cannot accept new messages.`,
    }
  }

  let localOk: ServeIdentityOk | undefined
  /** gold leftover `Yo` `U=H.ok||(local&&no_device_proof)` — CALL serveIdentity. */
  let recoverDeviceProof = false
  if (serveOnly) {
    const ident = await (
      seams.localServeLinkIdentity ??
      (async () =>
        ({
          ok: false,
          refusal: { kind: 'local', reason: 'no_device_proof' },
          message: '',
        }) as ServeIdentityFail)
    )({ sessionId, credentials: args.credentials })
    recoverDeviceProof = isLocalServeLinkAllowed(ident)
    localOk = ident.ok ? ident : undefined
  }

  let position: number
  try {
    position = await (seams.readStreamPosition ?? (async () => 0))(sessionId, {
      recoverDeviceProof,
    })
  } catch (error) {
    await featureBad('attach_stream_position')
    return {
      kind: 'failed',
      reason: 'attach_stream_position',
      message: attachStreamStandsFailedCopy(
        sessionId,
        errorMessage(error),
        formatId,
      ),
    }
  }

  if (
    localOk !== undefined &&
    seams.prepareLink !== undefined &&
    (seams.linkPreparationOverlapOn ?? (() => false))()
  ) {
    void seams
      .prepareLink({
        sessionId,
        credentials: args.credentials,
        localIdentity: localOk,
        handsKeyToLaterReaders: true,
      })
      .catch(() => {})
  }

  let linkedDeviceId: string | undefined
  let heldKey:
    | {
        accountUuid: string
        rowPk: string
        key: import('./deviceBind.js').DeviceBindKey
      }
    | undefined
  if (serveOnly) {
    const linked = await (
      seams.linkForServing ?? (async () => ({ ok: true as const }))
    )({
      sessionId,
      ...(localOk && { localIdentity: localOk }),
    })
    if (!linked.ok) {
      await featureBad('attach_serve_link')
      return {
        kind: 'failed',
        reason: 'attach_serve_link',
        message: linked.message,
      }
    }
    linkedDeviceId = linked.deviceId
    heldKey = linked.heldKey
  }

  const hosted =
    serveOnly &&
    (await Promise.resolve(
      (seams.hostedServeDialogsGateOn ?? (async () => false))(),
    ).catch(() => false))
  if (hosted) {
    void (seams.askDeviceMcpConsent ?? (async () => ({ kind: 'settled' })))({
      dialogs: args.host?.dialogs,
      storageV5: args.storageV5,
      signal: args.host?.signal,
    }).catch(() => {})
  }

  const binding = (
    seams.resolveBinding ?? (async () => ({ status: 'unbound' as const }))
  )({
    sessionId,
    storageV5: args.storageV5,
    session:
      linkedDeviceId !== undefined
        ? Promise.resolve({ archived: false, boundDeviceId: linkedDeviceId })
        : undefined,
  })
  const dirSync = await (
    seams.attachDirSync ??
    (async () => ({ handle: undefined, why: 'not_looked' }))
  )(
    sessionId,
    binding.then(b => b.status === 'bound'),
  )
  const registration = (seams.registerDevice ?? (() => ({ stop: () => {} })))({
    sessionId,
    binding,
    dirSync: dirSync.handle !== undefined,
  })
  void registration

  const [bound, settingsToCloud] = await Promise.all([
    binding,
    (seams.settingsToCloudEnabled ?? (async () => false))().catch(() => false),
  ])
  void settingsToCloud
  let eventSigner: unknown
  if (bound.status === 'bound' && bound.deviceId) {
    eventSigner = await eTn(bound.deviceId, args.credentials, heldKey).catch(
      () => undefined,
    )
  }

  let attachSyncHandle: unknown
  if (
    serveOnly &&
    args.sessionHost !== undefined &&
    dirSync.handle === undefined &&
    dirSync.why === 'not_armed_here' &&
    hosted
  ) {
    attachSyncHandle = await (seams.startAttachSync ?? startAttachSync)({
      sessionId,
      boundToThisMachine: bound.status === 'bound',
      dialogs: args.host?.dialogs as never,
      storageV5: args.storageV5,
      credentials: args.credentials,
      sessionHost: args.sessionHost,
      signal: args.host?.signal,
    })
  }

  if (preflight.unreadable) {
    featureBad('attach_session_unreadable')
  } else if (dirSync.handle === undefined && dirSync.why === 'lookup_failed') {
    featureBad('attach_dir_sync_lookup_failed')
  } else if (
    dirSync.handle === undefined &&
    attachDirSyncElsewhereUnknownReason(dirSync) ===
      ATTACH_DIR_SYNC_ELSEWHERE_UNKNOWN
  ) {
    // gold leftover `Yo` `p("remote_headless_session","attach_dir_sync_elsewhere_unknown")`
    featureBad('attach_dir_sync_elsewhere_unknown')
  } else {
    logRemoteHeadlessFeatureOk()
  }

  if (seams.attachHeadlessFeatures) {
    await seams.attachHeadlessFeatures({
      sessionId,
      trigger: 'attach',
      dirSync: dirSync.handle,
      features: args.features ?? [],
    })
  }
  void (seams.remoteFileMode ?? (async () => undefined))(
    (dirSync.handle as { gitRoot?: string } | undefined)?.gitRoot,
  )

  return {
    kind: 'opened',
    sessionId,
    initialSequenceNum: position,
    ...(preflight.awaitsAnswer && { workerAwaitsAnswer: true }),
    ...(serveOnly && { controlOnly: true }),
    ...(linkedDeviceId !== undefined && { stillLinkedHere: true }),
    ...(dirSync.handle === undefined &&
      dirSync.why === 'elsewhere' &&
      dirSync.line !== undefined && {
        notices: [{ level: 'warning', text: dirSync.line }],
      }),
    dirSync: dirSync.handle ?? attachSyncHandle,
    ...(eventSigner !== undefined && { eventSigner }),
  }
}
