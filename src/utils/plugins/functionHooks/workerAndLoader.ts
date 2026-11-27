/**
 * Function hooks submodule: workerAndLoader
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { BUILTIN_MARKETPLACE_NAME } from '../../../plugins/builtinPlugins.js'
import { logForDebugging } from '../../debug.js'
import { setPromptInputStoreValue } from '../../promptInputCursorStore.js'
import {
  disposePluginClients,
  forgetPluginSurfaceModules,
  loadScannedSurfaceModules,
  scanClientModulePaths,
  setClientFaultReporter,
  setClientMessageCancelHandler,
  setClientMessagePostHandler,
  setClientTerminalSize,
  setPluginSurfaceModules,
  type SurfaceModuleScan,
} from '../functionHooksClient.js'
import type { HopFloor } from '../functionHooksHop.js'
import {
  forgetAllPluginRegisteredTools,
  forgetPluginRegisteredTools,
} from '../pluginToolRegistry.js'
import { existsSync, readFileSync } from 'fs'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import vm, { createContext, type SourceTextModule } from 'vm'
import { MessageChannel, Worker, type MessagePort } from 'worker_threads'
import {
  GLOBAL_FRAGMENT_SYMBOL,
  HOOKS_WORKER_OVERRUN_CAP,
  MAX_HOOK_VM_DEPTH,
  MAX_SCAN_SCOPE_DEPTH,
  REGISTER_FILE,
  assertHookValueDepth,
  describeThrown,
  isEventRecord,
  parseFunctionHookPattern,
} from './constants.js'
import {
  bumpFaultRenderFv,
  cancelClientMessage,
  dispatchClientFault,
  enqueueClientMessage,
  resetClientFaultRuns,
  resetClientMessageQueue,
} from './faultRender.js'
import { PRESS_ANSWER_MS } from './heldPressStore.js'
import { fillUnappliedRewriteEffect, noteHookSkipFirst } from './hookChain.js'
import { handleHostOp } from './hostOp.js'
import { notifyPanesListeners } from './panes.js'
import { claudeCodeModule } from './pluginEngine.js'
import {
  clearSessionAuthHandles,
  forgetPluginSessionAuthHandles,
  mergeSettings,
} from './settingsAndEnv.js'
import {
  activeHookOriginAls,
  activeHookServingAls,
  bumpRasterFrames,
  fhState,
  forgetPluginCommands,
  notifyFunctionHooksModulesLoaded,
  reportHeadlessInlineModStderr,
  runtimeBridge,
} from './state.js'
import { themeClearOnUnload } from './theme.js'
import {
  awaitPluginToolSessionUnmount,
  dropPluginAgentDefinitions,
  forgetPluginOwnedMcpServers,
  pluginRegisterRefusedLine,
  runPluginRegister,
} from './toolsAndAgents.js'
import type {
  FunctionHookHandler,
  FunctionHookPlugin,
  FunctionHookTail,
  FunctionHooksWorkerClientLike,
  HookCallOrigin,
  HookOriginEntry,
  HookServingContext,
  LeftoverHooksModule,
  LoadedFunctionHook,
  LoadedFunctionHooksModule,
  PendingJob,
  ScanCall,
  WorkerModule,
  WorkerReply,
} from './types.js'
import { flattenUiResolveChildren } from './uiResolve.js'
import { checkMatcher, uiRenderMatcherNeverRuns } from './uiValidation.js'

export function setLoadedFunctionHooksModules(
  modules: readonly LoadedFunctionHooksModule[],
): string[] {
  fhState().workerOwnsDispatch = false
  fhState().pluginAgents.clear()
  fhState().pluginAgentSpawns.clear()
  fhState().pluginSpawnCallers.clear()
  forgetPluginCommands()
  // densable: nuclear replace must removeMcpServer for every prior Xj key —
  // clearPluginToolRegistryForTests alone leaves orphan MCP mounts (r_o).
  // Fire-and-forget here (sync API); SAME_THREAD load awaits the returned keys.
  // Pending-removal set skips densable r_o until remount.
  const removedKeys = forgetAllPluginRegisteredTools()
  void awaitPluginToolSessionUnmount(removedKeys)
  for (const name of fhState().pluginOwnedMcpServers.keys()) {
    forgetPluginOwnedMcpServers(name)
  }
  fhState().pluginMcpConnections.clear()
  fhState().pluginStore.clear()
  fhState().skipFirstLog.clear()
  fhState().skipPersistOnce.clear()
  fhState().promptBoxText = ''
  fhState().promptBoxCursor = 0
  setPromptInputStoreValue('')
  clearSessionAuthHandles()
  fhState().uiResolvePressCounter = 0
  for (const entry of fhState().clockCallbacks) entry.cancel()
  fhState().clockCallbacks.length = 0
  fhState().configOverlay.clear()
  fhState().settingsOverlay.clear()
  fhState().pluginPanes.length = 0
  fhState().paneOpenIds.clear()
  fhState().shownPaneId = null
  fhState().focusedPaneId = null
  fhState().paneClosing.clear()
  fhState().unplacedPanes.length = 0
  fhState().askedPanes.length = 0
  fhState().paneFocusRequest = null
  fhState().panePlacements = 0
  fhState().askedPanesSeeded = false
  fhState().panesTerminalSize = undefined
  setClientTerminalSize(undefined)
  fhState().ideSites.clear()
  fhState().paneRemountGeneration.clear()
  fhState().pluginInputSeatStore.setState(() => new Map())
  fhState().pluginSelectSeatStore.setState(() => new Map())
  fhState().pluginFieldSeatGenerationStore.setState(() => new Map())
  notifyPanesListeners()
  resetClientFaultRuns()
  resetClientMessageQueue()
  fhState().pluginDrawings.length = 0
  fhState().lastUiRenderPlugin = ''
  fhState().pluginSites.length = 0
  fhState().pluginFocusSites.clear()
  fhState().focusSiteDraws.clear()
  fhState().pressHandlers.clear()
  fhState().clientPressHandlesByPlugin.clear()
  fhState().pluginToastLastAt.clear()
  fhState().resolvedTables.clear()
  fhState().resolvedByKey.clear()
  fhState().finalizedEnvironments.clear()
  fhState().lastInterfaceCallers = []
  fhState().interfaceCallerStack.length = 0
  disposePluginClients()
  forgetPluginSurfaceModules()
  replaceLoadedFunctionHooksModules(modules)
  return removedKeys
}

function replaceLoadedFunctionHooksModules(
  modules: readonly LoadedFunctionHooksModule[],
): void {
  fhState().hookRegistrationEpoch += 1
  fhState().environmentArgs.clear()
  fhState().loadedModules = modules.map(mod => {
    const entry: LoadedFunctionHooksModule = {
      name: mod.name,
      root: mod.root,
      patterns: [...mod.patterns],
      hooks: [...(mod.hooks ?? [])],
      status: mod.status ?? 'live',
      ...(mod.surfaceModules !== undefined && {
        surfaceModules: [...mod.surfaceModules],
      }),
      ...(mod.pluginStorageId !== undefined && {
        pluginStorageId: mod.pluginStorageId,
      }),
      ...(mod.link !== undefined && { link: mod.link }),
      ...(mod.tier !== undefined && { tier: mod.tier }),
      ...(mod.isManaged !== undefined && { isManaged: mod.isManaged }),
      ...(mod.isCore !== undefined && { isCore: mod.isCore }),
      ...(mod.native !== undefined && { native: mod.native }),
      ...(mod.environmentId !== undefined && {
        environmentId: mod.environmentId,
      }),
    }
    if (entry.status !== 'unloaded') {
      fhState().environmentArgs.set(entry.environmentId ?? entry.name, entry)
    }
    return entry
  })
  for (const mod of fhState().loadedModules) {
    setPluginSurfaceModules(mod.name, mod.root, mod.surfaceModules ?? [])
  }
  // densable 2.1.289: load/reload pushes ui_invalidate for ui.render so mounted
  // Pane/AbovePrompt/UserMessage sites re-ask (gold E1e.onInvalidate → Vi).
  bumpFaultRenderFv()
  bumpRasterFrames()
  // densable 2.1.289: Client fail → owning plugin ui.fault only
  setClientFaultReporter(
    fhState().loadedModules.length > 0
      ? report => {
          void dispatchClientFault(report).catch(err => {
            logForDebugging(
              `ui.fault ${report.plugin}/${report.element}: the chain threw (${describeThrown(err)}); no reply`,
              { level: 'warn' },
            )
          })
        }
      : undefined,
  )
  setClientMessagePostHandler(
    fhState().loadedModules.length > 0 ? enqueueClientMessage : undefined,
  )
  setClientMessageCancelHandler(
    fhState().loadedModules.length > 0 ? cancelClientMessage : undefined,
  )
  // densable `dse` — `Azn.get()?.(e)` after a module replace. `yn` owns the
  // callback (`Azn.set`); this hub does not raise session.start itself.
  notifyFunctionHooksModulesLoaded(fhState().loadedModules)
}

export class FunctionHooksWorkerClient
  implements FunctionHooksWorkerClientLike
{
  died: string | undefined
  private readonly worker: Worker
  private nextId = 0
  /** densable `names` — environmentId → plugin. */
  private readonly names = new Map<string, string>()
  /** densable `overruns` — consecutive ignored-signal counts. */
  private readonly overruns = new Map<string, number>()
  private readonly inFlight = new Map<number, PendingJob>()
  private readonly pendingCalls = new Map<
    number,
    { resolve: (reply: WorkerReply) => void; reject: (err: Error) => void }
  >()
  private readonly pendingPresses = new Map<
    number,
    {
      resolve: (reply: WorkerReply) => void
      reject: (err: Error) => void
      timer?: ReturnType<typeof setTimeout>
    }
  >()
  private readonly pendingBuilds = new Map<
    string,
    { resolve: (reply: WorkerReply) => void; reject: (err: Error) => void }
  >()
  private readonly pendingResolves = new Map<
    number,
    { resolve: (reply: WorkerReply) => void; reject: (err: Error) => void }
  >()
  private readonly loads = new Map<
    string,
    { resolve: (reply: WorkerReply) => void; reject: (err: Error) => void }
  >()
  private readonly ports = new Map<string, MessagePort>()
  private callCounter = 0
  private pressCounter = 0
  private resolveCounter = 0
  culpritPlugin?: string

  constructor() {
    const stamp = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    this.worker = new Worker(
      new URL('../functionHooksWorker.ts', import.meta.url),
      { workerData: { stamp } },
    )
    this.worker.on('error', err =>
      this.markDied(err instanceof Error ? err.message : String(err)),
    )
    this.worker.on('exit', code => {
      if (code !== 0) this.markDied(`hooks worker exited ${code}`)
    })
    this.worker.on('message', (message: WorkerReply) => {
      if (this.died !== undefined) return
      if (message.type === 'log') {
        const level =
          message.level === 'error' || message.level === 'warn'
            ? message.level
            : 'debug'
        logForDebugging(String(message.text ?? ''), { level })
        return
      }
      if (message.type === 'hook_failed') {
        this.noteHookFailed(message)
        return
      }
      if (message.type === 'next') {
        const job = this.inFlight.get(message.id ?? -1)
        if (!job || !job.tail) {
          this.post({
            type: 'next_error',
            id: message.id,
            nextId: message.nextId,
            error: 'dispatch settled',
          })
          return
        }
        const nextFloors = Array.isArray(message.floors)
          ? (message.floors as readonly HopFloor[])
          : undefined
        void Promise.resolve()
          .then(() =>
            job.tail!(
              isEventRecord(message.argument) ? message.argument : {},
              nextFloors,
            ),
          )
          .then(
            value => {
              try {
                this.post({
                  type: 'next_result',
                  id: message.id,
                  nextId: message.nextId,
                  result: value,
                })
              } catch (postErr) {
                this.post({
                  type: 'next_error',
                  id: message.id,
                  nextId: message.nextId,
                  error:
                    postErr instanceof Error
                      ? postErr.message
                      : String(postErr),
                })
              }
            },
            err => {
              this.post({
                type: 'next_error',
                id: message.id,
                nextId: message.nextId,
                error: err instanceof Error ? err.message : String(err),
              })
            },
          )
        return
      }
      if (message.type === 'next_pull') {
        const job = this.inFlight.get(message.id ?? -1)
        const nextId = message.nextId ?? -1
        if (!job || !job.openNextStream || !job.openedNextStreams) {
          this.post({
            type: 'next_error',
            id: message.id,
            nextId,
            error: 'dispatch settled',
          })
          return
        }
        let gen = job.openedNextStreams.get(nextId)
        if (!gen) {
          if (!message.open) {
            this.post({
              type: 'next_error',
              id: message.id,
              nextId,
              error: 'no stream is open under this nextId',
            })
            return
          }
          try {
            const arg = isEventRecord(message.open.argument)
              ? message.open.argument
              : {}
            gen = job.openNextStream(arg)
            job.openedNextStreams.set(nextId, gen)
          } catch (openErr) {
            this.post({
              type: 'next_error',
              id: message.id,
              nextId,
              error:
                openErr instanceof Error ? openErr.message : String(openErr),
            })
            return
          }
        }
        void gen.next().then(
          step => {
            if (step.done === true) {
              job.openedNextStreams?.delete(nextId)
            }
            try {
              this.post({
                type: 'next_step',
                id: message.id,
                nextId,
                step: { done: step.done === true, value: step.value },
              })
            } catch (postErr) {
              this.post({
                type: 'next_error',
                id: message.id,
                nextId,
                error: `a chunk that is not plain data: ${
                  postErr instanceof Error ? postErr.message : String(postErr)
                }`,
              })
            }
          },
          err => {
            job.openedNextStreams?.delete(nextId)
            this.post({
              type: 'next_error',
              id: message.id,
              nextId,
              error: err instanceof Error ? err.message : String(err),
            })
          },
        )
        return
      }
      if (message.type === 'loaded' || message.type === 'load_error') {
        const load = this.loads.get(message.environmentId ?? '')
        if (!load) return
        this.loads.delete(message.environmentId ?? '')
        if (message.type === 'load_error') {
          this.names.delete(message.environmentId ?? '')
          load.reject(new Error(message.error ?? 'load_error'))
        } else load.resolve(message)
        return
      }
      if (message.type === 'built' || message.type === 'built_error') {
        const build = this.pendingBuilds.get(message.environmentId ?? '')
        if (!build) return
        this.pendingBuilds.delete(message.environmentId ?? '')
        if (message.type === 'built_error')
          build.reject(new Error(message.error ?? 'built_error'))
        else build.resolve(message)
        return
      }
      if (message.type === 'resolved' || message.type === 'resolve_error') {
        const resolveJob = this.pendingResolves.get(message.resolveId ?? -1)
        if (!resolveJob) return
        this.pendingResolves.delete(message.resolveId ?? -1)
        if (message.type === 'resolve_error')
          resolveJob.reject(new Error(message.error ?? 'resolve_error'))
        else resolveJob.resolve(message)
        return
      }
      if (message.type === 'call_result' || message.type === 'call_error') {
        const call = this.pendingCalls.get(message.callId ?? -1)
        if (!call) return
        this.pendingCalls.delete(message.callId ?? -1)
        if (message.type === 'call_error')
          call.reject(new Error(message.error ?? 'call_error'))
        else call.resolve(message)
        return
      }
      if (message.type === 'press_result' || message.type === 'press_error') {
        const press = this.pendingPresses.get(message.pressId ?? -1)
        if (!press) return
        this.pendingPresses.delete(message.pressId ?? -1)
        if (press.timer !== undefined) clearTimeout(press.timer)
        if (message.type === 'press_error')
          press.reject(new Error(message.error ?? 'press_error'))
        else press.resolve(message)
        return
      }
      const job = this.inFlight.get(message.id ?? -1)
      if (!job) return
      if (job.isStream) {
        const pull = job.streamPull
        job.streamPull = undefined
        if (message.type === 'error') {
          this.inFlight.delete(message.id ?? -1)
          const err = new Error(message.error ?? 'hooks worker failed')
          if (pull) pull.reject(err)
          else job.reject(err)
          return
        }
        if (message.type === 'stream_step' && message.step !== undefined) {
          if (message.step.done) {
            this.inFlight.delete(message.id ?? -1)
            this.clearOverruns(job)
          }
          pull?.resolve(message.step)
          return
        }
      }
      this.inFlight.delete(message.id ?? -1)
      if (message.type === 'error')
        job.reject(new Error(message.error ?? 'hooks worker failed'))
      else {
        // densable `Yae` — successful dispatch clears overruns for live envs.
        this.clearOverruns(job)
        job.resolve(message)
      }
    })
  }

  /** densable `Yae`. */
  private clearOverruns(job: PendingJob): void {
    for (const environmentId of job.environments) {
      const plugin = this.names.get(environmentId)
      if (plugin !== undefined && !job.failed.has(plugin)) {
        this.overruns.delete(plugin)
      }
    }
  }

  /**
   * densable `hook_failed`: `A8e` is this post handler; then `xBt` then
   * `uBt`. Unique English: `ignored its signal ${n} times in a row: a
   * runaway plugin in the hooks worker`.
   */
  private noteHookFailed(message: WorkerReply): void {
    const plugin = message.plugin
    if (typeof plugin !== 'string' || plugin === '') return
    // densable `A8e` — worker already posted; do not re-emit hookFailed.
    const report = fillUnappliedRewriteEffect({
      plugin,
      environmentId: message.environmentId,
      event: message.event,
      reason: message.reason,
      effect: message.effect,
      hasOverrun: message.hasOverrun,
      skip: message.skip,
    })
    noteHookSkipFirst(report)
    // densable `uBt` — skip.kind === 'unapplied' does not taint the job.
    const applied = message.skip?.kind !== 'unapplied'
    for (const job of this.inFlight.values()) {
      if (
        applied &&
        job.environments.some(
          environmentId => this.names.get(environmentId) === plugin,
        )
      ) {
        job.failed.add(plugin)
      }
    }
    if (!message.hasOverrun) return
    const count = (this.overruns.get(plugin) ?? 0) + 1
    this.overruns.set(plugin, count)
    if (count >= HOOKS_WORKER_OVERRUN_CAP) {
      // #429: attribute the runaway culprit so worker replacement isolates it
      // rather than unloading other healthy plugins (e.g. large-interface mods).
      this.culpritPlugin = plugin
      this.markDied(
        `${plugin} ignored its signal ${count} times in a row: a runaway plugin in the hooks worker`,
      )
    }
  }

  private rejectAll(
    pending: Map<
      string | number,
      { reject: (err: Error) => void; timer?: ReturnType<typeof setTimeout> }
    >,
    reason: string,
  ): void {
    for (const job of pending.values()) {
      if (job.timer !== undefined) clearTimeout(job.timer)
      job.reject(new Error(reason))
    }
    pending.clear()
  }

  private markDied(reason: string): void {
    if (this.died !== undefined) return
    this.died = reason
    for (const job of this.inFlight.values()) {
      job.abort.abort(new Error(reason))
      job.reject(new Error(reason))
    }
    this.inFlight.clear()
    this.overruns.clear()
    this.names.clear()
    this.rejectAll(this.pendingCalls, reason)
    this.rejectAll(this.pendingPresses, reason)
    this.rejectAll(this.pendingBuilds, reason)
    this.rejectAll(this.pendingResolves, reason)
    this.rejectAll(this.loads, reason)
    for (const port of this.ports.values()) port.close()
    this.ports.clear()
  }

  private post(frame: Record<string, unknown>, transfer?: MessagePort[]): void {
    if (this.died !== undefined) return
    assertHookValueDepth(frame, MAX_HOOK_VM_DEPTH)
    if (transfer && transfer.length > 0)
      this.worker.postMessage(frame, transfer)
    else this.worker.postMessage(frame)
  }

  load(plugin: FunctionHookPlugin): Promise<WorkerReply> {
    if (this.died !== undefined) return Promise.reject(new Error(this.died))
    const channel = new MessageChannel()
    this.ports.get(plugin.name)?.close()
    this.names.set(plugin.name, plugin.name)
    this.ports.set(plugin.name, channel.port1)
    channel.port1.start()
    channel.port1.on('message', (raw: unknown) => {
      const message = isEventRecord(raw) ? raw : undefined
      if (!message || message.type !== 'op') return
      const registration =
        typeof message.registration === 'number'
          ? message.registration
          : undefined
      const forwardedOrigin = Array.isArray(message.hookOrigin)
        ? (message.hookOrigin as readonly HookOriginEntry[])
        : registration !== undefined
          ? ([{ plugin: plugin.name, registration }] as const)
          : undefined
      const forwardedServing = isEventRecord(message.serving)
        ? (message.serving as HookServingContext)
        : undefined
      const runOp = () =>
        handleHostOp(
          String(message.op ?? ''),
          Array.isArray(message.args) ? message.args : [],
          plugin.name,
        )
      const runWithServing = () =>
        forwardedServing !== undefined
          ? activeHookServingAls.run(forwardedServing, runOp)
          : runOp()
      const pending =
        forwardedOrigin !== undefined
          ? activeHookOriginAls.run(forwardedOrigin, runWithServing)
          : runWithServing()
      void pending.then(
        value => {
          channel.port1.postMessage({
            type: 'op_result',
            opId: message.opId,
            value,
          })
        },
        err => {
          channel.port1.postMessage({
            type: 'op_error',
            opId: message.opId,
            error: err instanceof Error ? err.message : String(err),
          })
        },
      )
    })
    return new Promise((resolve, reject) => {
      this.loads.set(plugin.name, { resolve, reject })
      this.post(
        {
          type: 'load',
          environmentId: plugin.name,
          args: plugin,
          port: channel.port2,
        },
        [channel.port2],
      )
    })
  }

  unload(name: string): void {
    const plugin = this.names.get(name)
    if (plugin !== undefined) this.overruns.delete(plugin)
    this.names.delete(name)
    this.ports.get(name)?.close()
    this.ports.delete(name)
    this.post({ type: 'unload', environmentId: name })
  }

  dispatch(
    event: string,
    payload: Record<string, unknown>,
    environments: string[],
    tail: FunctionHookTail,
    only?: string,
    callOptions?: {
      origin?: HookCallOrigin
      hookOrigin?: readonly HookOriginEntry[]
      floors?: readonly HopFloor[]
    },
  ): Promise<WorkerReply> {
    if (this.died !== undefined) return Promise.reject(new Error(this.died))
    const id = ++this.nextId
    const abort = new AbortController()
    return new Promise((resolve, reject) => {
      this.inFlight.set(id, {
        resolve,
        reject,
        abort,
        tail,
        environments,
        failed: new Set(),
      })
      this.post({
        type: 'dispatch',
        id,
        event,
        payload,
        environments,
        only,
        ...(callOptions?.origin !== undefined && {
          origin: callOptions.origin,
        }),
        ...(callOptions?.hookOrigin !== undefined && {
          hookOrigin: callOptions.hookOrigin,
        }),
        ...(callOptions?.floors !== undefined && {
          floors: callOptions.floors,
        }),
      })
    })
  }

  engineCreate(
    payload: Record<string, unknown>,
    environments: string[],
  ): Promise<WorkerReply> {
    if (this.died !== undefined) return Promise.reject(new Error(this.died))
    const id = ++this.nextId
    const abort = new AbortController()
    return new Promise((resolve, reject) => {
      this.inFlight.set(id, {
        resolve,
        reject,
        abort,
        environments,
        failed: new Set(),
      })
      this.post({
        type: 'engine_create',
        id,
        payload,
        environments,
      })
    })
  }

  async *stream<TChunk, TReturn = unknown>(
    event: string,
    payload: Record<string, unknown>,
    environments: string[],
    openNextStream: (
      arg: Record<string, unknown>,
    ) => AsyncGenerator<unknown, unknown, unknown>,
    only?: string,
  ): AsyncGenerator<TChunk, TReturn, unknown> {
    if (this.died !== undefined) throw new Error(this.died)
    const id = ++this.nextId
    const abort = new AbortController()
    const openedNextStreams = new Map<
      number,
      AsyncGenerator<unknown, unknown, unknown>
    >()
    const job: PendingJob = {
      resolve: () => {},
      reject: () => {},
      abort,
      isStream: true,
      openNextStream,
      openedNextStreams,
      environments,
      failed: new Set(),
    }
    this.inFlight.set(id, job)
    this.post({
      type: 'dispatch_stream',
      id,
      event,
      payload,
      environments,
      only,
      hasTail: true,
    })
    let finished = false
    try {
      while (true) {
        if (this.died !== undefined) throw new Error(this.died)
        const step = await new Promise<{ done: boolean; value: unknown }>(
          (resolve, reject) => {
            job.streamPull = { resolve, reject }
            this.post({ type: 'stream_pull', id })
          },
        )
        if (step.done) {
          finished = true
          return step.value as TReturn
        }
        yield step.value as TChunk
      }
    } finally {
      this.inFlight.delete(id)
      if (!finished && this.died === undefined) {
        this.post({ type: 'stream_close', id })
      }
      for (const gen of openedNextStreams.values()) {
        void Promise.resolve(gen.return(undefined)).catch(() => undefined)
      }
      openedNextStreams.clear()
    }
  }

  build(
    environmentId: string,
    table: unknown,
    suppressed?: unknown,
  ): Promise<WorkerReply> {
    if (this.died !== undefined) return Promise.reject(new Error(this.died))
    return new Promise((resolve, reject) => {
      this.pendingBuilds.set(environmentId, { resolve, reject })
      this.post({ type: 'build', environmentId, table, suppressed })
    })
  }

  resolveTables(
    environmentId: string,
    requests: unknown,
  ): Promise<WorkerReply> {
    if (this.died !== undefined) return Promise.reject(new Error(this.died))
    const resolveId = ++this.resolveCounter
    return new Promise((resolve, reject) => {
      this.pendingResolves.set(resolveId, { resolve, reject })
      this.post({ type: 'resolve', resolveId, environmentId, requests })
    })
  }

  callInterface(
    environmentId: string,
    call: { name: string; method: string; args?: unknown[] },
    callers: unknown[] = [],
  ): Promise<WorkerReply> {
    if (this.died !== undefined) return Promise.reject(new Error(this.died))
    const callId = ++this.callCounter
    return new Promise((resolve, reject) => {
      this.pendingCalls.set(callId, { resolve, reject })
      this.post({ type: 'call', callId, environmentId, call, callers })
    })
  }

  press(
    environmentId: string,
    handle: unknown,
    event: unknown,
  ): Promise<WorkerReply> {
    if (this.died !== undefined) return Promise.reject(new Error(this.died))
    const pressId = ++this.pressCounter
    // densable host `obt`: Mme timeout with
    // `ui.press: ${name} did not answer within ${Mme}ms`.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pendingPresses.delete(pressId)) return
        reject(
          new Error(
            `ui.press: ${environmentId} did not answer within ${PRESS_ANSWER_MS}ms`,
          ),
        )
      }, PRESS_ANSWER_MS)
      timer.unref?.()
      this.pendingPresses.set(pressId, { resolve, reject, timer })
      try {
        this.post({ type: 'press', pressId, environmentId, handle, e: event })
      } catch (err) {
        clearTimeout(timer)
        this.pendingPresses.delete(pressId)
        reject(
          new Error(
            `ui.press: the press is not plain data: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        )
      }
    })
  }

  releasePresses(environmentId: string, handles: unknown[]): void {
    if (handles.length === 0 || this.died !== undefined) return
    this.post({ type: 'press_release', environmentId, handles })
  }

  flush(): Promise<number> {
    if (this.died !== undefined) return Promise.reject(new Error(this.died))
    const flushId = ++this.nextId
    this.post({ type: 'flush', flushId })
    return Promise.resolve(flushId)
  }

  abortOp(opId: number, reason?: string): void {
    this.post({ type: 'op_abort', opId, reason })
  }

  dispatchStream(
    event: string,
    payload: Record<string, unknown>,
  ): Promise<number> {
    if (this.died !== undefined) return Promise.reject(new Error(this.died))
    const id = ++this.nextId
    this.post({ type: 'dispatch_stream', id, event, payload })
    return Promise.resolve(id)
  }

  pullStream(id: number): void {
    this.post({ type: 'stream_pull', id })
  }

  stop(): Promise<number> {
    return this.worker.terminate()
  }
}

export function beginFunctionHooksWorkerReplacement(): () => void {
  const state = fhState()
  if (state.workerReplacementPromise === undefined) {
    state.workerReplacementPromise = new Promise<void>(resolve => {
      state.resolveWorkerReplacement = resolve
    })
  }
  return () => {
    const resolve = state.resolveWorkerReplacement
    state.workerReplacementPromise = undefined
    state.resolveWorkerReplacement = undefined
    resolve?.()
  }
}

async function ensureFunctionHooksWorker(): Promise<FunctionHooksWorkerClientLike> {
  const state = fhState()
  if (!state.functionHooksWorker)
    state.functionHooksWorker = new FunctionHooksWorkerClient()
  return state.functionHooksWorker
}

export async function stopFunctionHooksWorker(): Promise<void> {
  fhState().workerOwnsDispatch = false
  const worker = fhState().functionHooksWorker
  fhState().functionHooksWorker = null
  if (worker) await worker.stop()
}

export function unloadModule(name: string): void {
  forgetPluginOwnedMcpServers(name)
  fhState().loadedModules = fhState().loadedModules.map(mod =>
    mod.name === name
      ? { ...mod, status: 'unloaded', hooks: [], patterns: [] }
      : mod,
  )
  for (const key of [...fhState().pluginState.keys()]) {
    if (key.startsWith(`${name}\0`)) fhState().pluginState.delete(key)
  }
  for (const key of [...fhState().pluginAgents.keys()]) {
    if (key.startsWith(`${name}:`)) fhState().pluginAgents.delete(key)
  }
  for (const [agentId, caller] of [...fhState().pluginSpawnCallers.entries()]) {
    if (caller === name) fhState().pluginSpawnCallers.delete(agentId)
  }
  dropPluginAgentDefinitions(name)
  forgetPluginCommands(name)
  const previousServerKey = forgetPluginRegisteredTools(name)
  if (previousServerKey !== undefined) {
    void awaitPluginToolSessionUnmount([previousServerKey])
  }
  for (const key of [...fhState().pluginStore.keys()]) {
    if (key.startsWith(`${name}\0`)) fhState().pluginStore.delete(key)
  }
  forgetPluginSessionAuthHandles(name)
  themeClearOnUnload(name)
  fhState().ownedTables.delete(name)
  fhState().resolvedTables.delete(name)
  fhState().resolvedByKey.delete(name)
  fhState().finalizedEnvironments.delete(name)
}

/**
 * densable retire(): mark retiring, wait out in-flight calls, then unload.
 * Forgets plugin state. The worker gets `unload` when it owns dispatch.
 */
export async function retireFunctionHooksModule(name: string): Promise<void> {
  const mod = fhState().loadedModules.find(item => item.name === name)
  if (!mod || mod.status === 'unloaded') return
  fhState().loadedModules = fhState().loadedModules.map(item =>
    item.name === name ? { ...item, status: 'retiring' } : item,
  )
  const retireWorker = fhState().functionHooksWorker
  if (retireWorker) {
    retireWorker.unload(name)
  }
  if ((fhState().inFlightByModule.get(name) ?? 0) === 0) unloadModule(name)
}

const leftoverShipped = new Map<
  string,
  { register: (...args: unknown[]) => unknown }
>()

const leftoverScans = new Map<string, unknown>()

/**
 * densable Vo — `builtin:${name}/${ue}` with ue = REGISTER_FILE.
 * Never export minify `Vo`.
 */
function leftoverVo(name: string): string {
  return `builtin:${name}/${REGISTER_FILE}`
}

/**
 * densable Lh — folder overlay `{path:folder, modulePath:join(folder,ue)}`,
 * else `{path:Ai, modulePath:Vo(name)}`. Never export minify `Lh`.
 */
export function leftoverLh(
  name: string,
  hooks: LeftoverHooksModule,
): { path: string; modulePath: string } {
  return 'folder' in hooks
    ? { path: hooks.folder, modulePath: join(hooks.folder, REGISTER_FILE) }
    : { path: BUILTIN_MARKETPLACE_NAME, modulePath: leftoverVo(name) }
}

/** densable Ne — registerScan / register keyed by leftoverVo. Never export minify `Ne`. */
const leftoverNe = {
  registerScan(name: string, scan: unknown): void {
    leftoverScans.set(name, scan)
  },
  register(
    name: string,
    shipped: { register: (...args: unknown[]) => unknown },
  ): void {
    leftoverShipped.set(name, shipped)
  },
  scan(name: string): unknown {
    return leftoverScans.get(name)
  },
  source(name: string): unknown {
    return leftoverShipped.get(name)
  },
}

function leftoverIsStandaloneExecutable(): boolean {
  return (
    typeof Bun !== 'undefined' &&
    (Bun as { isStandaloneExecutable?: boolean }).isStandaloneExecutable ===
      true
  )
}

/** densable Bt — freeze string files from the scan payload. */
function leftoverBt(payload: unknown): Readonly<Record<string, string>> {
  const files =
    payload !== null && typeof payload === 'object' && 'files' in payload
      ? (payload as { files?: unknown }).files
      : undefined
  const entries =
    files !== null && typeof files === 'object'
      ? Object.entries(files as Record<string, unknown>)
      : []
  return Object.freeze(
    Object.fromEntries(
      entries.filter(([, value]) => typeof value === 'string'),
    ),
  ) as Readonly<Record<string, string>>
}

/** densable Ht — `{module, scan:Ut, files:Bt}`. Never export minify `Ht`. */
function leftoverHt(
  module: { register: (...args: unknown[]) => unknown },
  payload: unknown,
  dir: string,
): {
  module: { register: (...args: unknown[]) => unknown }
  scan: unknown
  files: Readonly<Record<string, string>>
} {
  return {
    module,
    scan: leftoverUt(payload, dir),
    files: leftoverBt(payload),
  }
}

/** densable Ut — scan.hooks + scan.calls arrays, else throw. */
function leftoverUt(payload: unknown, dir: string): unknown {
  const scan =
    payload !== null && typeof payload === 'object' && 'scan' in payload
      ? (payload as { scan?: unknown }).scan
      : undefined
  if (
    scan !== null &&
    typeof scan === 'object' &&
    Array.isArray((scan as { hooks?: unknown }).hooks) &&
    Array.isArray((scan as { calls?: unknown }).calls) &&
    ((scan as { nextTo?: unknown }).nextTo === undefined ||
      Array.isArray((scan as { nextTo?: unknown }).nextTo))
  ) {
    return scan
  }
  throw new Error(`the build carried no hooks module scan for ${dir}`)
}

/**
 * densable FU(dir, module, scan) — SEA `Nu()?Ht:{module,folder}`.
 * Return is Ht | `{module,folder}` only — never `{shipped}`.
 * Never export minify `FU`.
 */
export function leftoverFu(
  dir: string,
  module: { register: (...args: unknown[]) => unknown },
  scan: () => unknown,
):
  | {
      module: { register: (...args: unknown[]) => unknown }
      scan: unknown
      files: Readonly<Record<string, string>>
    }
  | {
      module: { register: (...args: unknown[]) => unknown }
      folder: string
    } {
  return leftoverIsStandaloneExecutable()
    ? leftoverHt(module, scan(), dir)
    : { module, folder: dir }
}

/**
 * densable uS — Ne keyed by leftoverVo; scan vs shipped if/else.
 * Never export minify `uS`.
 */
export function leftoverUs(plugin: {
  name: string
  hooksModule?:
    | LeftoverHooksModule
    | { shipped: { register: (...args: unknown[]) => unknown } }
}): void {
  const hooks = plugin.hooksModule
  if (hooks === undefined) return
  const vo = leftoverVo(plugin.name)
  if ('scan' in hooks) leftoverNe.registerScan(vo, hooks.scan)
  else if ('shipped' in hooks) leftoverNe.register(vo, hooks.shipped)
}

/** densable Ne.scan / Ne.source / Lh after uS. leftover PZ still holds hooksModule. */
export function leftoverBuiltinHooksModule(
  name: string,
): LeftoverHooksModule | undefined {
  try {
    const { getBuiltinPluginDefinition } =
      require('../../../plugins/builtinPlugins.js') as typeof import('../../../plugins/builtinPlugins.js')
    const hooks = getBuiltinPluginDefinition(name)?.hooksModule
    if (hooks !== undefined && !('shipped' in hooks)) {
      return hooks
    }
  } catch {
    // builtinPlugins optional during standalone tests
  }
  return undefined
}

/**
 * Load every plugin that ships `hooks/register.ts`.
 *
 * The file runs in a vm context with no host globals. Relative imports stay
 * inside the plugin root. A bare specifier is refused. `register` is called
 * with `on` and an empty options object. `on` records the pattern and
 * returns `{ catch() {} }`. The hook function is not called. A module that
 * fails to load or whose `on()` rejects is skipped. Each load reads the
 * file again, so a later load sees edits.
 */
function readPluginManifestDefaults(
  pluginPath: string,
): Record<string, unknown> {
  if (pluginPath === '' || pluginPath === BUILTIN_MARKETPLACE_NAME) return {}
  for (const candidate of [
    join(pluginPath, '.claude-plugin', 'plugin.json'),
    join(pluginPath, 'plugin.json'),
  ]) {
    try {
      if (!existsSync(candidate)) continue
      const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'))
      if (!isEventRecord(parsed) || !isEventRecord(parsed.userConfig)) continue
      const defaults: Record<string, unknown> = {}
      for (const [key, spec] of Object.entries(parsed.userConfig)) {
        if (isEventRecord(spec) && spec.default !== undefined) {
          defaults[key] = spec.default
        }
      }
      return defaults
    } catch {
      // ignore malformed/missing manifest
    }
  }
  return {}
}

function readAgentsMdSettingsOptions(): Record<string, unknown> {
  try {
    const { getInitialSettings } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../settings/settings.js') as typeof import('../../settings/settings.js')
    const merged = mergeSettings(
      (getInitialSettings() ?? {}) as Record<string, unknown>,
    )
    return {
      ...(typeof merged.projectInstructions === 'string' && {
        projectInstructions: merged.projectInstructions,
      }),
      ...(typeof merged.instructionFiles === 'string' && {
        instructionFiles: merged.instructionFiles,
      }),
    }
  } catch {
    return mergeSettings({})
  }
}

function resolveEffectivePluginOptions(
  plugin: FunctionHookPlugin,
): Record<string, unknown> {
  const defaults = readPluginManifestDefaults(plugin.path)
  let fromStorage: Record<string, unknown> = {}
  if (typeof plugin.source === 'string' && plugin.source !== '') {
    try {
      const { loadPluginOptions } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../pluginOptionsStorage.js') as typeof import('../pluginOptionsStorage.js')
      fromStorage = { ...loadPluginOptions(plugin.source) }
    } catch {
      fromStorage = {}
    }
  }
  const isAgentsMd =
    plugin.name === 'builtin:cc-plugin-agents-md' ||
    plugin.name === 'cc-plugin-agents-md' ||
    plugin.name === 'builtin:agents-md' ||
    plugin.name === 'agents-md' ||
    plugin.source === `cc-plugin-agents-md@${BUILTIN_MARKETPLACE_NAME}` ||
    plugin.source === `agents-md@${BUILTIN_MARKETPLACE_NAME}`
  const agentsMdOpts = isAgentsMd ? readAgentsMdSettingsOptions() : {}
  return {
    ...defaults,
    ...agentsMdOpts,
    ...fromStorage,
    ...(plugin.options ?? {}),
  }
}

async function admitUserPluginIfAllowed(
  plugin: FunctionHookPlugin,
  judges: readonly LoadedFunctionHooksModule[],
): Promise<boolean> {
  if (plugin.tier !== 'user') return true
  // Official 2.1.328 (#546): block user-tier mods when org/host managed policy
  // enables `allowManagedModsOnly`, unless the plugin is explicitly enabled by
  // managed policy.
  try {
    const { isAllowManagedModsOnlyEffective } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../pluginPolicy.js') as typeof import('../pluginPolicy.js')
    const { getSettingsForSource } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../settings/settings.js') as typeof import('../../settings/settings.js')
    const policySettings = getSettingsForSource('policySettings') as Record<
      string,
      unknown
    > | null
    if (isAllowManagedModsOnlyEffective(policySettings)) {
      const enabledPlugins = policySettings?.enabledPlugins as
        | Record<string, unknown>
        | undefined
      const enabledByPolicy =
        enabledPlugins?.[plugin.name] === true ||
        (Array.isArray(policySettings?.prependPlugins) &&
          policySettings.prependPlugins.includes(plugin.name)) ||
        (Array.isArray(policySettings?.appendPlugins) &&
          policySettings.appendPlugins.includes(plugin.name))
      if (!enabledByPolicy) {
        logForDebugging(
          `mods are limited to your organization's by policy (allowManagedModsOnly); ${plugin.name} was not loaded`,
          { level: 'warn' },
        )
        return false
      }
    }
  } catch {
    // Policy check unavailable in isolated test contexts
  }
  const activeJudges = judges.filter(
    mod => mod.tier !== 'user' && mod.status !== 'unloaded',
  )
  // densable leftover plugin.register still runs core when judges=0.
  let scannedEvents: string[] = []
  if (plugin.path !== '' && plugin.path !== BUILTIN_MARKETPLACE_NAME) {
    try {
      const src = readFileSync(join(plugin.path, REGISTER_FILE), 'utf8')
      scannedEvents = scanFunctionHookSource(src).patterns
    } catch {
      scannedEvents = []
    }
  }
  const shown: Record<string, unknown> = {
    name: plugin.name,
    tier: 'user',
    root: plugin.path,
    provenance: plugin.source ?? plugin.name,
    uses: { events: scannedEvents, calls: [] },
  }
  const prevLoaded = fhState().loadedModules
  const prevWorkerOwns = fhState().workerOwnsDispatch
  fhState().loadedModules = [...activeJudges]
  fhState().workerOwnsDispatch = activeJudges.some(mod => mod.native !== true)
  try {
    const verdict = await runPluginRegister(shown, plugin.name)
    if (verdict !== undefined && !('allow' in verdict)) {
      logForDebugging(`${plugin.name}: ${pluginRegisterRefusedLine(verdict)}`, {
        level: 'warn',
      })
      return false
    }
    return true
  } finally {
    fhState().loadedModules = prevLoaded
    fhState().workerOwnsDispatch = prevWorkerOwns
  }
}

