/**
 * densable Ire / bcn — plugin `$.ui.log`.
 * Debug line always. A registered sink (the REPL) appends a notice;
 * otherwise the line waits in pendingUiLog (cap 100).
 */
import { logForDebugging } from '../debug.js'
import { getBootstrapSessionHost } from '../sessionHost.js'

export type PluginUiLog = { plugin: string; text: string }
export type PluginUiLogDelivery = 'again' | 'once'

type PluginUiLogSink = (
  entry: PluginUiLog,
  delivery: PluginUiLogDelivery,
) => void

type PluginUiLogState = {
  pending: PluginUiLog[]
  sink: PluginUiLogSink | null
}

const PENDING_CAP = 100

const stateByHost = new WeakMap<object, PluginUiLogState>()

function getState(): PluginUiLogState {
  const host = getBootstrapSessionHost()
  let state = stateByHost.get(host)
  if (!state) {
    state = { pending: [], sink: null }
    stateByHost.set(host, state)
  }
  return state
}

export function recordPluginUiLog(
  plugin: string,
  text: string,
  delivery: PluginUiLogDelivery = 'again',
): void {
  logForDebugging(`[${plugin}] $.ui.log: ${text}`)
  const entry = { plugin, text }
  const state = getState()
  if (state.sink) {
    state.sink(entry, delivery)
    return
  }
  if (state.pending.length < PENDING_CAP) {
    state.pending = [...state.pending, entry]
  }
}

/** densable `_So` — `$.ui.log(text, { to: 'debug' })`. */
export function recordPluginUiLogDebug(plugin: string, text: string): void {
  logForDebugging(`[${plugin}] $.ui.log (to debug): ${text}`)
}

/** densable bcn — install the sink and flush queued lines as "again". */
export function subscribePluginUiLog(next: PluginUiLogSink): () => void {
  const state = getState()
  state.sink = next
  const queued = state.pending
  state.pending = []
  for (const entry of queued) next(entry, 'again')
  return () => {
    if (state.sink === next) state.sink = null
  }
}
