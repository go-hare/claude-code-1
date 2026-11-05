/**
 * densable hooks-worker.
 *
 * Frames: load / unload / dispatch / dispatch_stream / engine_create / next / ping / build / resolve / call / press.
 * Replies: loaded / load_error / result / error / pong / built / resolved / call_result / press_result.
 * Each plugin is an environmentId. Load carries a MessagePort. A dead worker
 * sets died on the host, which aborts inFlight.
 */
import { type MessagePort, parentPort, workerData } from 'worker_threads'
import type { HopFloor } from './functionHooksHop.js'
import {
  bindHostOpPort,
  callPluginInterface,
  type FunctionHookPlugin,
  finalizeOwnedTable,
  invokePress,
  loadFunctionHooksInProcess,
  recordPress,
  releasePresses,
  retireFunctionHooksModule,
  runEngineCreateLocalInProcess,
  runFunctionHookChain,
  runFunctionHookStreamChain,
  setFunctionHooksHost,
  storeResolvedTables,
  unbindHostOpPort,
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
  origin?: { readonly plugin: string; readonly tier: string }
  hookOrigin?: readonly (
    | string
    | { readonly plugin: string; readonly registration: number }
  )[]
  floors?: readonly HopFloor[]
}
type NextResult = {
  type: 'next_result'
  id: number
  nextId: number
  value?: unknown
  result?: unknown
}
type NextError = {
  type: 'next_error'
  id: number
  nextId: number
  error?: string
}
type NextStep = {
  type: 'next_step'
  id: number
  nextId: number
  step: { done: boolean; value: unknown }
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
type AbortMessage = { type: 'abort'; id: number; reason?: string }
type DispatchStreamMessage = {
  type: 'dispatch_stream'
  id: number
  event?: string
  payload?: Record<string, unknown>
  environments?: string[]
  only?: string
  hasTail?: boolean
}
type StreamPullMessage = { type: 'stream_pull'; id: number }
type StreamCloseMessage = { type: 'stream_close'; id: number }
type EngineCreateMessage = {
  type: 'engine_create'
  id: number
  payload?: Record<string, unknown>
  environments?: string[]
}

const stamp =
  workerData?.stamp instanceof SharedArrayBuffer
    ? new Int32Array(workerData.stamp)
    : undefined

function bumpStamp(): void {
  if (stamp) Atomics.add(stamp, 0, 1)
}

if (parentPort) {
  const port = parentPort
  setFunctionHooksHost({
    log: (text, level) => port.postMessage({ type: 'log', text, level }),
    hookFailed: report => port.postMessage({ type: 'hook_failed', ...report }),
  })
  const environments = new Map<string, { port?: MessagePort }>()
  const tails = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >()
  const streamTails = new Map<
    string,
    {
      resolve: (step: { done: boolean; value: unknown }) => void
      reject: (err: Error) => void
    }
  >()
  const inFlight = new Map<number, AbortController>()
  const streams = new Map<number, AsyncIterator<unknown>>()
  const pendingOps = new Map<number, AbortController>()

  type Frame =
    | LoadMessage
    | UnloadMessage
    | DispatchMessage
    | NextResult
    | NextError
    | NextStep
    | PingMessage
    | BuildMessage
    | ResolveMessage
    | CallMessage
    | PressMessage
    | PressReleaseMessage
    | FlushMessage
    | OpAbortMessage
    | AbortMessage
    | DispatchStreamMessage
    | StreamPullMessage
    | StreamCloseMessage
    | EngineCreateMessage

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
    if (message.type === 'abort') {
      inFlight
        .get(message.id)
        ?.abort(new Error(message.reason ?? 'hooks dispatch aborted'))
      return
    }
    if (message.type === 'next_result' || message.type === 'next_error') {
      const key = `${message.id}:${message.nextId}`
      const pending = tails.get(key)
      tails.delete(key)
      if (message.type === 'next_error') {
        const err = new Error(message.error ?? 'next_error')
        pending?.reject(err)
        const pendingStream = streamTails.get(key)
        streamTails.delete(key)
        pendingStream?.reject(err)
      } else {
        pending?.resolve(message.result ?? message.value)
      }
      return
    }
    if (message.type === 'next_step') {
      const key = `${message.id}:${message.nextId}`
      const pendingStream = streamTails.get(key)
      streamTails.delete(key)
      pendingStream?.resolve(message.step)
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
        if (message.port) {
          message.port.start()
          bindHostOpPort(message.environmentId, {
            postMessage: value => message.port?.postMessage(value),
            on: (event, listener) => {
              if (event === 'message') message.port?.on('message', listener)
            },
          })
        }
        const loaded = await sameThread(() =>
          loadFunctionHooksInProcess([message.args]),
        )
        environments.set(message.environmentId, { port: message.port })
        port.postMessage({
          type: 'loaded',
          environmentId: message.environmentId,
          registered: loaded.map(mod => ({
            name: mod.name,
            root: mod.root,
            patterns: mod.patterns,
            ...(mod.surfaceModules !== undefined && {
              surfaceModules: mod.surfaceModules,
            }),
            hooks: (mod.hooks ?? []).map(hook => ({
              pattern: hook.pattern,
              matcher: hook.matcher,
            })),
          })),
        })
      } catch (err) {
        unbindHostOpPort(message.environmentId)
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
    if (message.type === 'engine_create') {
      const abort = new AbortController()
      inFlight.set(message.id, abort)
      try {
        const summary = await runEngineCreateLocalInProcess(
          message.payload ?? {},
          message.environments,
        )
        port.postMessage({
          type: 'result',
          id: message.id,
          returned: summary,
        })
      } finally {
        inFlight.delete(message.id)
      }
      return
    }
    if (message.type === 'dispatch_stream') {
      const abort = new AbortController()
      inFlight.set(message.id, abort)
      let nextStreamId = 0
      const hasTail = message.hasTail === true
      const iterator = runFunctionHookStreamChain<unknown, unknown>(
        message.event ?? '',
        message.payload ?? {},
        async function* (event) {
          if (!hasTail) {
            yield event
            return event
          }
          const streamId = ++nextStreamId
          let opened = false
          while (true) {
            const step = await new Promise<{ done: boolean; value: unknown }>(
              (resolve, reject) => {
                streamTails.set(`${message.id}:${streamId}`, {
                  resolve,
                  reject,
                })
                port.postMessage({
                  type: 'next_pull',
                  id: message.id,
                  nextId: streamId,
                  ...(!opened && { open: { argument: event } }),
                })
                opened = true
              },
            )
            if (step.done) return step.value
            yield step.value
          }
        },
        message.only,
        message.environments,
      )
      streams.set(message.id, iterator)
      return
    }
    if (message.type === 'stream_close') {
      const iterator = streams.get(message.id)
      streams.delete(message.id)
      inFlight.delete(message.id)
      await iterator?.return?.(undefined).catch(() => undefined)
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
      try {
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
      } catch (err) {
        streams.delete(message.id)
        inFlight.delete(message.id)
        port.postMessage({
          type: 'error',
          id: message.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
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
        (event, floors) =>
          new Promise((resolve, reject) => {
            const id = ++nextId
            tails.set(`${message.id}:${id}`, { resolve, reject })
            port.postMessage({
              type: 'next',
              id: message.id,
              nextId: id,
              argument: event,
              ...(floors !== undefined && floors.length > 0 && { floors }),
            })
          }),
        message.only,
        message.environments,
        {
          ...(message.origin !== undefined && { origin: message.origin }),
          ...(message.hookOrigin !== undefined && {
            hookOrigin: message.hookOrigin,
          }),
          ...(message.floors !== undefined && { floors: message.floors }),
          signal: abort.signal,
        },
      )
      port.postMessage({ type: 'result', id: message.id, returned: value })
    } finally {
      inFlight.delete(message.id)
    }
  }
}
