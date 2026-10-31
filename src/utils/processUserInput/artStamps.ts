/**
 * densable 2.1.289 Art/yn turn stamps (print drain → ask → processUserInput).
 *
 * Gold copies: g_n @191383799, KJe @187336207, pDo @187409293 (no-op without
 * projects XG().source), ELt/KOo @190142413, VXe @185421368, dun @191452427,
 * mzt/rrr/Y9t/$8o/X9t @179514819, e9e @187848724.
 * Never export those minify ids.
 */
import { randomUUID } from 'crypto'

const THREAD_STATE_AGE = /^(\d{1,6}m|\d{1,6}h \d{1,2}m) ago$/

const HOST_INITIATOR_ALLOWLIST = [
  'user',
  'scheduled-task',
  'sleep-auto-resume',
  'quit-auto-resume',
  'remote-restart-auto-resume',
  'ci-monitor',
  'dispatch',
  'side-session-brief',
  'side-session-start',
  'side-session-wake',
  'other',
] as const

const ARTIFACT_COMMENT_TURN_ALLOWLIST = [
  'handoff',
  'handback',
  'seeded',
  'unmarked',
] as const

export type TurnOrigin =
  | 'scheduled'
  | 'human'
  | 'auto_continuation'
  | 'peer'
  | 'task_notification'
  | 'host_synthetic'
  | 'system'
  | 'sdk'
  | 'unknown'

/** densable `hZn` — quote-escape a path for the inlined-image prompt. */
export function quotePathForInlinedImage(path: string): string {
  return path.replaceAll('"', '&quot;')
}

/** densable `g_n` — model-facing copy for inlined_image_paths. */
export function formatInlinedImagePathsPrompt(paths: string[]): string {
  const listed = paths
    .map(path => `"${quotePathForInlinedImage(path)}"`)
    .join(' ')
  return paths.length === 1
    ? `The attached image is also saved at ${listed}. Use this file path only if a task needs the image file itself (for example, copying it into a file you are creating) — the image is already visible to you, so do not read the file just to view it.`
    : `The ${paths.length} attached images, in display order, are also saved at ${listed}. Use these file paths only if a task needs the image files themselves (for example, copying them into a file you are creating) — the images are already visible to you, so do not read the files just to view them.`
}

/** densable `KJe` — model-facing copy for thread_state. */
export function formatThreadStatePrompt(
  sinceUser: unknown,
  repliesSinceUser: unknown,
): string | undefined {
  if (
    typeof sinceUser !== 'string' ||
    !THREAD_STATE_AGE.test(sinceUser) ||
    typeof repliesSinceUser !== 'number' ||
    !Number.isSafeInteger(repliesSinceUser) ||
    repliesSinceUser < 0
  ) {
    return undefined
  }
  const replies =
    repliesSinceUser === 1 ? '1 reply' : `${repliesSinceUser} replies`
  return `Thread state: the user last wrote ${sinceUser}. Claude has sent ${replies} since then.`
}

/**
 * densable `pDo` — projects thread snapshot. Print engine ctor `uDo`s the
 * source; `utt()` still defaults off (`tengu_projects_thread_state_stamp`).
 */
export function snapshotThreadState(
  now = Date.now(),
): { sinceUser: string; repliesSinceUser: number } | undefined {
  const { snapshotProjectsThreadState } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./projectsThreadState.js') as typeof import('./projectsThreadState.js')
  return snapshotProjectsThreadState(now)
}

/** densable `ker` */
export function wakeupSourceTelemetryValue(
  wakeupSource: unknown,
): string | undefined {
  switch (wakeupSource) {
    case 'loop_wakeup':
    case 'schedule_wakeup':
      return wakeupSource
    default:
      return undefined
  }
}

/** densable `dXt` */
export function hostInitiatorTelemetryValue(
  hostInitiator: unknown,
): string | undefined {
  if (hostInitiator === undefined || hostInitiator === '') {
    return undefined
  }
  return HOST_INITIATOR_ALLOWLIST.includes(
    hostInitiator as (typeof HOST_INITIATOR_ALLOWLIST)[number],
  )
    ? (hostInitiator as string)
    : 'other'
}