export async function recordFunctionHookPlugins(
  plugins: readonly FunctionHookPlugin[],
): Promise<LoadedFunctionHooksModule[]> {
  const next: LoadedFunctionHooksModule[] = []
  for (const plugin of plugins) {
    if (
      !(await admitUserPluginIfAllowed(plugin, [
        ...fhState().loadedModules,
        ...next,
      ]))
    ) {
      continue
    }
    const recorded = await recordRegisterPatterns(plugin)
    if (recorded !== null) next.push(recorded)
  }
  return next
}

export async function loadFunctionHooksInProcess(
  plugins: readonly FunctionHookPlugin[],
): Promise<LoadedFunctionHooksModule[]> {
  const recorded = await recordFunctionHookPlugins(plugins)
  const ownedByWorker = fhState().workerOwnsDispatch
  // densable worker load is per-plugin; merge so {only} isolation still
  // sees every live module (not last-write-wins).
  const byName = new Map(
    fhState()
      .loadedModules.filter(mod => mod.status !== 'unloaded')
      .map(mod => [mod.name, mod] as const),
  )
  for (const mod of recorded) byName.set(mod.name, mod)
  replaceLoadedFunctionHooksModules([...byName.values()])
  fhState().workerOwnsDispatch = ownedByWorker
  return recorded
}

