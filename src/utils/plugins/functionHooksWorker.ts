/**
 * densable hooks-worker.
 *
 * Frames: load / unload / dispatch / next / ping / build / resolve / call / press.
 * Replies: loaded / load_error / result / error / pong / built / resolved / call_result / press_result.
 * Each plugin is an environmentId. Load carries a MessagePort. A dead worker
 * sets died on the host, which aborts inFlight.
 */
import { parentPort, workerData, type MessagePort } from 'worker_threads'
import {
  bindHostOpPort,
  callPluginInterface,
  finalizeOwnedTable,
  handleHostOp,
  invokePress,
  loadFunctionHooksInProcess,
  recordPress,
  releasePresses,
  retireFunctionHooksModule,
  runFunctionHookChain,
  setFunctionHooksHost,
  setOwnedTable,
  storeResolvedTables,
  unbindHostOpPort,
  type FunctionHookPlugin,
} from './functionHooksModules.js'

type LoadMessage = {
  type: 'load'
  environmentId: string
  args: FunctionHookPlugin
  port?: MessagePort
}
type UnloadMessage = {
  type: 'unload'
  environmentId: string
}
type DispatchMessage = {
  type: 'dispatch'
  id: number
  event: string
  payload: Record<string, unknown>
  environments: string[]
  /** densable u8e `{only}` — owning plugin alone (N1t / dO). */
  only?: string
}
type NextResult = {
  type: 'next_result'
  id: number
  nextId: number
  value?: unknown
  result?: unknown
}
type PingMessage = { type: 'ping'; n: number }
type BuildMessage = {
  type: 'build'
  environmentId: string
  table?: unknown
  suppressed?: unknown
}
type ResolveMessage = {
  type: 'resolve'
  resolveId: number
  environmentId: string
  requests?: unknown
}
type CallMessage = {
  type: 'call'
  callId: number
  environmentId: string
  call?: { name?: string; method?: string; args?: unknown[] }
  callers?: unknown
}
type PressMessage = {
  type: 'press'
  pressId: number
  environmentId: string
  handle?: unknown
  e?: unknown
}
type PressReleaseMessage = {
  type: 'press_release'
  environmentId: string
  handles?: unknown[]
}
type FlushMessage = { type: 'flush'; flushId: number }
type OpAbortMessage = { type: 'op_abort'; opId: number; reason?: string }
type DispatchStreamMessage = {
  type: 'dispatch_stream'
  id: number
  event?: string
  payload?: Record<string, unknown>
}
type StreamPullMessage = { type: 'stream_pull'; id: number }

const stamp =
  workerData?.stamp instanceof SharedArrayBuffer
    ? new Int32Array(workerData.stamp)
    : undefined

function bumpStamp(): void {
  if (stamp) Atomics.add(stamp, 0, 1)
}

function isTable(
  value: unknown,
): value is Record<string, Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