/** densable `_er` */
function mapHostInitiatorToTurnOrigin(
  hostInitiator: string,
): TurnOrigin | undefined {
  switch (hostInitiator) {
    case 'scheduled-task':
      return 'scheduled'
    case 'sleep-auto-resume':
    case 'quit-auto-resume':
    case 'remote-restart-auto-resume':
    case 'ci-monitor':
      return 'auto_continuation'
    case 'dispatch':
      return 'peer'
    case 'side-session-brief':
    case 'side-session-start':
    case 'side-session-wake':
    case 'other':
      return 'host_synthetic'
    default:
      return undefined
  }
}

/** densable `sVn` */
function hostInitiatorTurnOrigin(
  hostInitiator: unknown,
): TurnOrigin | undefined {
  const mapped = hostInitiatorTelemetryValue(hostInitiator)
  if (mapped === undefined || mapped === 'user') {
    return undefined
  }
  return mapHostInitiatorToTurnOrigin(mapped)
}

/** densable `ELt` — tengu_input_prompt / tengu_input_command extras. */
export function inputPromptStampTelemetry(stamps: {
  wakeupSource?: unknown
  hostInitiator?: unknown
  artifactCommentTurn?: unknown
}): {
  wakeup_source?: string
  host_initiator?: string
  artifact_comment_turn?: string
} {
  const wakeup = wakeupSourceTelemetryValue(stamps.wakeupSource)
  const host = hostInitiatorTelemetryValue(stamps.hostInitiator)
  const artifact = ARTIFACT_COMMENT_TURN_ALLOWLIST.find(
    value => value === stamps.artifactCommentTurn,
  )
  return {
    ...(wakeup && { wakeup_source: wakeup }),
    ...(host && { host_initiator: host }),
    ...(artifact && { artifact_comment_turn: artifact }),
  }
}

/** densable `uw` — origin is typed/human or unset. */
export function originIsTypedOrUnset(
  origin:
    | {
        kind?: string
      }
    | undefined,
): boolean {
  return origin === undefined || origin.kind === 'human'
}

/**
 * densable `e9e`. Gold yn: Fe is undefined when shouldQuery===false && isMeta
 * && queryHeldForNextTurn!==true; else e9e({isNonInteractive, isMeta,
 * callerSource: fe ?? (uw(origin) ? undefined : "system")}).
 */
export function resolvePromptSource(input: {
  isNonInteractive?: boolean
  isMeta?: boolean
  callerSource?: string
}): 'system' | 'sdk' | string {
  if (input.isMeta || input.callerSource === 'system') {
    return 'system'
  }
  if (input.isNonInteractive) {
    return 'sdk'
  }
  return input.callerSource ?? 'typed'
}

export type QueuedIdentityStamps = {
  verifiedSlackHumanTurn?: boolean
  projectsUserTurn?: boolean
  hearthRelayMessageIds?: unknown
  hearthRelayRows?: unknown
  hearthRelayThreadTs?: unknown
}

/** densable `mzt` — copy only the identity stamps gold rrr writes. */
export function pickQueuedIdentityStamps(
  stamps: QueuedIdentityStamps,
): QueuedIdentityStamps {
  const picked: QueuedIdentityStamps = {}
  if (stamps.verifiedSlackHumanTurn === true) {
    picked.verifiedSlackHumanTurn = true
  }
  if (stamps.projectsUserTurn === true) {
    picked.projectsUserTurn = true
  }
  if (stamps.hearthRelayMessageIds !== undefined) {
    picked.hearthRelayMessageIds = stamps.hearthRelayMessageIds
  }
  if (stamps.hearthRelayRows !== undefined) {
    picked.hearthRelayRows = stamps.hearthRelayRows
  }
  if (stamps.hearthRelayThreadTs !== undefined) {
    picked.hearthRelayThreadTs = stamps.hearthRelayThreadTs
  }
  return picked
}

/** densable `rrr` — Object.assign identity stamps onto the matching user uuid. */
export function assignQueuedIdentityStamps(
  messages: Array<{ type: string; uuid?: string }>,
  uuid: string,
  stamps: QueuedIdentityStamps,
): void {
  const picked = pickQueuedIdentityStamps(stamps)
  for (const message of messages) {
    if (message.type === 'user' && message.uuid === uuid) {
      Object.assign(message, picked)
    }
  }
}

