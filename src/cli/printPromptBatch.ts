/**
 * densable 2.1.289 print drain Ph / $c / LP / Uf / BP / kh / PCr / xD / S0o / T8r / uTo.
 * Semantic names only — never export minify Ph|$c|LP|Uf|BP|kh|PCr|xD|S0o|T8r|uTo.
 */
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { MessageOrigin } from '../types/message.js'
import type { QueuedCommand } from '../types/textInputTypes.js'
import { isMainThreadQueuedCommand } from '../bootstrap/state.js'

const ARTIFACT_COMMENT_SENT = '[Artifact comment sent to Claude]'
const ARTIFACT_COMMENTS_SENT = '[Artifact comments sent to Claude]'
/** densable `u` — last-N linked traces on $c. */
const LINKED_TRACE_CAP = 8

export type QueuedPromptValue = string | ContentBlockParam[]

type QueuedCommandBatchExtras = QueuedCommand & {
  drainOnly?: boolean
  resumedTurnUserMessageUuid?: string
  seededSummon?: boolean
  hearthRelayRows?: unknown
  hearthRelayThreadTs?: unknown
  hearthRelayMessageIds?: unknown
  inlinedImagePaths?: unknown[]
  taskDelivery?: unknown
  hostInitiator?: unknown
  localStdinOrigin?: boolean
  sessionChannelPersonTyped?: boolean
  projectsUserTurn?: boolean
  fileAttachments?: unknown[]
  ccrTurnId?: unknown
  traceContext?: { traceparent: string }
  linkedTraceContexts?: Array<{ traceparent: string }>
  turnAttributionKey?: unknown
  frameTiming?: unknown
  stampThreadState?: boolean
  attachmentSourceUuid?: unknown
  deliveryId?: unknown
}

function toBlocks(value: QueuedPromptValue): ContentBlockParam[] {
  return typeof value === 'string' ? [{ type: 'text', text: value }] : value
}

/** densable `LP` — joinPromptValues. */
export function joinPromptValues(
  values: QueuedPromptValue[],
): QueuedPromptValue {
  if (values.length === 1) return values[0]!
  if (values.every(v => typeof v === 'string')) {
    return values.join('\n')
  }
  return values.flatMap(toBlocks)
}

/** densable `tp` for print Uf — main thread. */
export function isPrintMainThreadCommand(cmd: QueuedCommand): boolean {
  return isMainThreadQueuedCommand(cmd)
}

/** densable `Uf` — `tp(e)&&e.passive!==true`. */
export function isPrintQueueableCommand(cmd: QueuedCommand): boolean {
  return isPrintMainThreadCommand(cmd) && cmd.passive !== true
}

function lastTextOfPromptValue(value: QueuedCommand['value']): string | null {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return null
  const last = value.at(-1)
  if (
    last &&
    typeof last === 'object' &&
    last.type === 'text' &&
    typeof last.text === 'string'
  ) {
    return last.text
  }
  return null
}

/** densable `PCr` — artifact-comment envelopes are not batchable. */
function isArtifactCommentPromptValue(value: QueuedCommand['value']): boolean {
  const text = lastTextOfPromptValue(value)
  return (
    text !== null &&
    (text.startsWith(ARTIFACT_COMMENT_SENT) ||
      text.startsWith(ARTIFACT_COMMENTS_SENT))
  )
}

/** densable `xD` — slash-looking values. */
function isSlashLookingPromptValue(value: QueuedCommand['value']): boolean {
  if (typeof value === 'string') return value.trim().startsWith('/')
  if (!Array.isArray(value)) return false
  const last = value.at(-1)
  return (
    last?.type === 'text' &&
    typeof last.text === 'string' &&
    last.text.trim().startsWith('/')
  )
}

function hostInitiatorKey(value: unknown): unknown {
  if (value === undefined || value === 'user') return undefined
  return value
}

/** densable `BP` — origin equality for Ph. */
export function originsBatchEqual(
  a: MessageOrigin | undefined,
  b: MessageOrigin | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'slack-ping' && b.kind === 'slack-ping') {
    return (
      a.channelId === b.channelId &&
      a.threadTs === b.threadTs &&
      a.messageTs === b.messageTs &&
      a.slackUserId === b.slackUserId &&
      a.senderDisplay === b.senderDisplay &&
      a.permalink === b.permalink
    )
  }
  if (a.kind === 'peer' && b.kind === 'peer') {
    return (
      a.from === b.from &&
      a.inbound_origin === b.inbound_origin &&
      a.senderTaskId === b.senderTaskId &&
      a.verifiedPeerPid === b.verifiedPeerPid &&
      a.activityObservation === b.activityObservation
    )
  }
  if (a.kind === 'channel' && b.kind === 'channel') {
    return a.server === b.server
  }
  if (a.kind === 'plugin' && b.kind === 'plugin') {
    return a.name === b.name && a.asUser === b.asUser
  }
  if (a.kind === 'task-notification' && b.kind === 'task-notification') {
    return a.subkind === b.subkind && a.fireReason === b.fireReason
  }
  return true
}

