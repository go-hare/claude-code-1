/**
 * densable sJ / Wwt — in-session plugin activity ring (not persisted).
 * Used by plugin feedback survey / tips to know which plugins were exercised
 * since the last poll, without waiting for pluginUsage flush.
 *
 * For hook/mcp triggers, densable de-dupes: same name+marketplace+trigger is
 * recorded only once per ring lifetime (until drained).
 */
import { logForDebugging } from '../debug.js'
import { parsePluginIdentifier } from './pluginIdentifier.js'

export type PluginActivityTrigger =
  | 'command'
  | 'skill'
  | 'subagent'
  | 'mcp'
  | 'hook'
  | 'lsp'

export type PluginActivityEntry = {
  name: string
  marketplace: string | undefined
  trigger: PluginActivityTrigger
  ts: number
}

/** densable kzc */
const ACTIVITY_RING_MAX = 64

let ring: PluginActivityEntry[] = []

/**
 * densable sJ: push plugin activity. For hook/mcp, skip if same name+marketplace
 * +trigger already present in the ring.
 */
export function recordPluginActivity(
  pluginId: string,
  trigger: PluginActivityTrigger,
): void {
  const { name, marketplace } = parsePluginIdentifier(pluginId)
  if (
    (trigger === 'hook' || trigger === 'mcp') &&
    ring.some(
      e =>
        e.trigger === trigger &&
        e.name === name &&
        e.marketplace === marketplace,
    )
  ) {
    return
  }
  ring.push({ name, marketplace, trigger, ts: Date.now() })
  if (ring.length > ACTIVITY_RING_MAX) {
    ring = ring.slice(-ACTIVITY_RING_MAX)
  }
  logForDebugging(`pluginActivity: recorded ${trigger} for ${name}`, {
    level: 'verbose',
  })
}

/**
 * densable Wwt: drain entries newer than `sinceTs` and clear the ring.
 * Returns drained entries (may be empty).
 */
export function drainPluginActivity(sinceTs: number): PluginActivityEntry[] {
  const out = ring.filter(e => e.ts > sinceTs)
  ring = []
  return out
}

/** Test/helper: clear ring without returning. */
export function clearPluginActivity(): void {
  ring = []
}

/** Test/helper: snapshot current ring (does not drain). */
export function peekPluginActivity(): readonly PluginActivityEntry[] {
  return ring
}