/**
 * densable default is a worker. `CLAUDE_CODE_HOOKS_SAME_THREAD` keeps the
 * modules in this process. The worker holds the hook functions; this
 * process keeps the patterns so `cLo` and dispatch can see them.
 */
export async function loadFunctionHooksModules(
  plugins: readonly FunctionHookPlugin[],
): Promise<void> {
  if (process.env.CLAUDE_CODE_HOOKS_SAME_THREAD) {
    await stopFunctionHooksWorker()
    // Nuclear clear first (removeMcpServer for prior Xj mounts), then load —
    // loadFunctionHooksInProcess registers tools into the live host; clearing
    // after would drop those new mounts. Await unmount so async print hosts
    // finish before re-register; pending-removal also skips densable r_o.
    const removedKeys = setLoadedFunctionHooksModules([])
    await awaitPluginToolSessionUnmount(removedKeys)
    replaceLoadedFunctionHooksModules(await loadFunctionHooksInProcess(plugins))
    return
  }
  const maxRespawnAttempts = 2
  const excludedPlugins = new Set<string>()
  let loaded: LoadedFunctionHooksModule[] = []
  let loadedAnyWorkerPlugin = false

  for (let attempt = 0; attempt <= maxRespawnAttempts; attempt++) {
    loaded = []
    loadedAnyWorkerPlugin = false
    let worker: FunctionHooksWorkerClientLike | null = null
    let workerDiedDuringPass = false

    for (const plugin of plugins) {
      if (excludedPlugins.has(plugin.name)) continue
      if (!(await admitUserPluginIfAllowed(plugin, loaded))) {
        continue
      }
      const withOptions: FunctionHookPlugin = {
        ...plugin,
        options: resolveEffectivePluginOptions(plugin),
      }
      if (resolveNativeBuiltinHooksModule(withOptions) !== undefined) {
        const recorded = await recordRegisterPatterns(withOptions)
        if (recorded !== null) loaded.push(recorded)
        continue
      }
      if (!worker) {
        worker = await ensureFunctionHooksWorker()
        if (worker.died !== undefined) {
          await stopFunctionHooksWorker()
          worker = await ensureFunctionHooksWorker()
        }
      }
      let reply: WorkerReply
      try {
        reply = await worker.load(withOptions)
      } catch (err) {
        // #429 (SEA tJ/sxt): if the worker died mid-load, abandon this pass
        // without unloading innocent plugins and respawn with any culprit
        // excluded; if the worker is alive, only skip the failing plugin.
        if (worker.died !== undefined) {
          const culpritName = worker.culpritPlugin
          const diedReason = worker.died
          if (culpritName !== undefined) {
            excludedPlugins.add(culpritName)
            const culpritInfo = plugins.find(p => p.name === culpritName)
            reportHeadlessInlineModStderr(
              {
                name: culpritName,
                source: culpritInfo?.source,
              },
              `${culpritName} was unloaded: it crashed the hooks worker (${diedReason})`,
            )
          } else {
            reportHeadlessInlineModStderr(
              { name: plugin.name, source: plugin.source },
              `the hooks worker crashed during load (${diedReason})`,
            )
          }
          await stopFunctionHooksWorker()
          workerDiedDuringPass = true
          break
        }
        const loadErrMsg = err instanceof Error ? err.message : String(err)
        logForDebugging(
          `hooks module ${plugin.name} failed to load: ${loadErrMsg}`,
          { level: 'error' },
        )
        reportHeadlessInlineModStderr(
          { name: plugin.name, source: plugin.source },
          `hooks module did not load: ${loadErrMsg}`,
        )
        excludedPlugins.add(plugin.name)
        continue
      }
      loadedAnyWorkerPlugin = true
      const registered = Array.isArray(reply.registered) ? reply.registered : []
      for (const mod of registered.filter(isWorkerModule)) {
        loaded.push({
          name: mod.name,
          root: mod.root,
          patterns: mod.patterns,
          hooks: mod.hooks.map(hook => ({
            pattern: hook.pattern,
            matcher: hook.matcher,
            hook: () => undefined,
          })),
          ...(Array.isArray(
            (mod as { surfaceModules?: unknown }).surfaceModules,
          ) && {
            surfaceModules: (
              mod as unknown as { surfaceModules: SurfaceModuleScan[] }
            ).surfaceModules,
          }),
          ...(plugin.source !== undefined && {
            pluginStorageId: plugin.source,
          }),
          ...(plugin.link !== undefined && { link: plugin.link }),
          ...(plugin.tier !== undefined && { tier: plugin.tier }),
          ...(plugin.tier === 'prepend' && { isManaged: true }),
        })
      }
    }

    if (!workerDiedDuringPass) break
    if (attempt === maxRespawnAttempts) {
      logForDebugging(
        'hooks worker died repeatedly during load; remaining worker plugins skipped',
        { level: 'error' },
      )
    }
  }
  // densable reload: retire modules that disappeared so Xj.forget +
  // removeMcpServer run (replace alone left orphan MCP mounts model-visible).
  const nextNames = new Set(loaded.map(mod => mod.name))
  const removed = fhState()
    .loadedModules.filter(
      mod => mod.status !== 'unloaded' && !nextNames.has(mod.name),
    )
    .map(mod => mod.name)
  for (const name of removed) {
    forgetPluginOwnedMcpServers(name)
    await retireFunctionHooksModule(name)
  }
  replaceLoadedFunctionHooksModules(loaded)
  fhState().workerOwnsDispatch = loadedAnyWorkerPlugin
}

