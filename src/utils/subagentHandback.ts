/**
 * densable 2.1.289 SubagentHandback (`qw` / `cen` / `Ut` / `u7e` / `fGo` / `v_n`).
 * Env CLAUDE_CODE_SENDMESSAGE_HANDBACK, else GB tengu_lively_waffle default true.
 *
 * Semantic names only — never export minify `Ut|qw|cen|u7e|fGo|uGo|pGo|m7n|p7e|Xcn`.
 */
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'

/** densable `yG` / `bot` — idle-window keepalive is not a live child. */
const IDLE_WINDOW_KEEPALIVE = 'flag:idle-window'

export const LIVELY_WAFFLE_GATE = 'tengu_lively_waffle'
export const PURRING_PINE_GATE = 'tengu_purring_pine'
export const SENDMESSAGE_HANDBACK_ENV = 'CLAUDE_CODE_SENDMESSAGE_HANDBACK'

/** densable `hGo` — bounce meta prefix. */
export const HANDBACK_SEND_ENFORCE_PREFIX = '[handback-send-enforce]'
/** densable `yGo` — max bounces before giving up. */
export const HANDBACK_SEND_ENFORCE_MAX = 3

/**
 * densable u7e — defined env returns raw JS truthiness (`!!e`), not isEnvTruthy.
 * So `"0"` / `"false"` / `"off"` remain enabled; only unset falls through to GB.
 */
export function isSendMessageHandbackEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[SENDMESSAGE_HANDBACK_ENV]
  if (raw !== undefined) return !!raw
  return getFeatureValue_CACHED_MAY_BE_STALE(LIVELY_WAFFLE_GATE, true)
}

/** densable fGo — parent session mode is auto AND u7e. */
export function isHandbackParentAuto(
  parentMode: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parentMode === 'auto' && isSendMessageHandbackEnabled(env)
}

/** densable k("tengu_purring_pine", !0) — endsTurn after a successful report. */
export function isHandbackEndsTurnEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(PURRING_PINE_GATE, true)
}

export type HandbackDeliveryRecord = {
  recipient: string
  flagged?: boolean
  report?: { text: string; warning?: string }
}

const deliveredBySender = new Map<string, HandbackDeliveryRecord>()

/** densable uGo / pGo session contract bag. */
const sessionContracts = new Map<
  string,
  { contract: boolean; flagged: boolean }
>()

/** densable v_n — one report per sender→recipient. */
export function getHandbackDelivery(
  senderTaskId: string,
  recipient: string,
): HandbackDeliveryRecord | undefined {
  const n = deliveredBySender.get(senderTaskId)
  return n?.recipient === recipient ? n : undefined
}

/**
 * densable m7n — record delivery; if a prior same-recipient record was flagged,
 * the merge keeps flagged.
 */
export function recordHandbackDelivery(
  senderTaskId: string,
  recipient: string,
  extra?: { flagged?: boolean },
): HandbackDeliveryRecord {
  const prior = deliveredBySender.get(senderTaskId)
  const next: HandbackDeliveryRecord = {
    recipient,
    ...(extra?.flagged || (prior?.recipient === recipient && prior.flagged)
      ? { flagged: true as const }
      : {}),
  }
  deliveredBySender.set(senderTaskId, next)
  return next
}

/** densable kbe — drop delivery-map row on sender settle. */
export function clearHandbackDelivery(senderTaskId: string): void {
  deliveredBySender.delete(senderTaskId)
}

export function clearHandbackDeliveriesForTests(): void {
  deliveredBySender.clear()
  sessionContracts.clear()
}

/** densable uGo — stamp the MC arm result onto the session contract bag. */
export function setHandbackSessionContract(
  agentId: string,
  contract: boolean,
): void {
  sessionContracts.set(agentId, {
    contract,
    flagged: sessionContracts.get(agentId)?.flagged === true,
  })
}

/** densable pGo — classifier flagged this sender. */
export function flagHandbackSession(agentId: string): void {
  const prior = sessionContracts.get(agentId)
  sessionContracts.set(agentId, {
    contract: prior?.contract === true,
    flagged: true,
  })
}

export function getHandbackSessionContract(
  agentId: string,
): { contract: boolean; flagged: boolean } | undefined {
  return sessionContracts.get(agentId)
}

export type HandbackContractFields = {
  handbackContract?: true
  handbackRecipient?: string
  handbackBounces?: number
  handbackReport?: { text: string; warning?: string }
}

/** densable bGo — stamp contract + recipient on the spawned local_agent task. */
export function buildHandbackContractFields(input: {
  contract: boolean
  registeredRecipient?: string
  callerInbox: string
  resumerInbox: string
  inboxReadable: (id: string) => boolean
}): HandbackContractFields {
  const { registeredRecipient, callerInbox, resumerInbox, inboxReadable } =
    input
  const o =
    registeredRecipient !== undefined && inboxReadable(registeredRecipient)
      ? registeredRecipient
      : registeredRecipient === undefined && inboxReadable(callerInbox)
        ? callerInbox
        : resumerInbox
  return {
    // gold writes `handbackContract:e?!0:void 0` so Sot true can be cleared
    ...(input.contract
      ? { handbackContract: true as const }
      : { handbackContract: undefined }),
    handbackRecipient: input.contract ? o : registeredRecipient,
    handbackBounces: 0,
  }
}

type LocalAgentLike = {
  type?: string
  status?: string
  keepaliveReasons?: Set<string>
  handbackContract?: true
  handbackRecipient?: string
  handbackReport?: { text: string; warning?: string }
  isBackgrounded?: boolean
}

/** densable u9e — running, or completed with any keepalive other than idle-window. */
export function isHandbackInboxAlive(
  task: LocalAgentLike | undefined,
): boolean {
  if (task?.type !== 'local_agent') return false
  if (task.status === 'running') return true
  if (task.status === 'completed') {
    const reasons = task.keepaliveReasons ?? new Set<string>()
    return [...reasons].some(r => r !== IDLE_WINDOW_KEEPALIVE)
  }
  return false
}

/**
 * densable Xcn — main thread OR u9e(task). Used as inboxReadable and as
 * bg-retarget predicate (`backgrounded && !Xcn(recipient) → main`).
 */
export function isHandbackInboxReadable(
  agentId: string,
  getTask: (id: string) => LocalAgentLike | undefined,
  mainId: string,
): boolean {
  if (agentId === mainId) return true
  return isHandbackInboxAlive(getTask(agentId))
}

/**
 * densable p7e — lookup the delivered report for this sender. `undefined` means
 * no contract; `[]` means contract but not yet delivered (bounce candidate).
 */
export function lookupHandbackReport(
  task: LocalAgentLike | undefined,
  senderTaskId: string,
):
  | Array<
      HandbackDeliveryRecord & { report?: { text: string; warning?: string } }
    >
  | undefined {
  if (task?.type !== 'local_agent' || task.handbackContract !== true) {
    return undefined
  }
  const recipient = task.handbackRecipient
  if (recipient === undefined) return undefined
  // densable p7e: v_n map then {…a, report:n.handbackReport}. kbe clears the
  // map on settle — miss is [] even if task.handbackReport is still set.
  const delivered = getHandbackDelivery(senderTaskId, recipient)
  if (delivered === undefined) return []
  return [{ ...delivered, report: task.handbackReport }]
}

export function formatHandbackSendEnforceMessage(): string {
  return `${HANDBACK_SEND_ENFORCE_PREFIX} Your report has not been delivered. Call SubagentHandback({message: <your full report>}) now; the call ends your run.`
}
