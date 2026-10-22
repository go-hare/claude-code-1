/**
 * densable Ire / bcn — plugin `$.ui.log`.
 * Debug line always. A registered sink (the REPL) appends a notice;
 * otherwise the line waits in pendingUiLog (cap 100).
 */
import { logForDebugging } from '../debug.js'

export type PluginUiLog = { plugin: string; text: string }
export type PluginUiLogDelivery = 'again' | 'once'

const PENDING_CAP = 100

let pending: PluginUiLog[] = []
let sink: ((entry: PluginUiLog, delivery: PluginUiLogDelivery) => void) | null =
  null

export function recordPluginUiLog(
  plugin: string,
  text: string,
  delivery: PluginUiLogDelivery = 'again',
): void {
  logForDebugging(`[${plugin}] $.ui.log: ${text}`)
  const entry = { plugin, text }
  if (sink) {
    sink(entry, delivery)
    return
  }
  if (pending.length < PENDING_CAP) pending = [...pending, entry]
}

/** densable `_So` — `$.ui.log(text, { to: 'debug' })`. */
export function recordPluginUiLogDebug(plugin: string, text: string): void {
  logForDebugging(`[${plugin}] $.ui.log (to debug): ${text}`)
}

/** densable bcn — install the sink and flush queued lines as "again". */
export function subscribePluginUiLog(
  next: (entry: PluginUiLog, delivery: PluginUiLogDelivery) => void,
): () => void {
  sink = next
  const queued = pending
  pending = []
  for (const entry of queued) next(entry, 'again')
  return () => {
    if (sink === next) sink = null
  }
}