function isWorkerModule(value: unknown): value is WorkerModule {
  if (!isEventRecord(value)) return false
  return typeof value.name === 'string' && Array.isArray(value.patterns)
}

function insidePluginRoot(root: string, file: string): boolean {
  const fromRoot = relative(root, file)
  return (
    fromRoot === '' ||
    (!fromRoot.startsWith(`..${sep}`) &&
      fromRoot !== '..' &&
      !isAbsolute(fromRoot))
  )
}

async function loadRegisterNamespace(
  plugin: FunctionHookPlugin,
  modulePath: string,
): Promise<{ register?: unknown }> {
  const root = resolve(plugin.path)
  const context = createContext({})
  const modules = new Map<string, SourceTextModule>()

  const link = async (specifier: string, referrer: { identifier: string }) => {
    if (specifier === 'claude-code') return claudeCodeModule(context)
    if (!specifier.startsWith('.')) {
      throw new Error(`${plugin.name}: bare import ${specifier}`)
    }
    const file = resolve(referrer.identifier, '..', specifier)
    if (!insidePluginRoot(root, file)) {
      throw new Error(`${plugin.name}: import leaves the plugin`)
    }
    return moduleFor(file)
  }

  const moduleFor = (file: string): SourceTextModule => {
    const cached = modules.get(file)
    if (cached) return cached
    const source = readFileSync(file, 'utf8')
    const created = new vm.SourceTextModule(source, {
      identifier: file,
      context,
      initializeImportMeta(meta) {
        meta.url = pathToFileURL(file).href
      },
      async importModuleDynamically(specifier, referrer) {
        const linked = await link(specifier, referrer)
        if (linked.status === 'unlinked') await linked.link(link)
        if (linked.status === 'linked') await linked.evaluate()
        return linked
      },
    })
    modules.set(file, created)
    return created
  }

  const main = moduleFor(modulePath)
  await main.link(link)
  await main.evaluate()
  return main.namespace as { register?: unknown }
}