if (parentPort) {
  const port = parentPort
  setFunctionHooksHost({
    log: (text, level) => port.postMessage({ type: 'log', text, level }),
    hookFailed: report =>
      port.postMessage({ type: 'hook_failed', ...report }),
  })
  const environments = new Map<string, { port?: MessagePort }>()
  const tails = new Map<string, (value: unknown) => void>()
  const inFlight = new Map<number, AbortController>()
  const streams = new Map<number, AsyncIterator<unknown>>()
  const pendingOps = new Map<number, AbortController>()

  type Frame =
    | LoadMessage
    | UnloadMessage
    | DispatchMessage
    | NextResult
    | PingMessage
    | BuildMessage
    | ResolveMessage
    | CallMessage
    | PressMessage
    | PressReleaseMessage
    | FlushMessage
    | OpAbortMessage
    | DispatchStreamMessage
    | StreamPullMessage

  port.on('message', (message: Frame) => {
    bumpStamp()
    if (message.type === 'ping') {
      port.postMessage({ type: 'pong', n: message.n })
      return
    }
    if (message.type === 'flush') {
      port.postMessage({ type: 'flushed', flushId: message.flushId })
      return
    }
    if (message.type === 'op_abort') {
      pendingOps.get(message.opId)?.abort()
      pendingOps.delete(message.opId)
      return
    }
    if (message.type === 'next_result') {
      tails.get(`${message.id}:${message.nextId}`)?.(
        message.result ?? message.value,
      )
      tails.delete(`${message.id}:${message.nextId}`)
      return
    }
    void handle(message).catch((err: unknown) => {
      if ('id' in message && typeof message.id === 'number') {
        port.postMessage({
          type: 'error',
          id: message.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })
  })

  async function sameThread<T>(work: () => Promise<T>): Promise<T> {
    const previous = process.env.CLAUDE_CODE_HOOKS_SAME_THREAD
    process.env.CLAUDE_CODE_HOOKS_SAME_THREAD = '1'
    try {
      return await work()
    } finally {
      if (previous === undefined)
        delete process.env.CLAUDE_CODE_HOOKS_SAME_THREAD
      else process.env.CLAUDE_CODE_HOOKS_SAME_THREAD = previous
    }
  }

  async function handle(message: Frame): Promise<void> {
    if (message.type === 'unload') {
      await sameThread(() => retireFunctionHooksModule(message.environmentId))
      const env = environments.get(message.environmentId)
      env?.port?.close()
      unbindHostOpPort(message.environmentId)
      environments.delete(message.environmentId)
      return
    }
    if (message.type === 'load') {
      try {
        const loaded = await sameThread(() =>
          loadFunctionHooksInProcess([message.args]),
        )
        if (message.port) {
          message.port.start()
          bindHostOpPort(message.environmentId, {
            postMessage: value => message.port?.postMessage(value),
            on: (event, listener) => {
              if (event === 'message') message.port?.on('message', listener)
            },
          })
        }
        environments.set(message.environmentId, { port: message.port })
        port.postMessage({
          type: 'loaded',
          environmentId: message.environmentId,
          registered: loaded.map(mod => ({
            name: mod.name,
            root: mod.root,
            patterns: mod.patterns,
            hooks: (mod.hooks ?? []).map(hook => ({
              pattern: hook.pattern,
              matcher: hook.matcher,
            })),
          })),
        })
      } catch (err) {
        message.port?.close()
        port.postMessage({
          type: 'load_error',
          environmentId: message.environmentId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }
    if (message.type === 'build') {
      try {
        finalizeOwnedTable(
          message.environmentId,
          message.table,
          message.suppressed,
        )
        port.postMessage({
          type: 'built',
          environmentId: message.environmentId,
        })
      } catch (err) {
        port.postMessage({
          type: 'built_error',
          environmentId: message.environmentId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }
    if (message.type === 'resolve') {
      try {
        storeResolvedTables(message.environmentId, message.requests)
        port.postMessage({ type: 'resolved', resolveId: message.resolveId })
      } catch (err) {
        port.postMessage({
          type: 'resolve_error',
          resolveId: message.resolveId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }
    if (message.type === 'call') {
      try {
        const name = message.call?.name
        const method = message.call?.method
        if (typeof name !== 'string' || typeof method !== 'string') {
          throw new Error('call takes { name, method }')
        }
        const args = Array.isArray(message.call?.args) ? message.call.args : []
        const callers = Array.isArray(message.callers) ? message.callers : []
        const value = await callPluginInterface(
          message.environmentId,
          {
            name,
            method,
          },
          args,
          callers,
        )
        port.postMessage({
          type: 'call_result',
          callId: message.callId,
          value,
        })
      } catch (err) {
        port.postMessage({
          type: 'call_error',
          callId: message.callId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }
    if (message.type === 'press') {
      try {
        await invokePress(message.environmentId, message.handle, message.e)
        recordPress(message.environmentId, message.handle, message.e)
        port.postMessage({
          type: 'press_result',
          pressId: message.pressId,
        })
      } catch (err) {
        port.postMessage({
          type: 'press_error',
          pressId: message.pressId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }
    if (message.type === 'press_release') {
      releasePresses(message.environmentId, message.handles ?? [])
      return
    }
    if (message.type === 'dispatch_stream') {
      const abort = new AbortController()
      inFlight.set(message.id, abort)
      const iterator = (async function* () {
        const value = await runFunctionHookChain(
          message.event ?? '',
          message.payload ?? {},
          async event => event,
        )
        yield value
      })()
      streams.set(message.id, iterator)
      return
    }
    if (message.type === 'stream_pull') {
      const iterator = streams.get(message.id)
      if (!iterator) {
        port.postMessage({
          type: 'error',
          id: message.id,
          error: 'no stream is open for this dispatch',
        })
        return
      }
      const step = await iterator.next()
      if (step.done) {
        streams.delete(message.id)
        inFlight.delete(message.id)
      }
      port.postMessage({
        type: 'stream_step',
        id: message.id,
        step: { done: step.done === true, value: step.value },
      })
      return
    }
    if (message.type !== 'dispatch') return
    const abort = new AbortController()
    inFlight.set(message.id, abort)
    let nextId = 0
    try {
      const value = await runFunctionHookChain(
        message.event,
        message.payload,
        event =>
          new Promise(resolve => {
            const id = ++nextId
            tails.set(`${message.id}:${id}`, resolve)
            port.postMessage({
              type: 'next',
              id: message.id,
              nextId: id,
              argument: event,
            })
          }),
        message.only,
        message.environments,
      )
      port.postMessage({ type: 'result', id: message.id, returned: value })
    } finally {
      inFlight.delete(message.id)
    }
  }
}
