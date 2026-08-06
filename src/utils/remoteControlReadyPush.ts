/**
 * densable 2.1.214 #31 — RC "session ready" push must not fire without
 * explicit Remote Control.
 *
 * densable:
 *   nZp()  — GB tengu_kairos_push_notifications (I0e) + tengu_kairos_ready_nudge
 *   oZp(cfg, explicitRC, outboundOnlyOrReattach)
 *          — reject !explicit / outbound|reattach / isBg / agentId / impression cap
 *   iZp(cfg) — increment remoteControlReadyPush* + tips_rc_ready_push_send
 *   bzu(msg, sessionId) — meta assistant tool_use PushNotification
 *   YQp — ready copy
 *
 * Connected path (useReplBridge):
 *   if (handle && !sentRef && !userActivityRef) {
 *     cfg = nZp(); if (cfg && oZp(cfg, explicit, reattach)) {
 *       sentRef=true
 *       if (prob pass) writeSdkMessages([bzu(YQp, sessionId)]); iZp(cfg)
 *     }
 *   }
 */

import { randomUUID } from 'crypto'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import { EMPTY_USAGE } from '../services/api/emptyUsage.js'
import { logEvent } from '../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  getGlobalConfig,
  saveGlobalConfig,
  type GlobalConfig,
} from './config.js'
import { isBgSession } from './concurrentSessions.js'
import { getAgentId } from './teammate.js'

/** densable YQp */
export const REMOTE_CONTROL_READY_PUSH_MESSAGE =
  'Your Claude Code session is ready — continue from your phone anytime.'

/** densable Hty */
export const READY_PUSH_TOOL_NAME = 'PushNotification'

/** densable J0 for synthetic SDK assistant messages */
export const READY_PUSH_SYNTHETIC_MODEL = '<synthetic>'

export type ReadyNudgeConfig = {
  probability: number
  maxImpressions: number
  impressionKey: string
}

/**
 * densable nZp body after I0e gate — pure parse of tengu_kairos_ready_nudge.
 */
export function parseKairosReadyNudge(
  raw: unknown,
  pushNotificationsEnabled: boolean,
): ReadyNudgeConfig | null {
  // densable: if (!I0e()) return null
  if (!pushNotificationsEnabled) return null
  // densable: if (e===!0) return {probability:1,maxImpressions:5,impressionKey:""}
  if (raw === true) {
    return { probability: 1, maxImpressions: 5, impressionKey: '' }
  }
  // densable: if (e===null||typeof e!=="object") return null
  if (raw === null || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const probability =
    typeof e.probability === 'number' && Number.isFinite(e.probability)
      ? Math.min(1, Math.max(0, e.probability))
      : 1
  const maxImpressions =
    typeof e.maxImpressions === 'number' && Number.isFinite(e.maxImpressions)
      ? Math.trunc(e.maxImpressions)
      : 5
  const impressionKey =
    typeof e.impressionKey === 'string' ? e.impressionKey : ''
  return { probability, maxImpressions, impressionKey }
}

/**
 * densable nZp() — live GB read.
 */
export function loadRemoteControlReadyNudgeConfig(): ReadyNudgeConfig | null {
  const pushOn = getFeatureValue_CACHED_MAY_BE_STALE<boolean>(
    'tengu_kairos_push_notifications',
    false,
  )
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_kairos_ready_nudge',
    null,
  )
  return parseKairosReadyNudge(raw, pushOn === true)
}

export type ReadyPushGateInput = {
  explicitRemoteControl: boolean
  /** densable third arg: outboundOnly path already short-circuits; reattach uses this. */
  outboundOnlyOrReattach: boolean
  isBg: boolean
  agentId: string | null | undefined
  remoteControlReadyPushKey: string | undefined
  remoteControlReadyPushCount: number | undefined
}

/**
 * densable oZp(e,t,r).
 */