/** densable `kh` — drain-only resume companion is not batchable. */
function isDrainOnlyResumeCompanion(cmd: QueuedCommand): boolean {
  const extras = cmd as QueuedCommandBatchExtras
  return (
    extras.drainOnly === true && extras.resumedTurnUserMessageUuid !== undefined
  )
}

function mergeTraceContexts(batch: QueuedCommandBatchExtras[]): {
  parent: { traceparent: string } | undefined
  linked: Array<{ traceparent: string }>
} {
  const parent = batch.findLast(cmd => cmd.traceContext)?.traceContext
  if (!parent) return { parent: undefined, linked: [] }
  const seen = new Set([parent.traceparent])
  const linked: Array<{ traceparent: string }> = []
  for (const cmd of batch) {
    const ctx = cmd.traceContext
    if (ctx && !seen.has(ctx.traceparent)) {
      seen.add(ctx.traceparent)
      linked.push(ctx)
    }
  }
  return { parent, linked: linked.slice(-LINKED_TRACE_CAP) }
}

function mergedCcrTurnId(batch: QueuedCommandBatchExtras[]): unknown {
  const first = batch[0]?.ccrTurnId
  return batch.every(cmd => cmd.ccrTurnId === first) ? first : undefined
}

function lastTurnAttributionKey(batch: QueuedCommandBatchExtras[]): unknown {
  return batch.findLast(cmd => cmd.turnAttributionKey !== undefined)
    ?.turnAttributionKey
}

/**
 * densable `Ph` — whether `next` can follow `head` in one print ask().
 */
export function canBatchWith(
  head: QueuedCommand,
  next: QueuedCommand | undefined,
): boolean {
  if (next === undefined) return false
  const a = head as QueuedCommandBatchExtras
  const b = next as QueuedCommandBatchExtras
  return (
    b.mode === 'prompt' &&
    b.workload === a.workload &&
    b.isMeta === a.isMeta &&
    b.shouldQuery === a.shouldQuery &&
    b.wakeupSource === a.wakeupSource &&
    originsBatchEqual(a.origin, b.origin) &&
    !!b.verifiedSlackHumanTurn === !!a.verifiedSlackHumanTurn &&
    !!b.projectsUserTurn === !!a.projectsUserTurn &&
    !!b.localStdinOrigin === !!a.localStdinOrigin &&
    !!b.sessionChannelPersonTyped === !!a.sessionChannelPersonTyped &&
    hostInitiatorKey(b.hostInitiator) === hostInitiatorKey(a.hostInitiator) &&
    !!b.skipAttachments === !!a.skipAttachments &&
    !!b.skipSlashCommands === !!a.skipSlashCommands &&
    !isDrainOnlyResumeCompanion(a) &&
    !isDrainOnlyResumeCompanion(b) &&
    a.seededSummon !== true &&
    b.seededSummon !== true &&
    !isArtifactCommentPromptValue(a.value) &&
    !isArtifactCommentPromptValue(b.value) &&
    a.hearthRelayRows === undefined &&
    b.hearthRelayRows === undefined &&
    a.hearthRelayThreadTs === undefined &&
    b.hearthRelayThreadTs === undefined &&
    a.hearthRelayMessageIds === undefined &&
    b.hearthRelayMessageIds === undefined &&
    b.priority === a.priority &&
    !a.inlinedImagePaths?.length &&
    !b.inlinedImagePaths?.length &&
    !a.taskDelivery &&
    !b.taskDelivery &&
    !isSlashLookingPromptValue(a.value) &&
    !isSlashLookingPromptValue(b.value)
  )
}

/**
 * densable `$c` — merge a prompt batch into one command.
 */
export function mergeQueuedPromptCommands(
  batch: QueuedCommand[],
): QueuedCommand {
  const first = batch[0]!
  if (batch.length === 1) return first
  const extras = batch as QueuedCommandBatchExtras[]
  const traces = mergeTraceContexts(extras)
  const lastWithUuid = extras.findLast(cmd => cmd.uuid) ?? first
  const merged: QueuedCommandBatchExtras = {
    ...first,
    value: joinPromptValues(batch.map(cmd => cmd.value)),
    uuid: lastWithUuid.uuid,
    frameTiming: lastWithUuid.frameTiming,
    turnAttributionKey: lastTurnAttributionKey(extras),
    traceContext: traces.parent,
    linkedTraceContexts: traces.linked,
    attachmentSourceUuid: undefined,
    deliveryId: undefined,
    fileAttachments: extras.flatMap(cmd => cmd.fileAttachments ?? []),
    clientPlatform:
      extras.find(cmd => cmd.clientPlatform)?.clientPlatform ??
      first.clientPlatform,
    ccrTurnId: mergedCcrTurnId(extras),
    ...(extras.some(cmd => cmd.stampThreadState) && { stampThreadState: true }),
  }
  return merged
}