function walkScanNode(node: unknown, visit: (value: ScanCall) => void): void {
  if (typeof node !== 'object' || node === null) return
  const rec = node as ScanCall & Record<string, unknown>
  visit(rec)
  for (const value of Object.values(rec)) {
    if (Array.isArray(value)) {
      for (const item of value) walkScanNode(item, visit)
    } else {
      walkScanNode(value, visit)
    }
  }
}

function scanLiteral(
  arg: NonNullable<ScanCall['arguments']>[number] | undefined,
): string | undefined {
  if (!arg) return undefined
  if (arg.type === 'Literal' && typeof arg.value === 'string') return arg.value
  if (arg.type === 'TemplateLiteral' && (arg.expressions?.length ?? 0) === 0) {
    const cooked = arg.quasis?.[0]?.value?.cooked
    return cooked === undefined || cooked === null ? undefined : cooked
  }
  return undefined
}

class ScanNestingRefusal extends Error {
  line?: number
  constructor(message: string, line?: number) {
    super(message)
    this.name = 'ScanNestingRefusal'
    this.line = line
  }
}

export function scanFunctionHookSource(
  source: string,
  filePath?: string,
): {
  ok: boolean
  patterns: string[]
  reason?: string
} {
  const patterns: string[] = []
  try {
    let parsedWithAcorn = false
    try {
      const { Parser } = require('acorn') as {
        Parser: {
          extend: (...plugins: Array<(Base: unknown) => unknown>) => {
            parse: (
              code: string,
              opts: {
                ecmaVersion: 'latest'
                sourceType: 'module'
                locations?: boolean
              },
            ) => unknown
          }
        }
      }
      const scopeLimitPlugin = (Base: unknown) => {
        const BaseClass = Base as new (
          ...args: unknown[]
        ) => {
          enterScope(flags: number): void
          scopeStack: unknown[]
          lastTokStartLoc?: { line?: number }
        }
        return class extends BaseClass {
          enterScope(flags: number) {
            super.enterScope(flags)
            if (this.scopeStack.length > MAX_SCAN_SCOPE_DEPTH + 1) {
              const line = this.lastTokStartLoc?.line
              throw new ScanNestingRefusal(
                `code nested too deep to scan: more than ${MAX_SCAN_SCOPE_DEPTH} scopes (functions, blocks, loops) open inside one another`,
                line,
              )
            }
          }
        }
      }
      const tree = Parser.extend(scopeLimitPlugin).parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: true,
      })
      parsedWithAcorn = true
      walkScanNode(tree, node => {
        if (node.type !== 'CallExpression') return
        if (node.callee?.type !== 'Identifier' || node.callee.name !== 'on')
          return
        const literal = scanLiteral(node.arguments?.[0])
        if (literal === undefined) return
        patterns.push(literal)
      })
    } catch (acornErr) {
      if (
        acornErr instanceof ScanNestingRefusal ||
        acornErr instanceof RangeError
      ) {
        throw acornErr
      }
    }
    if (!parsedWithAcorn) {
      const ts = require('typescript') as typeof import('typescript')
      const sf = ts.createSourceFile(
        'hooks.ts',
        source,
        ts.ScriptTarget.Latest,
        true,
      )
      const stack: Array<{ node: import('typescript').Node; depth: number }> = [
        { node: sf, depth: 0 },
      ]
      while (stack.length > 0) {
        const current = stack.pop()!
        const isScope =
          ts.isFunctionDeclaration(current.node) ||
          ts.isFunctionExpression(current.node) ||
          ts.isArrowFunction(current.node) ||
          ts.isMethodDeclaration(current.node) ||
          ts.isBlock(current.node) ||
          ts.isForStatement(current.node) ||
          ts.isForInStatement(current.node) ||
          ts.isForOfStatement(current.node) ||
          ts.isWhileStatement(current.node) ||
          ts.isDoStatement(current.node) ||
          ts.isSwitchStatement(current.node) ||
          ts.isCatchClause(current.node)
        const nextDepth = isScope ? current.depth + 1 : current.depth
        if (nextDepth > MAX_SCAN_SCOPE_DEPTH) {
          const line =
            sf.getLineAndCharacterOfPosition(current.node.getStart(sf)).line + 1
          throw new ScanNestingRefusal(
            `code nested too deep to scan: more than ${MAX_SCAN_SCOPE_DEPTH} scopes (functions, blocks, loops) open inside one another`,
            line,
          )
        }
        if (
          ts.isCallExpression(current.node) &&
          ts.isIdentifier(current.node.expression) &&
          current.node.expression.text === 'on'
        ) {
          const firstArg = current.node.arguments[0]
          if (
            firstArg &&
            (ts.isStringLiteral(firstArg) ||
              ts.isNoSubstitutionTemplateLiteral(firstArg))
          ) {
            patterns.push(firstArg.text)
          }
        }
        ts.forEachChild(current.node, child => {
          stack.push({ node: child, depth: nextDepth })
        })
      }
    }
  } catch (err) {
    if (err instanceof ScanNestingRefusal) {
      const baseMsg =
        err.line !== undefined
          ? `line ${err.line}: ${err.message}`
          : err.message
      return {
        ok: false,
        patterns: [],
        reason: filePath !== undefined ? `${filePath}: ${baseMsg}` : baseMsg,
      }
    }
    if (err instanceof RangeError) {
      const baseMsg = `code nested too deep to scan (the parser stopped: ${err.message})`
      return {
        ok: false,
        patterns: [],
        reason: filePath !== undefined ? `${filePath}: ${baseMsg}` : baseMsg,
      }
    }
    const re = /\bon\(\s*(['"`])([^'"`]+)\1/g
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) {
      patterns.push(match[2]!)
    }
  }
  for (const pattern of patterns) {
    const parsed = parseFunctionHookPattern(pattern)
    if (!parsed.ok) return { ok: false, patterns, reason: parsed.reason }
  }
  return { ok: true, patterns }
}

export function listBuiltinFunctionHookPlugins(): FunctionHookPlugin[] {
  const listed: FunctionHookPlugin[] = []
  try {
    const { getBuiltinPlugins } =
      require('../../../plugins/builtinPlugins.js') as typeof import('../../../plugins/builtinPlugins.js')
    for (const enabled of getBuiltinPlugins().enabled) {
      const hooks = leftoverBuiltinHooksModule(enabled.name)
      if (hooks === undefined) continue
      const overlay = leftoverLh(enabled.name, hooks)
      const plugin: FunctionHookPlugin = {
        name: `builtin:${enabled.name}`,
        path: overlay.path,
        source: `${enabled.name}@${BUILTIN_MARKETPLACE_NAME}`,
        tier: enabled.name === 'cc-plugin-sec-default' ? 'prepend' : 'builtin',
      }
      const resolvedOpts = resolveEffectivePluginOptions(plugin)
      if (Object.keys(resolvedOpts).length > 0) {
        plugin.options = resolvedOpts
      }
      listed.push(plugin)
    }
  } catch {
    // builtinPlugins optional during standalone tests
  }
  return listed
}

function ensureGlobalHyperscriptHelpers(): void {
  const g = globalThis as Record<string, unknown>
  if (g.Fragment === undefined) {
    Object.defineProperty(g, 'Fragment', {
      value: GLOBAL_FRAGMENT_SYMBOL,
      writable: true,
      configurable: true,
      enumerable: false,
    })
  }
  if (g.h === undefined) {
    const hyperscript = (
      type: unknown,
      props: Record<string, unknown> | null | undefined,
      ...childList: unknown[]
    ) => {
      const rest = props ? { ...props } : {}
      const fromProps = rest.children
      delete rest.children
      const flatChildren = flattenUiResolveChildren(
        childList.length > 0 ? childList : fromProps,
      )
      if (typeof type === 'function') {
        const nextProps: Record<string, unknown> = { ...rest }
        if (flatChildren.length === 1) nextProps.children = flatChildren[0]
        else if (flatChildren.length > 1) nextProps.children = flatChildren
        return (type as (p: Record<string, unknown>) => unknown)(nextProps)
      }
      if (type === GLOBAL_FRAGMENT_SYMBOL) {
        return {
          type: 'Box',
          props: { flexDirection: 'column' },
          ...(flatChildren.length > 0 && { children: flatChildren }),
        }
      }
      const node: Record<string, unknown> = { type }
      if (Object.keys(rest).length > 0) node.props = rest
      if (flatChildren.length > 0) node.children = flatChildren
      return node
    }
    Object.defineProperty(g, 'h', {
      value: hyperscript,
      writable: true,
      configurable: true,
      enumerable: false,
    })
  }
}

/**
 * densable `rD(n)` — look up `hooksModule.module` for `@builtin` plugins so
 * built-in mods run natively in-process (both dev and standalone SEA).
 */
function resolveNativeBuiltinHooksModule(
  plugin: FunctionHookPlugin,
): { register: (...args: unknown[]) => unknown } | undefined {
  const suffix = `@${BUILTIN_MARKETPLACE_NAME}`
  if (plugin.source === undefined || !plugin.source.endsWith(suffix)) {
    return undefined
  }
  const rawName = plugin.source.slice(0, -suffix.length)
  try {
    const { getBuiltinPluginDefinition } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../plugins/builtinPlugins.js') as typeof import('../../../plugins/builtinPlugins.js')
    const defHooks = getBuiltinPluginDefinition(rawName)?.hooksModule
    if (
      defHooks !== undefined &&
      'module' in defHooks &&
      typeof defHooks.module?.register === 'function'
    ) {
      return defHooks.module
    }
  } catch {
    // builtinPlugins optional in isolated unit tests
  }
  const registeredHooks = leftoverBuiltinHooksModule(rawName)
  if (
    registeredHooks !== undefined &&
    'module' in registeredHooks &&
    typeof registeredHooks.module?.register === 'function'
  ) {
    return registeredHooks.module
  }
  return undefined
}

async function recordRegisterPatterns(
  plugin: FunctionHookPlugin,
): Promise<LoadedFunctionHooksModule | null> {
  const nativeModule = resolveNativeBuiltinHooksModule(plugin)
  let source = ''
  let loaded: { register?: unknown }
  if (nativeModule !== undefined) {
    ensureGlobalHyperscriptHelpers()
    loaded = nativeModule
    if (plugin.path !== BUILTIN_MARKETPLACE_NAME) {
      try {
        source = readFileSync(join(plugin.path, REGISTER_FILE), 'utf8')
      } catch {
        source = ''
      }
    }
  } else {
    const modulePath = join(plugin.path, REGISTER_FILE)
    try {
      source = readFileSync(modulePath, 'utf8')
    } catch {
      return null
    }
    const scanned = scanFunctionHookSource(source, modulePath)
    if (!scanned.ok) {
      logForDebugging(
        `Failed to scan function hooks module ${modulePath}: ${scanned.reason ?? 'scan refused'}`,
        { level: 'warn' },
      )
      return null
    }
    try {
      loaded = await loadRegisterNamespace(plugin, modulePath)
    } catch {
      return null
    }
  }
  if (typeof loaded.register !== 'function') return null
  const patterns: string[] = []
  const hooks: LoadedFunctionHook[] = []
  const seen = new Set<string>()
  const on = (
    pattern: unknown,
    matcherOrHook?: unknown,
    maybeHook?: unknown,
  ) => {
    if (typeof pattern !== 'string') {
      throw new Error(`${plugin.name}: on() pattern is not a string`)
    }
    const parsed = parseFunctionHookPattern(pattern)
    if (!parsed.ok) throw new Error(`${plugin.name}: on(): ${parsed.reason}`)
    const hook = maybeHook === undefined ? matcherOrHook : maybeHook
    const matcher = maybeHook === undefined ? undefined : matcherOrHook
    if (typeof hook !== 'function') {
      throw new Error(`${plugin.name}: on("${pattern}") takes a function`)
    }
    const isBuiltin =
      plugin.tier === 'builtin' ||
      plugin.tier === 'prepend' ||
      plugin.tier === 'core'
    const matcherReason = checkMatcher(pattern, matcher, isBuiltin)
    if (matcherReason !== undefined) {
      throw new Error(`${plugin.name}: ${pattern}: ${matcherReason}`)
    }
    // densable `ltr` — warn, do not fail the load.
    if (
      (pattern === 'ui.render' || pattern === 'classic.ui.render') &&
      matcher !== undefined
    ) {
      const never = uiRenderMatcherNeverRuns(matcher)
      if (never !== undefined) {
        logForDebugging(
          `hooks module ${plugin.name}: on("ui.render", ${JSON.stringify(matcher)}) ${never}`,
          { level: 'warn' },
        )
      }
    }
    const hasMatcher = matcher !== undefined
    const isWildcard =
      pattern === '*' || pattern.endsWith('.*') || pattern.startsWith('!')
    if (!hasMatcher || isWildcard) {
      if (seen.has(pattern)) {
        throw new Error(`${plugin.name}: on("${pattern}") registered twice`)
      }
      seen.add(pattern)
    }
    patterns.push(pattern)
    const recorded: LoadedFunctionHook = {
      pattern,
      matcher,
      hook: hook as FunctionHookHandler,
    }
    hooks.push(recorded)
    return {
      catch(handler: unknown) {
        if (typeof handler !== 'function') {
          throw new Error(
            `${plugin.name}: on("${pattern}").catch() takes a function`,
          )
        }
        if (recorded.catch) {
          throw new Error(
            `${plugin.name}: on("${pattern}").catch() called twice`,
          )
        }
        if (pattern === 'engine.create') {
          throw new Error(
            `${plugin.name}: on("engine.create").catch() does not apply`,
          )
        }
        recorded.catch = handler as FunctionHookHandler
      },
    }
  }
  try {
    await loaded.register(on, resolveEffectivePluginOptions(plugin))
  } catch {
    return null
  }
  const surfaceModules =
    source !== '' && plugin.path !== BUILTIN_MARKETPLACE_NAME
      ? loadScannedSurfaceModules(plugin.path, scanClientModulePaths(source))
      : []
  return {
    name: plugin.name,
    root: plugin.path,
    patterns,
    hooks,
    ...(surfaceModules.length > 0 && { surfaceModules }),
    ...(plugin.source !== undefined && { pluginStorageId: plugin.source }),
    ...(plugin.link !== undefined && { link: plugin.link }),
    ...(plugin.tier !== undefined && { tier: plugin.tier }),
    ...(plugin.tier === 'prepend' && { isManaged: true }),
    ...(nativeModule !== undefined && { native: true }),
  }
}

runtimeBridge.unloadModule = unloadModule
runtimeBridge.retireModule = retireFunctionHooksModule