export function shouldSendRemoteControlReadyPush(
  cfg: ReadyNudgeConfig,
  input: ReadyPushGateInput,
): boolean {
  // densable: if (!t || r) return !1
  if (!input.explicitRemoteControl || input.outboundOnlyOrReattach) {
    return false
  }
  // densable: if (ts() || L$()!=null) return !1  — isBg / agentId
  if (input.isBg || input.agentId != null) {
    return false
  }
  // densable: if (e.maxImpressions===0) return !1
  if (cfg.maxImpressions === 0) return false
  // densable: if (e.maxImpressions<0) return !0  — unlimited
  if (cfg.maxImpressions < 0) return true
  const count =
    (input.remoteControlReadyPushKey ?? '') === cfg.impressionKey
      ? (input.remoteControlReadyPushCount ?? 0)
      : 0
  return count < cfg.maxImpressions
}

/**
 * densable: vt.probability>=1 || Math.random()<vt.probability
 */
export function shouldEmitReadyPushByProbability(
  probability: number,
  random: number,
): boolean {
  return probability >= 1 || random < probability
}

/**
 * densable iZp impression update (pure). Returns null when unlimited (maxImpressions < 0)
 * so caller skips config write — densable only pr() when maxImpressions >= 0.
 */
export function nextReadyPushImpressionState(
  cfg: ReadyNudgeConfig,
  current: Pick<
    GlobalConfig,
    'remoteControlReadyPushKey' | 'remoteControlReadyPushCount'
  >,
): {
  remoteControlReadyPushKey: string
  remoteControlReadyPushCount: number
} | null {
  if (cfg.maxImpressions < 0) return null
  const sameKey =
    (current.remoteControlReadyPushKey ?? '') === cfg.impressionKey
  return {
    remoteControlReadyPushKey: cfg.impressionKey,
    remoteControlReadyPushCount: sameKey
      ? (current.remoteControlReadyPushCount ?? 0) + 1
      : 1,
  }
}

/**
 * densable iZp — persist counter + tips_rc_ready_push_send.
 */
export function recordRemoteControlReadyPushSent(cfg: ReadyNudgeConfig): void {
  const next = nextReadyPushImpressionState(cfg, getGlobalConfig())
  if (next) {
    saveGlobalConfig(t => {
      const again = nextReadyPushImpressionState(cfg, t)
      if (!again) return t
      return { ...t, ...again }
    })
  }
  logEvent('tips_rc_ready_push_send', {})
}

/**
 * Live oZp with process-local bg/agent + GlobalConfig counters.
 */
export function shouldSendRemoteControlReadyPushLive(
  cfg: ReadyNudgeConfig,
  explicitRemoteControl: boolean,
  outboundOnlyOrReattach: boolean,
): boolean {
  const g = getGlobalConfig()
  return shouldSendRemoteControlReadyPush(cfg, {
    explicitRemoteControl,
    outboundOnlyOrReattach,
    isBg: isBgSession(),
    agentId: getAgentId(),
    remoteControlReadyPushKey: g.remoteControlReadyPushKey,
    remoteControlReadyPushCount: g.remoteControlReadyPushCount,
  })
}

/**
 * densable bzu(e,t) — synthetic meta assistant PushNotification tool_use.
 * Wire input is densable {message, status:"proactive"} (not local title/body schema).
 */
export function createReadyPushSdkMessage(
  message: string,
  sessionId: string,
): SDKMessage {
  return {
    type: 'assistant',
    message: {
      id: randomUUID(),
      container: null,
      model: READY_PUSH_SYNTHETIC_MODEL,
      role: 'assistant',
      stop_details: null,
      stop_reason: 'tool_use',
      stop_sequence: null,
      type: 'message',
      usage: { ...EMPTY_USAGE },
      content: [
        {
          type: 'tool_use',
          id: randomUUID(),
          name: READY_PUSH_TOOL_NAME,
          input: { message, status: 'proactive' },
        },
      ],
      context_management: null,
    },
    parent_tool_use_id: null,
    is_meta: true,
    session_id: sessionId,
    uuid: randomUUID(),
  } as SDKMessage
}