/** densable `Y9t` */
export function stampVerifiedSlackHumanTurn(
  messages: Array<{ type: string; uuid?: string }>,
  uuid: string,
  extra: { projectsUserTurn?: boolean } = {},
): void {
  assignQueuedIdentityStamps(messages, uuid, {
    verifiedSlackHumanTurn: true,
    ...(extra.projectsUserTurn ? { projectsUserTurn: true } : {}),
  })
}

/** densable `$8o` */
export function stampHearthRelay(
  messages: Array<{ type: string; uuid?: string }>,
  uuid: string,
  relay: {
    messageIds?: unknown
    rows?: unknown
    threadTs?: unknown
  },
): void {
  assignQueuedIdentityStamps(messages, uuid, {
    hearthRelayMessageIds: relay.messageIds,
    hearthRelayRows: relay.rows,
    hearthRelayThreadTs: relay.threadTs,
  })
}

/** densable `ks` */
export function hasHearthRelayStamps(stamps: {
  hearthRelayMessageIds?: unknown
  hearthRelayRows?: unknown
  hearthRelayThreadTs?: unknown
}): boolean {
  return (
    stamps.hearthRelayMessageIds !== undefined ||
    stamps.hearthRelayRows !== undefined ||
    stamps.hearthRelayThreadTs !== undefined
  )
}

/** densable `X9t` — keep uuid, else generate when Slack/hearth stamps need one. */
export function resolveQueuedMessageUuid(
  uuid: string | undefined,
  needsGenerated: boolean,
): string | undefined {
  return uuid || (needsGenerated ? randomUUID() : undefined)
}

/** densable `KOo` — promptSource is gold Fe from e9e. */
export function resolveTurnOrigin(stamps: {
  origin?: { kind?: string; subkind?: string }
  isMeta?: boolean
  wakeupSource?: unknown
  promptSource?: string
  hostInitiator?: unknown
}): TurnOrigin {
  if (stamps.wakeupSource !== undefined) {
    return 'scheduled'
  }
  const fromHost = hostInitiatorTurnOrigin(stamps.hostInitiator)
  switch (stamps.origin?.kind) {
    case 'human':
      return fromHost ?? 'human'
    case 'auto-continuation':
      return 'auto_continuation'
    case 'task-notification':
      if (stamps.origin.subkind === 'scheduled-trigger') {
        return 'scheduled'
      }
      if (
        stamps.origin.subkind === 'peer-send-message' ||
        stamps.origin.subkind === 'projects-relay'
      ) {
        return 'peer'
      }
      return 'task_notification'
    case 'peer':
    case 'channel':
    case 'coordinator':
    case 'observer':
    case 'observer-activity':
    case 'slack-ping':
      return 'peer'
    case 'unclassified':
      return 'host_synthetic'
    case 'plugin':
      return 'system'
    case undefined:
      break
  }
  if (stamps.isMeta) {
    return 'system'
  }
  if (fromHost !== undefined) {
    return fromHost
  }
  if (stamps.promptSource === 'sdk') {
    return 'sdk'
  }
  return 'unknown'
}

/**
 * densable `VXe` — declared poll-event rows, or undefined when none declared.
 */
export function pollEventDeclaredFromCommands(
  commands: ReadonlyArray<{
    pollEvent?: { kind?: string; declared?: unknown }
  }>,
): unknown[] | undefined {
  if (!commands.some(command => command.pollEvent?.declared !== undefined)) {
    return undefined
  }
  return commands.map(command =>
    command.pollEvent?.declared === undefined
      ? null
      : { kind: command.pollEvent.kind, ...command.pollEvent.declared },
  )
}

/** densable `dun` — stamp queueSkipAttachments on every user message. */
export function stampQueueSkipAttachments(
  messages: Array<{ type: string }>,
): void {
  for (const message of messages) {
    if (message.type === 'user') {
      ;(message as { queueSkipAttachments?: boolean }).queueSkipAttachments =
        true
    }
  }
}
