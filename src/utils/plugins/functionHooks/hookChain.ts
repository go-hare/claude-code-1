/**
 * Function hooks submodule: hookChain
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { logForDebugging } from '../../debug.js'
import {
  collectorTelemetryRoad,
  emitCollectorTelemetryEntry,
  type OTelCollectorLogEntry,
} from '../../telemetry/events.js'
import {
  EMPTY_HOP_FLOORS,
  floorsAfterNextTo,
  handlerTier,
  hopBypassReason,
  type FunctionHookNext,
  type HopFloor,
  type HopHandler,
} from '../functionHooksHop.js'
import {
  beginKeptSelectionRun,
  endKeptSelectionRun,
} from '../uiSelectionRowHolding.js'
import { existsSync } from 'fs'
import {
  AGENT_SPAWN_HOOK_REFUSE,
  DENY_AFTER_NEXT_EVENTS,
  EMPTY_HOOK_TRACE,
  ENGINE_HOOK_ORIGIN,
  HOOK_BUDGET_MS,
  HOOK_CATCH_GRACE_MS,
  MAX_PASSED_BY_ENTRIES_PER_SESSION,
  MAX_PASSED_BY_SESSIONS,
  UNAPPLIED_REWRITE_EFFECT,
  assertHookValueDepth,
  budgetMsForHookEvent,
  collectHookTrace,
  createStepBudgetTracker,
  describeThrown,
  functionHookPatternMatches,
  isBuiltinTierMod,
  isEventRecord,
  isSignalAbortedNotInterrupt,
  leftOutRegistrationsForModule,
  makeStepBudget,
  prefixPluginReason,
  sanitizeHookBoundaryValue,
  truncateHostHookResultField,
} from './constants.js'
import { stampPluginOnDrawing } from './press.js'
import {
  activeHookModuleAls,
  activeHookOriginAls,
  activeHookServingAls,
  collectorTelemetryDispatchAls,
  fhState,
  hasMatchingFunctionHook,
  hookDispatch,
  hookEvalAls,
  pluginStorePath,
  pluginStoreSlot,
  readPluginStoreFile,
  reportHeadlessInlineModStderr,
  resolveHookCallOrigin,
  runtimeBridge,
  setOwnedTable,
  waitForWorkerReplacement,
  writePluginStoreFile,
} from './state.js'
import type {
  FunctionHookFailedReport,
  FunctionHookHandler,
  FunctionHookHopSite,
  FunctionHookHostHandler,
  FunctionHookTail,
  HookCallOrigin,
  HookOriginEntry,
  HookServingContext,
  HookTraceNode,
  LoadedFunctionHook,
  LoadedFunctionHooksModule,
  PassedByRecord,
} from './types.js'
import {
  isEngineDrawing,
  matcherAllows,
  pluginFromDrawing,
  sessionCompactMessagesCheck,
  uiRenderViewRewriteCheck,
} from './uiValidation.js'

export function fillUnappliedRewriteEffect(
  report: FunctionHookFailedReport,
): FunctionHookFailedReport {
  if (report.skip?.kind !== 'unapplied') return report
  if (report.skip.why === undefined) return report
  if (report.effect !== undefined && report.effect !== '') return report
  report.effect = UNAPPLIED_REWRITE_EFFECT
  return report
}

/**
 * densable `LLe` — skip-first Map key. Not exported (minify name).
 */
function skipFirstKey(
  report: FunctionHookFailedReport,
  kind: string | undefined,
): string {
  const plugin = report.plugin
  const environmentId = report.environmentId
  const event = report.event
  return `${plugin}#${environmentId ?? ''} ${event} ${kind}`
}

/**
 * densable `T2` analog — write `${plugin}: ${h}` once to the plugin store
 * file when the plugin is loaded or already has a store file. Not tengu/`yo`.
 */
function persistHookSkipOnce(
  plugin: string,
  label: string,
  line: string,
): void {
  if (fhState().skipPersistOnce.has(label)) return
  const known = fhState().loadedModules.some(mod => mod.name === plugin)
  if (!known && !existsSync(pluginStorePath(plugin))) return
  fhState().skipPersistOnce.add(label)
  try {
    const data = readPluginStoreFile(plugin)
    const key = '__hookSkip'
    const prev = data[key]
    const lines = Array.isArray(prev)
      ? prev.filter((item): item is string => typeof item === 'string')
      : typeof prev === 'string' && prev !== ''
        ? [prev]
        : []
    if (lines.includes(line)) return
    lines.push(line)
    const next = { ...data, [key]: lines }
    writePluginStoreFile(plugin, next)
    fhState().pluginStore.set(pluginStoreSlot(plugin, key), lines)
  } catch {
    // skip persist must not fail the hook
  }
}

/**
 * densable `xBt` — skip defined and not `engine.create`; first `s !== 1`
 * unique English via host log (gold `fSe`; analog `logForDebugging`).
 * Then gold `T2` analog persist (not `yo`/tengu).
 */
export function noteHookSkipFirst(report: FunctionHookFailedReport): void {
  const skip = report.skip
  const event = report.event
  if (skip === undefined || event === 'engine.create') return
  const kind = skip.kind
  const r = skipFirstKey(report, kind)
  const s = (fhState().skipFirstLog.get(r) ?? 0) + 1
  fhState().skipFirstLog.set(r, s)
  if (s !== 1) return
  const why = skip.why ?? ''
  const g = kind === 'unapplied' ? 'hook' : 'hook skipped'
  const h =
    kind === 'unapplied'
      ? `${event} hook: ${why}`
      : `${event} hook skipped: ${why}`
  fhState().functionHooksHost.log(h, 'error')
  logForDebugging(h, { level: 'error' })
  const plugin = report.plugin
  const b = `${plugin} ${event} ${g}`
  persistHookSkipOnce(plugin, b, `${plugin}: ${h}`)
}

function watchHookBudget(
  pending: Promise<unknown>,
  plugin: string,
  event: string,
): void {
  let settled = false
  pending.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  const timer = setTimeout(() => {
    if (settled) return
    const reason = prefixPluginReason(
      plugin,
      `still running ${HOOK_BUDGET_MS}ms after its budget ran out; ignores its signal`,
    )
    fhState().functionHooksHost.log(
      `hook overran: ${reason} (${event})`,
      'error',
    )
    fhState().functionHooksHost.hookFailed({
      plugin,
      event,
      reason,
      effect: 'counted toward a runaway',
      hasOverrun: true,
    })
  }, HOOK_BUDGET_MS)
  timer.unref?.()
}

function notifyHookFailed(
  report: FunctionHookFailedReport,
  thrown: string,
): void {
  fillUnappliedRewriteEffect(report)
  fhState().functionHooksHost.log(
    `hook failed: ${report.plugin}: ${thrown} ` +
      `(${report.event}; ${report.effect})`,
    'error',
  )
  fhState().functionHooksHost.hookFailed(report)
}

export function formatHookPassedByLine(
  event: string,
  byPlugin: string,
): string {
  return `its ${event} hook was skipped. "${byPlugin}" runs first and sent the event on past it.`
}

function getPassedBySessionMap(sessionId: string): Map<string, PassedByRecord> {
  const existing = fhState().hooksPassedBySessions.get(sessionId)
  if (existing !== undefined) {
    fhState().hooksPassedBySessions.delete(sessionId)
    fhState().hooksPassedBySessions.set(sessionId, existing)
    return existing
  }
  const created = new Map<string, PassedByRecord>()
  if (fhState().hooksPassedBySessions.size >= MAX_PASSED_BY_SESSIONS) {
    const oldest = fhState().hooksPassedBySessions.keys().next()
    if (!oldest.done) {
      fhState().hooksPassedBySessions.delete(oldest.value)
    }
  }
  fhState().hooksPassedBySessions.set(sessionId, created)
  return created
}

export function recordHooksPassedBy(opts: {
  sessionId?: string
  event: string
  by: string
  plugins: readonly string[]
  count?: number
}): string[] {
  if (opts.event === 'tool.list' || opts.plugins.length === 0) return []
  const sessionKey = opts.sessionId ?? ''
  const sessionMap = getPassedBySessionMap(sessionKey)
  const count = opts.count ?? 1
  const newlyEmitted: string[] = []
  for (const plugin of opts.plugins) {
    if (plugin === opts.by) continue
    const key = `${opts.event} ${plugin} ${opts.by}`
    const prev = sessionMap.get(key)
    const canTrack =
      prev !== undefined || sessionMap.size < MAX_PASSED_BY_ENTRIES_PER_SESSION
    if (!canTrack) continue
    sessionMap.set(key, {
      plugin,
      event: opts.event,
      by: opts.by,
      count: (prev?.count ?? 0) + count,
    })
    if (prev !== undefined) continue
    const line = formatHookPassedByLine(opts.event, opts.by)
    newlyEmitted.push(line)
    fhState().hooksPassedByLines.push({
      plugin,
      event: opts.event,
      by: opts.by,
      line,
    })
    try {
      const { recordPluginUiLog } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../pluginUiLog.js') as typeof import('../pluginUiLog.js')
      recordPluginUiLog(plugin, line)
    } catch {
      // ignore if ui log unavailable
    }
  }
  return newlyEmitted
}

export function getHooksPassedByLines(): ReadonlyArray<{
  plugin: string
  event: string
  by: string
  line: string
}> {
  return fhState().hooksPassedByLines
}

export function resetHooksPassedByForTests(): void {
  fhState().hooksPassedBySessions.clear()
  fhState().hooksPassedByLines.length = 0
}

export async function runFunctionHookChain(
  event: string,
  payload: Record<string, unknown>,
  tail: FunctionHookTail,
  only?: string,
  environments?: readonly string[],
  callOptions?: {
    origin?: HookCallOrigin
    hookOrigin?: readonly HookOriginEntry[]
    floors?: readonly HopFloor[]
    signal?: AbortSignal
    site?: FunctionHookHopSite
    budgetMs?: number
    /** densable `$Ot` `withoutModuleHandlers` — skip plugin hooks, keep core. */
    withoutModuleHandlers?: boolean
    /** Engine-owned handlers in the same hop chain, ahead of plugin handlers. */
    handlersBefore?: readonly FunctionHookHostHandler[]
    /** #509: calling agent cwd and held turn propagated to served `$` methods. */
    cwd?: string
    turnHeld?: string
  },
): Promise<unknown> {
  if (hookDispatch.getStore() === undefined) {
    return hookDispatch.run({ event }, () =>
      runFunctionHookChain(
        event,
        payload,
        tail,
        only,
        environments,
        callOptions,
      ),
    )
  }
  if (callOptions?.withoutModuleHandlers === true) {
    return tail(payload, callOptions.floors ?? EMPTY_HOP_FLOORS)
  }
  // #305: wait for a pending worker replacement BEFORE computing moduleSteps
  // so classic.* and other hooks on the replacement modules are never skipped.
  if (fhState().workerReplacementPromise !== undefined) {
    await waitForWorkerReplacement(event, callOptions?.signal)
  }
  // #381: validate payload nesting depth iteratively before handing to hooks.
  assertHookValueDepth(payload)
  const parentServing = activeHookServingAls.getStore()
  const servingContext: HookServingContext = {
    cwd:
      callOptions?.cwd ??
      (typeof payload.cwd === 'string' && payload.cwd !== ''
        ? payload.cwd
        : undefined) ??
      parentServing?.cwd,
    turnHeld:
      callOptions?.turnHeld ??
      (typeof payload.turnId === 'string' && payload.turnId !== ''
        ? payload.turnId
        : undefined) ??
      parentServing?.turnHeld,
  }
  const hasServing =
    servingContext.cwd !== undefined || servingContext.turnHeld !== undefined
  if (
    hasServing &&
    (parentServing?.cwd !== servingContext.cwd ||
      parentServing?.turnHeld !== servingContext.turnHeld)
  ) {
    // Run the chain under the resolved serving context so nested host ops
    // and served $ calls inherit the calling agent's cwd and held turn.
    return activeHookServingAls.run(servingContext, () =>
      runFunctionHookChain(event, payload, tail, only, environments, {
        ...callOptions,
        cwd: servingContext.cwd,
        turnHeld: servingContext.turnHeld,
      }),
    )
  }
  // densable F0/r1: classic events are `classic.<HookEvent>`; yOt
  // function events (`plugin.register`, `tool.call`, …) are the dotted name.
  const needle = event.includes('.') ? event : `classic.${event}`
  if (event === 'ui.render' || needle === 'classic.ui.render') {
    fhState().lastUiRenderPlugin = ''
  }
  const selectionRun =
    event === 'command.run' || event === 'prompt.submit'
      ? beginKeptSelectionRun()
      : undefined
  if (selectionRun !== undefined && event === 'prompt.submit') {
    endKeptSelectionRun(fhState().pendingPromptSelectionRun)
    fhState().pendingPromptSelectionRun = selectionRun
  }
  if (event === 'turn.complete' || event === 'turn.end') {
    endKeptSelectionRun(fhState().pendingPromptSelectionRun)
    fhState().pendingPromptSelectionRun = undefined
  }
  if (
    (event === 'session.compact' || needle === 'classic.session.compact') &&
    Object.hasOwn(payload, 'messages')
  ) {
    const compactReason = sessionCompactMessagesCheck(payload.messages)
    if (compactReason !== undefined) throw new Error(compactReason)
  }
  const outerHookOrigin =
    callOptions?.hookOrigin ?? activeHookOriginAls.getStore() ?? []
  const initialFloors = callOptions?.floors ?? EMPTY_HOP_FLOORS
  const hostHandlers = new Map<LoadedFunctionHook, FunctionHookHostHandler>()
  const hostSteps = (callOptions?.handlersBefore ?? []).map(handler => {
    const hook: LoadedFunctionHook = {
      pattern: needle,
      hook: () => undefined,
      isManaged: handler.isManaged,
      isCore: handler.isCore,
    }
    hostHandlers.set(hook, handler)
    const mod: LoadedFunctionHooksModule = {
      name: handler.name,
      patterns: [needle],
      native: true,
      isManaged: handler.isManaged,
      isCore: handler.isCore,
    }
    return { mod, hook, registration: -1 }
  })
  const moduleSteps = fhState().loadedModules.flatMap(mod => {
    // densable u8e: g.name !== (n ?? g.name)
    if (only !== undefined && mod.name !== only) return []
    if (environments !== undefined && !environments.includes(mod.name))
      return []
    if (mod.status === 'unloaded') return []
    if (
      mod.status === 'retiring' &&
      (fhState().inFlightByModule.get(mod.name) ?? 0) === 0
    )
      return []
    const leftOut = leftOutRegistrationsForModule(outerHookOrigin, mod.name)
    if (leftOut === 'every') return []
    return (mod.hooks ?? [])
      .map((hook, registration) => ({ hook, registration }))
      .filter(({ hook, registration }) => {
        if (leftOut.includes(registration)) return false
        if (!functionHookPatternMatches(hook.pattern, needle)) return false
        const builtin = isBuiltinTierMod(mod)
        if (event === 'ui.fault' || needle === 'classic.ui.fault') {
          try {
            return matcherAllows(hook.matcher, payload, needle, builtin)
          } catch {
            // densable iO: on('ui.fault') matcher threw on the host; taken as heard
            return true
          }
        }
        return matcherAllows(hook.matcher, payload, needle, builtin)
      })
      .map(({ hook, registration }) => ({ mod, hook, registration }))
  })
  const rawMatched = [...hostSteps, ...moduleSteps]
  // Coalesce consecutive hooks belonging to the same worker module so mixing
  // native + worker modules dispatches once per worker module instead of k^2.
  const collapseWorkerSteps = Boolean(
    fhState().workerOwnsDispatch && fhState().functionHooksWorker,
  )
  const matched = collapseWorkerSteps
    ? rawMatched.filter((entry, idx) => {
        if (entry.mod.native === true) return true
        const prev = rawMatched[idx - 1]
        return prev === undefined || prev.mod.name !== entry.mod.name
      })
    : rawMatched
  const hasNativeMatched = matched.some(entry => entry.mod.native === true)
  const hasWorkerMatched = matched.some(entry => entry.mod.native !== true)
  const hasManagedTierMatched = matched.some(
    entry =>
      entry.mod.tier === 'prepend' ||
      entry.mod.tier === 'append' ||
      entry.mod.isManaged === true ||
      entry.hook.isManaged === true,
  )
  if (
    fhState().workerOwnsDispatch &&
    fhState().workerReplacementPromise !== undefined
  ) {
    await waitForWorkerReplacement(event, callOptions?.signal)
  }
  const dispatchWorker = fhState().functionHooksWorker
  if (fhState().workerOwnsDispatch && dispatchWorker) {
    if (dispatchWorker.died !== undefined) {
      throw new Error(dispatchWorker.died)
    }
    if (
      !hasNativeMatched &&
      !hasManagedTierMatched &&
      event !== 'engine.create'
    ) {
      const workerEnvironments =
        environments !== undefined
          ? environments.filter(name =>
              fhState().loadedModules.some(
                mod =>
                  mod.name === name &&
                  mod.status !== 'unloaded' &&
                  mod.native !== true,
              ),
            )
          : fhState()
              .loadedModules.filter(
                mod => mod.status !== 'unloaded' && mod.native !== true,
              )
              .filter(mod => only === undefined || mod.name === only)
              .map(mod => mod.name)
      const reply = await dispatchWorker
        .dispatch(event, payload, workerEnvironments, tail, only, {
          ...(callOptions?.origin !== undefined && {
            origin: callOptions.origin,
          }),
          ...(outerHookOrigin.length > 0 && { hookOrigin: outerHookOrigin }),
          ...(initialFloors.length > 0 && { floors: initialFloors }),
        })
        .finally(() => {
          if (event === 'command.run') endKeptSelectionRun(selectionRun)
        })
      if (
        event === 'prompt.submit' &&
        isEventRecord(reply.returned) &&
        (reply.returned.drop !== undefined ||
          reply.returned.block !== undefined)
      ) {
        endKeptSelectionRun(selectionRun)
        if (fhState().pendingPromptSelectionRun === selectionRun) {
          fhState().pendingPromptSelectionRun = undefined
        }
      }
      if (event === 'ui.render' || needle === 'classic.ui.render') {
        fhState().lastUiRenderPlugin =
          pluginFromDrawing(reply.returned) ??
          (isEngineDrawing(reply.returned)
            ? ''
            : (matched.at(-1)?.mod.name ?? ''))
      }
      return reply.returned
    }
  }
  type HookTrace = {
    plugin: string
    outcome: 'returned' | 'caught'
    returned?: unknown
  }
  const traces: HookTrace[] = []
  const budgetMs = callOptions?.budgetMs ?? budgetMsForHookEvent(event)
  let tailResult: unknown
  let hasTailResult = false
  const callAt = (
    index: number,
    value: Record<string, unknown>,
    floors: readonly HopFloor[],
    runNode: HookTraceNode,
  ): Promise<unknown> => {
    const step = matched[index]
    if (step === undefined) {
      const tailStart = performance.now()
      return Promise.resolve()
        .then(() => tail(value, floors))
        .then(
          returned => {
            tailResult = returned
            hasTailResult = true
            runNode.entry = Object.freeze({
              index,
              plugin: 'engine',
              tier: 'core',
              event: needle,
              outcome: 'returned',
              ms: Math.max(0, performance.now() - tailStart),
              received: value,
              returned,
            })
            return returned
          },
          err => {
            runNode.entry = Object.freeze({
              index,
              plugin: 'engine',
              tier: 'core',
              event: needle,
              outcome: 'rejected',
              ms: Math.max(0, performance.now() - tailStart),
              received: value,
              returned: undefined,
            })
            throw err
          },
        )
    }
    const stepHandler = hopHandlerOf(step.mod, step.hook, step.registration)
    const stepTier = handlerTier(stepHandler)
    const bypass = hopBypassReason(stepHandler, floors)
    if (bypass !== undefined) {
      logForDebugging(
        `${step.mod.name}: ${event} ${bypass} (tier ${stepTier}); beneath runs`,
      )
      const byPlugin = floors.at(-1)?.plugin
      if (byPlugin !== undefined) {
        recordHooksPassedBy({
          event,
          by: byPlugin,
          plugins: [step.mod.name],
        })
      }
      runNode.entry = Object.freeze({
        index,
        plugin: step.mod.name,
        tier: stepTier,
        event: needle,
        outcome: 'skipped',
        reason: bypass,
        ms: 0,
        received: value,
        returned: undefined,
      })
      const childNode: HookTraceNode = {}
      runNode.beneath = childNode
      return callAt(index + 1, value, floors, childNode)
    }
    const hostHandler = hostHandlers.get(step.hook)
    if (!hostHandler) enterModule(step.mod.name)
    const stepBudgetMs = hostHandler ? 0 : budgetMs
    const stepStarted = performance.now()
    const stepDeadline = Date.now() + stepBudgetMs
    const callOrigin = callOptions?.origin ?? ENGINE_HOOK_ORIGIN
    let nextCalled = false
    let inFlightDownstream: Promise<unknown> | undefined
    let lastDownstreamResult: unknown
    let hasDownstreamResult = false
    const downstreamResults: Record<string, unknown>[] = []
    const beneathHolder: { beneath?: HookTraceNode } = {}
    const stepBudgetTracker = createStepBudgetTracker(budgetMs, stepDeadline)
    let downstreamSettled = false
    let downstreamRejected = false
    let downstreamError: unknown

    const nextFloorsForTo = (tiers: readonly string[]): readonly HopFloor[] => {
      const named =
        tiers.length === 1 && Array.isArray(tiers[0])
          ? (tiers[0] as string[])
          : tiers
      const untieredLegacyPluginRegister =
        event === 'plugin.register' &&
        step.mod.tier === undefined &&
        step.mod.isManaged !== true &&
        step.hook.isManaged !== true &&
        step.mod.isCore !== true &&
        step.hook.isCore !== true
      if (untieredLegacyPluginRegister) {
        if (named.length === 0) return floors
        try {
          return floorsAfterNextTo(floors, named, {
            plugin: step.mod.name,
            tier: 'prepend',
          })
        } catch {
          return floors
        }
      }
      return floorsAfterNextTo(floors, named, {
        plugin: step.mod.name,
        tier: stepTier,
      })
    }

    const runDownstream = (
      passed: unknown,
      targetFloors: readonly HopFloor[],
    ): Promise<unknown> => {
      nextCalled = true
      let onward = isEventRecord(passed) ? passed : value
      if (passed !== undefined && !Object.is(passed, value)) {
        try {
          onward = sanitizeHookBoundaryValue(onward).value
        } catch (err) {
          return Promise.reject(
            new Error(
              `${step.mod.name}: next() passed an invalid value: ${err instanceof Error ? err.message : String(err)}`,
            ),
          )
        }
      }
      const isCoreStep = step.hook.isCore === true || step.mod.isCore === true
      if (!isCoreStep && callOptions?.site !== undefined) {
        const candidate = Object.is(onward, value) ? onward : { ...onward }
        const restored =
          callOptions.site.restoreArgument?.(candidate, value) ?? candidate
        const problem = callOptions.site.checkArgument?.(restored, value)
        if (problem !== undefined) {
          return Promise.reject(
            new Error(
              `${step.mod.name}: next() passed an argument with ${problem}`,
            ),
          )
        }
        const unapplied = callOptions.site.unappliedArgument?.(candidate, value)
        if (unapplied !== undefined) {
          fhState().functionHooksHost.hookFailed({
            plugin: step.mod.name,
            environmentId: step.mod.environmentId ?? step.mod.name,
            event,
            reason: `${step.mod.name}: ${unapplied}`,
            effect: UNAPPLIED_REWRITE_EFFECT,
            hasOverrun: false,
            skip: { kind: 'unapplied', why: unapplied },
          })
        }
        onward = restored
      }
      // densable tn/Ht — Pane/AbovePrompt rewrite must not drift props.view.
      if (
        (event === 'ui.render' || needle === 'classic.ui.render') &&
        isEventRecord(passed) &&
        isEventRecord(value)
      ) {
        const viewReason = uiRenderViewRewriteCheck(value, passed)
        if (viewReason !== undefined) {
          throw new Error(viewReason)
        }
      }
      const childNode: HookTraceNode = {}
      beneathHolder.beneath = childNode
      runNode.beneath = childNode
      const pending = activeHookOriginAls
        .run(outerHookOrigin, () =>
          callAt(index + 1, onward, targetFloors, childNode),
        )
        .then(
          res => {
            downstreamSettled = true
            if (isEventRecord(res)) {
              downstreamResults.push(res)
            }
            lastDownstreamResult = res
            hasDownstreamResult = true
            return res
          },
          err => {
            downstreamSettled = true
            downstreamRejected = true
            downstreamError = err
            throw err
          },
        )
      inFlightDownstream = pending
      return pending
    }

    const next = (passed?: unknown) => runDownstream(passed, floors)
    const nextTo = async (passed: unknown, ...tiers: string[]) =>
      runDownstream(passed, nextFloorsForTo(tiers))
    Object.assign(next, {
      to: nextTo,
      is: (pattern: string) => functionHookPatternMatches(pattern, needle),
      origin: callOrigin,
      event,
      ...(callOptions?.signal !== undefined && { signal: callOptions.signal }),
    })
    Object.defineProperty(next, 'trace', {
      get: () => collectHookTrace(beneathHolder.beneath),
      enumerable: true,
    })
    Object.defineProperty(next, 'budget', {
      get: () => makeStepBudget(stepBudgetMs, stepDeadline, stepBudgetTracker),
      enumerable: true,
    })
    const stepWorker = fhState().functionHooksWorker
    if (
      hasWorkerMatched &&
      step.mod.native !== true &&
      fhState().workerOwnsDispatch &&
      stepWorker
    ) {
      return stepWorker
        .dispatch(
          event,
          value,
          [step.mod.name],
          (onward, workerFloors) =>
            runDownstream(onward, workerFloors ?? floors),
          step.mod.name,
          {
            origin: callOrigin,
            ...(outerHookOrigin.length > 0 && { hookOrigin: outerHookOrigin }),
            ...(floors.length > 0 && { floors }),
          },
        )
        .then(reply => {
          const workerTruncated = truncateHostHookResultField(
            event,
            reply.returned,
          )
          const workerRestored =
            callOptions?.site?.restoreResult !== undefined &&
            isEventRecord(workerTruncated)
              ? callOptions.site.restoreResult(
                  workerTruncated,
                  downstreamResults,
                  value,
                )
              : workerTruncated
          const stripResultFn = resolveStripResultForSite(
            event,
            callOptions?.site,
          )
          const workerReturned =
            stripResultFn !== undefined && isEventRecord(workerRestored)
              ? stripResultFn(workerRestored, downstreamResults, {
                  name: step.mod.name,
                })
              : workerRestored
          if (callOptions?.site?.check !== undefined) {
            const problem = callOptions.site.check(workerReturned)
            if (problem !== undefined) {
              throw new Error(`${step.mod.name}: returned ${problem}`)
            }
          }
          runNode.entry = Object.freeze({
            index,
            plugin: step.mod.name,
            tier: stepTier,
            event: needle,
            outcome: 'returned',
            ms: Math.max(0, performance.now() - stepStarted),
            received: value,
            returned: workerReturned,
          })
          traces.push({
            plugin: step.mod.name,
            outcome: 'returned',
            returned: workerReturned,
          })
          if (
            (event === 'ui.render' || needle === 'classic.ui.render') &&
            workerReturned !== undefined
          ) {
            fhState().lastUiRenderPlugin =
              pluginFromDrawing(workerReturned) ??
              (isEngineDrawing(workerReturned) ? '' : step.mod.name)
            return stampPluginOnDrawing(
              workerReturned,
              fhState().lastUiRenderPlugin,
            )
          }
          return workerReturned
        })
        .finally(() => leaveModule(step.mod.name))
    }
    const engine = runtimeBridge.buildPluginEngine(step.mod)
    const stepHookOrigin: readonly HookOriginEntry[] = [
      ...outerHookOrigin,
      { plugin: step.mod.name, registration: step.registration },
    ]
    // Official 2.1.323 #2183 (`qc` / `Zc`): on `engine.create`, any wildcard
    // (`*`), namespace (`engine.*`), or negated (`!...`) hook is observer-only
    // and cannot add, replace, or withhold `$` nouns — only exact `engine.create`
    // hooks compose `$`.
    const isObserverOnlyEngineCreate =
      event === 'engine.create' &&
      !hostHandler &&
      step.hook.pattern !== 'engine.create'
    if (isObserverOnlyEngineCreate) {
      let cachedDownstream: Promise<unknown> | undefined
      let observedValue: unknown
      let observerCalledNext = false
      const getDownstream = (): Promise<unknown> => {
        if (cachedDownstream === undefined) {
          cachedDownstream = runDownstream(value, floors)
        }
        return cachedDownstream
      }
      const observerNext = async () => {
        observerCalledNext = true
        observedValue = await getDownstream()
        return observedValue
      }
      Object.assign(observerNext, {
        to: observerNext,
        is: (pattern: string) => functionHookPatternMatches(pattern, needle),
        origin: callOrigin,
        event,
        ...(callOptions?.signal !== undefined && {
          signal: callOptions.signal,
        }),
      })
      const obsServingStore = activeHookServingAls.getStore()
      const obsStepServingStore: HookServingContext = {
        ...obsServingStore,
        budgetTracker: stepBudgetTracker,
        isDispatching: () => !downstreamSettled,
      }
      return Promise.resolve()
        .then(() =>
          activeHookServingAls.run(obsStepServingStore, () =>
            activeHookOriginAls.run(stepHookOrigin, () =>
              activeHookModuleAls.run(step.mod, () =>
                step.hook.hook(engine, value, observerNext),
              ),
            ),
          ),
        )
        .then(
          returned => {
            if (!observerCalledNext) {
              logForDebugging(
                `hooks module ${step.mod.name}: the on("${step.hook.pattern}") hook never called next at engine.create; what is beneath runs`,
                { level: 'warn' },
              )
            } else if (returned !== observedValue) {
              logForDebugging(
                `hooks module ${step.mod.name}: the on("${step.hook.pattern}") hook returned something other than next(e) at engine.create, which it only observes; ignored`,
                { level: 'warn' },
              )
            }
            return getDownstream()
          },
          err => {
            const msg = err instanceof Error ? err.message : String(err)
            logForDebugging(
              `hooks module ${step.mod.name}: the on("${step.hook.pattern}") hook failed at engine.create (${msg}); passed on`,
              { level: 'warn' },
            )
            if (
              cachedDownstream === undefined &&
              callOptions?.signal?.aborted
            ) {
              throw err
            }
            return getDownstream()
          },
        )
        .finally(() => {
          leaveModule(step.mod.name)
        })
    }
    const running = Promise.resolve().then(() => {
      if (hostHandler) {
        callOptions?.signal?.throwIfAborted()
        return hostHandler.run(value, next as FunctionHookNext)
      }
      const servingStore = activeHookServingAls.getStore()
      const stepServingStore: HookServingContext = {
        ...servingStore,
        budgetTracker: stepBudgetTracker,
        isDispatching: () => !downstreamSettled,
      }
      return activeHookServingAls.run(stepServingStore, () =>
        activeHookOriginAls.run(stepHookOrigin, () =>
          activeHookModuleAls.run(step.mod, () =>
            step.hook.hook(engine, value, next),
          ),
        ),
      )
    })
    if (!hostHandler) watchHookBudget(running, step.mod.name, event)
    return running
      .then(rawReturned => {
        const truncated = truncateHostHookResultField(event, rawReturned)
        const restored =
          !hostHandler &&
          callOptions?.site?.restoreResult !== undefined &&
          isEventRecord(truncated)
            ? callOptions.site.restoreResult(
                truncated,
                downstreamResults,
                value,
              )
            : truncated
        const stripResultFn = resolveStripResultForSite(
          event,
          callOptions?.site,
        )
        const returned =
          !hostHandler && stripResultFn !== undefined && isEventRecord(restored)
            ? stripResultFn(restored, downstreamResults, {
                name: step.mod.name,
              })
            : restored
        if (!hostHandler && callOptions?.site?.check !== undefined) {
          const problem = callOptions.site.check(returned)
          if (problem !== undefined) {
            throw new Error(`${step.mod.name}: returned ${problem}`)
          }
        }
        if (
          !hostHandler &&
          nextCalled &&
          DENY_AFTER_NEXT_EVENTS.has(event) &&
          isEventRecord(returned) &&
          returned.deny !== undefined &&
          downstreamResults.some(r => r.deny === undefined)
        ) {
          throw new Error(
            `${step.mod.name}: returned a deny after its next() was answered (deny in place of next)`,
          )
        }
        if (
          !hostHandler &&
          event === 'agent.spawn' &&
          !nextCalled &&
          (!isEventRecord(returned) || returned.deny === undefined)
        ) {
          throw new Error(`${step.mod.name}: ${AGENT_SPAWN_HOOK_REFUSE}`)
        }
        if (!hostHandler && !nextCalled && index + 1 < matched.length) {
          recordHooksPassedBy({
            event,
            by: step.mod.name,
            plugins: matched
              .slice(index + 1)
              .filter(m => !hostHandlers.has(m.hook))
              .map(m => m.mod.name),
          })
        }
        const outcome =
          hasDownstreamResult && Object.is(returned, lastDownstreamResult)
            ? 'passed'
            : 'returned'
        runNode.entry = Object.freeze({
          index,
          plugin: step.mod.name,
          tier: stepTier,
          event: needle,
          outcome,
          ms: Math.max(0, performance.now() - stepStarted),
          received: value,
          returned,
        })
        traces.push({
          plugin: step.mod.name,
          outcome: 'returned',
          returned,
        })
        if (
          (event === 'ui.render' || needle === 'classic.ui.render') &&
          returned !== undefined
        ) {
          fhState().lastUiRenderPlugin = step.mod.name
          return stampPluginOnDrawing(returned, step.mod.name)
        }
        return returned
      })
      .catch(err => {
        const thrown = describeThrown(err)
        notifyHookFailed(
          {
            plugin: step.mod.name,
            environmentId: step.mod.name,
            event,
            reason: prefixPluginReason(step.mod.name, thrown),
            effect: 'skipped; what is below it ran in its place',
            hasOverrun: false,
          },
          thrown,
        )
        if (
          step.hook.catch &&
          (fhState().workerReplacementPromise !== undefined ||
            (err instanceof Error && err.message.includes('hooks worker')))
        ) {
          // #399: a .catch must not silently pass a guard hook when the worker
          // was replaced/restarted during the call; refuse instead.
          logForDebugging(
            `${step.mod.name}: the hooks worker was replaced during ${event}; ${step.mod.name}'s .catch answered in place of its hook`,
            { level: 'error' },
          )
          runNode.entry = Object.freeze({
            index,
            plugin: step.mod.name,
            tier: stepTier,
            event: needle,
            outcome: 'rejected',
            ms: Math.max(0, performance.now() - stepStarted),
            received: value,
            returned: undefined,
          })
          throw err
        }
        if (
          !step.hook.catch ||
          (downstreamRejected && Object.is(err, downstreamError)) ||
          (nextCalled && isSignalAbortedNotInterrupt(callOptions?.signal))
        ) {
          runNode.entry = Object.freeze({
            index,
            plugin: step.mod.name,
            tier: stepTier,
            event: needle,
            outcome: 'rejected',
            ms: Math.max(0, performance.now() - stepStarted),
            received: value,
            returned: undefined,
          })
          throw err
        }
        const catchHandler = step.hook.catch
        const catchDeadline = Date.now() + HOOK_CATCH_GRACE_MS
        const catchTo = async (passed: unknown, ...tiers: string[]) =>
          inFlightDownstream ?? runDownstream(passed, nextFloorsForTo(tiers))
        const catchNext = Object.assign(
          (passed?: unknown) =>
            inFlightDownstream ?? runDownstream(passed, floors),
          {
            to: catchTo,
            is: (pattern: string) =>
              functionHookPatternMatches(pattern, needle),
            origin: callOrigin,
            event,
            ...(callOptions?.signal !== undefined && {
              signal: callOptions.signal,
            }),
            error: Object.freeze({
              kind: 'throw' as const,
              ...(thrown !== '' && { message: thrown }),
              budget: HOOK_CATCH_GRACE_MS,
            }),
            called: nextCalled,
          },
        )
        Object.defineProperty(catchNext, 'trace', {
          get: () => collectHookTrace(beneathHolder.beneath),
          enumerable: true,
        })
        Object.defineProperty(catchNext, 'budget', {
          get: () => makeStepBudget(HOOK_CATCH_GRACE_MS, catchDeadline),
          enumerable: true,
        })
        return Promise.resolve()
          .then(() =>
            activeHookOriginAls.run(stepHookOrigin, () =>
              catchHandler(engine, value, catchNext),
            ),
          )
          .then(rawCaught => {
            const stripResultFn = resolveStripResultForSite(
              event,
              callOptions?.site,
            )
            const returned =
              !hostHandler &&
              stripResultFn !== undefined &&
              isEventRecord(rawCaught)
                ? stripResultFn(rawCaught, downstreamResults, {
                    name: step.mod.name,
                  })
                : rawCaught
            runNode.entry = Object.freeze({
              index,
              plugin: step.mod.name,
              tier: stepTier,
              event: needle,
              outcome: 'caught',
              ms: Math.max(0, performance.now() - stepStarted),
              received: value,
              returned,
            })
            traces.push({
              plugin: step.mod.name,
              outcome: 'caught',
              returned,
            })
            if (
              (event === 'ui.render' || needle === 'classic.ui.render') &&
              returned !== undefined
            ) {
              fhState().lastUiRenderPlugin = step.mod.name
              return stampPluginOnDrawing(returned, step.mod.name)
            }
            return returned
          })
      })
      .finally(() => {
        if (!hostHandler) leaveModule(step.mod.name)
      })
  }
  const rootTraceNode: HookTraceNode = {}
  // densable `gSt`: nested evaluateUiRender from a hook skips sBo cache.
  return hookEvalAls.run(true, () =>
    callAt(0, payload, initialFloors, rootTraceNode)
      .then(async returned => {
        if (event === 'tool.check' && isEventRecord(returned)) {
          let result = returned
          if (payload.ceiling === 'ask' && result.decision === 'allow') {
            result = { ...result, decision: 'ask' }
          }
          // Official 2.1.327 (#518): in `claude plugin eval`, route `tool.check`
          // decisions through `resolveEvalPermissionHookDecision` (running the
          // base check if hooks short-circuited) and stamp `plugin_approval`.
          if (
            process.env.CLAUDE_CODE_EVAL_CONFINED === '1' ||
            process.env.CLAUDE_CODE_EVAL_CONFINED === 'true'
          ) {
            const baseRaw = hasTailResult
              ? tailResult
              : await Promise.resolve()
                  .then(() => tail(payload, initialFloors))
                  .catch(() => ({
                    decision: 'deny',
                    checkCrashed: true,
                  }))
            const baseRec = isEventRecord(baseRaw) ? baseRaw : {}
            const toBehavior = (
              rec: Record<string, unknown>,
            ): 'allow' | 'deny' | 'ask' => {
              const candidate =
                typeof rec.decision === 'string'
                  ? rec.decision
                  : typeof rec.behavior === 'string'
                    ? rec.behavior
                    : undefined
              if (
                candidate === 'allow' ||
                candidate === 'deny' ||
                candidate === 'ask'
              ) {
                return candidate
              }
              return 'allow'
            }
            const { resolveEvalPermissionHookDecision } =
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require('../pluginEval/report.js') as typeof import('../pluginEval/report.js')
            const resolved = resolveEvalPermissionHookDecision({
              baseDecision: {
                behavior: toBehavior(baseRec),
                fromDenyRule:
                  baseRec.fromDenyRule === true ||
                  typeof baseRec.rule === 'string' ||
                  (isEventRecord(baseRec.decisionReason) &&
                    baseRec.decisionReason.type === 'rule'),
                checkCrashed: baseRec.checkCrashed === true,
                checkUnfinished: baseRec.checkUnfinished === true,
                message:
                  typeof baseRec.reason === 'string'
                    ? baseRec.reason
                    : typeof baseRec.message === 'string'
                      ? baseRec.message
                      : undefined,
              },
              hookDecision: {
                behavior: toBehavior(result),
                message:
                  typeof result.reason === 'string'
                    ? result.reason
                    : typeof result.message === 'string'
                      ? result.message
                      : undefined,
              },
              toolName:
                typeof payload.tool === 'string' ? payload.tool : 'unknown',
            })
            result = {
              ...result,
              decision: resolved.behavior,
              ...(resolved.message !== undefined
                ? { reason: resolved.message }
                : {}),
              ...(resolved.pluginApproval !== undefined
                ? {
                    plugin_approval: resolved.pluginApproval,
                    pluginApproval: resolved.pluginApproval,
                  }
                : {}),
            }
          }
          return result
        }
        if (
          event === 'prompt.submit' &&
          isEventRecord(returned) &&
          (returned.drop !== undefined || returned.block !== undefined)
        ) {
          endKeptSelectionRun(selectionRun)
          if (fhState().pendingPromptSelectionRun === selectionRun) {
            fhState().pendingPromptSelectionRun = undefined
          }
        }
        if (event === 'plugin.register' && isEventRecord(returned)) {
          Object.defineProperty(returned, '__pluginRegisterTrace', {
            value: traces,
            enumerable: false,
          })
        }
        return returned
      })
      .finally(() => {
        if (event === 'command.run') endKeptSelectionRun(selectionRun)
      }),
  )
}

function resolveStripResultForSite(
  event: string,
  site: FunctionHookHopSite | undefined,
): FunctionHookHopSite['stripResult'] {
  if (site?.stripResult !== undefined) {
    return site.stripResult
  }
  if (event === 'tool.check') {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { stripToolCheckHookResult } =
      require('../../permissions/permissions.js') as typeof import('../../permissions/permissions.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    return stripToolCheckHookResult
  }
  return undefined
}

function hopHandlerOf(
  mod: LoadedFunctionHooksModule,
  hook: LoadedFunctionHook,
  registration = 0,
): HopHandler & {
  hook: FunctionHookHandler
  catch?: FunctionHookHandler
  mod: LoadedFunctionHooksModule
  registration: number
} {
  return {
    name: mod.name,
    tier: mod.tier,
    isManaged: hook.isManaged ?? mod.isManaged,
    isCore: hook.isCore ?? mod.isCore,
    hook: hook.hook,
    ...(hook.catch !== undefined && { catch: hook.catch }),
    mod,
    registration,
  }
}

function argumentForNext(
  handler: HopHandler,
  site: FunctionHookHopSite | undefined,
  passed: unknown,
  original: Record<string, unknown>,
): Record<string, unknown> {
  const record = isEventRecord(passed) ? passed : original
  if (site === undefined) return record
  const restored = site.restoreArgument?.(record, original) ?? record
  const problem = site.checkArgument?.(restored, original)
  if (problem !== undefined) {
    throw new Error(
      `${handler.name}: next() passed an argument with ${problem}`,
    )
  }
  return restored
}

/**
 * densable `ya` / `qT` / `eg` / `By` / `Mo.to` — hop with floors.
 * `next.to(e, "append")` is `Fn` then `Mn` skips the bracketed tiers.
 */
export async function runFunctionHookHop(
  event: string,
  payload: Record<string, unknown>,
  tail: FunctionHookTail,
  extra?: {
    prepend?: Array<
      HopHandler & {
        hook: FunctionHookHandler
        catch?: FunctionHookHandler
        mod?: LoadedFunctionHooksModule
        registration?: number
      }
    >
    site?: FunctionHookHopSite
    signal?: AbortSignal
    origin?: HookCallOrigin
    hookOrigin?: readonly HookOriginEntry[]
    budgetMs?: number
  },
): Promise<unknown> {
  const needle = event.includes('.') ? event : `classic.${event}`
  const outerHookOrigin =
    extra?.hookOrigin ?? activeHookOriginAls.getStore() ?? []
  const rawFromLoaded = fhState().loadedModules.flatMap(mod => {
    if (mod.status === 'unloaded') return []
    if (
      mod.status === 'retiring' &&
      (fhState().inFlightByModule.get(mod.name) ?? 0) === 0
    ) {
      return []
    }
    const leftOut = leftOutRegistrationsForModule(extra?.hookOrigin, mod.name)
    if (leftOut === 'every') return []
    const builtin = isBuiltinTierMod(mod)
    return (mod.hooks ?? [])
      .map((hook, registration) => ({ hook, registration }))
      .filter(({ registration }) => !leftOut.includes(registration))
      .filter(({ hook }) => functionHookPatternMatches(hook.pattern, needle))
      .filter(({ hook }) =>
        matcherAllows(hook.matcher, payload, needle, builtin),
      )
      .map(({ hook, registration }) => hopHandlerOf(mod, hook, registration))
  })
  const collapseWorkerSteps = Boolean(
    fhState().workerOwnsDispatch && fhState().functionHooksWorker,
  )
  const fromLoaded = collapseWorkerSteps
    ? rawFromLoaded.filter((entry, idx) => {
        if (entry.mod.native === true) return true
        const prev = rawFromLoaded[idx - 1]
        return prev === undefined || prev.mod.name !== entry.mod.name
      })
    : rawFromLoaded
  const handlers = [...(extra?.prepend ?? []), ...fromLoaded]
  const site = extra?.site
  const callOrigin = extra?.origin ?? ENGINE_HOOK_ORIGIN
  const budgetMs = extra?.budgetMs ?? budgetMsForHookEvent(event)
  const callAt = (
    index: number,
    value: Record<string, unknown>,
    floors: readonly HopFloor[],
    runNode: HookTraceNode,
  ): Promise<unknown> => {
    const step = handlers[index]
    if (step === undefined) {
      const tailStart = performance.now()
      return Promise.resolve()
        .then(() => tail(value, floors))
        .then(
          returned => {
            runNode.entry = Object.freeze({
              index,
              plugin: 'engine',
              tier: 'core',
              event: needle,
              outcome: 'returned',
              ms: Math.max(0, performance.now() - tailStart),
              received: value,
              returned,
            })
            return returned
          },
          err => {
            runNode.entry = Object.freeze({
              index,
              plugin: 'engine',
              tier: 'core',
              event: needle,
              outcome: 'rejected',
              ms: Math.max(0, performance.now() - tailStart),
              received: value,
              returned: undefined,
            })
            throw err
          },
        )
    }
    const stepTier = handlerTier(step)
    const bypass = hopBypassReason(step, floors)
    if (bypass !== undefined) {
      logForDebugging(
        `${step.name}: ${event} ${bypass} (tier ${stepTier}); beneath runs`,
      )
      runNode.entry = Object.freeze({
        index,
        plugin: step.name,
        tier: stepTier,
        event: needle,
        outcome: 'skipped',
        reason: bypass,
        ms: 0,
        received: value,
        returned: undefined,
      })
      const childNode: HookTraceNode = {}
      runNode.beneath = childNode
      return callAt(index + 1, value, floors, childNode)
    }
    const engine = runtimeBridge.buildPluginEngine(
      step.mod ?? { name: step.name },
    )
    const stepStarted = performance.now()
    const stepDeadline = Date.now() + budgetMs
    let nextCalled = false
    let inFlightDownstream: Promise<unknown> | undefined
    let lastDownstreamResult: unknown
    let hasDownstreamResult = false
    const downstreamResults: Record<string, unknown>[] = []
    const beneathHolder: { beneath?: HookTraceNode } = {}
    const stepBudgetTracker = createStepBudgetTracker(budgetMs, stepDeadline)
    let downstreamSettled = false
    let downstreamRejected = false
    let downstreamError: unknown
    const nextFloorsForTo = (tiers: readonly string[]): readonly HopFloor[] => {
      const named =
        tiers.length === 1 && Array.isArray(tiers[0])
          ? (tiers[0] as string[])
          : tiers
      return floorsAfterNextTo(floors, named, {
        plugin: step.name,
        tier: stepTier,
      })
    }
    const runDownstream = (
      passed: unknown,
      targetFloors: readonly HopFloor[],
    ): Promise<unknown> => {
      nextCalled = true
      let onward: Record<string, unknown>
      try {
        onward =
          step.isCore === true || step.mod?.isCore === true
            ? isEventRecord(passed)
              ? passed
              : value
            : argumentForNext(step, site, passed, value)
      } catch (err) {
        return Promise.reject(err)
      }
      const childNode: HookTraceNode = {}
      beneathHolder.beneath = childNode
      runNode.beneath = childNode
      const pending = activeHookOriginAls
        .run(outerHookOrigin, () =>
          callAt(index + 1, onward, targetFloors, childNode),
        )
        .then(
          res => {
            downstreamSettled = true
            if (isEventRecord(res)) {
              downstreamResults.push(res)
            }
            lastDownstreamResult = res
            hasDownstreamResult = true
            return res
          },
          err => {
            downstreamSettled = true
            downstreamRejected = true
            downstreamError = err
            throw err
          },
        )
      inFlightDownstream = pending
      return pending
    }
    const next = ((passed?: unknown) =>
      runDownstream(passed, floors)) as FunctionHookNext &
      Parameters<FunctionHookHandler>[2]
    next.to = async (passed: unknown, ...tiers: string[]) =>
      runDownstream(passed, nextFloorsForTo(tiers))
    Object.assign(next, {
      is: (pattern: string) => functionHookPatternMatches(pattern, needle),
      origin: callOrigin,
      event,
      ...(extra?.signal !== undefined && { signal: extra.signal }),
    })
    Object.defineProperty(next, 'trace', {
      get: () => collectHookTrace(beneathHolder.beneath),
      enumerable: true,
    })
    Object.defineProperty(next, 'budget', {
      get: () => makeStepBudget(budgetMs, stepDeadline),
      enumerable: true,
    })
    const hopWorker = fhState().functionHooksWorker
    if (
      step.mod !== undefined &&
      step.mod.native !== true &&
      fhState().workerOwnsDispatch &&
      hopWorker
    ) {
      enterModule(step.name)
      return hopWorker
        .dispatch(
          event,
          value,
          [step.mod.name],
          (onward, workerFloors) =>
            runDownstream(onward, workerFloors ?? floors),
          step.mod.name,
          {
            origin: callOrigin,
            ...(outerHookOrigin.length > 0 && { hookOrigin: outerHookOrigin }),
            ...(floors.length > 0 && { floors }),
          },
        )
        .then(reply => {
          const preStrip =
            step.isCore !== true &&
            site?.restoreResult !== undefined &&
            isEventRecord(reply.returned)
              ? site.restoreResult(reply.returned, downstreamResults, value)
              : reply.returned
          const stripResultFn = resolveStripResultForSite(event, site)
          const restored =
            step.isCore !== true &&
            stripResultFn !== undefined &&
            isEventRecord(preStrip)
              ? stripResultFn(preStrip, downstreamResults, {
                  name: step.name,
                })
              : preStrip
          if (step.isCore !== true && site?.check !== undefined) {
            const problem = site.check(restored)
            if (problem !== undefined) {
              throw new Error(`${step.name}: returned ${problem}`)
            }
          }
          runNode.entry = Object.freeze({
            index,
            plugin: step.name,
            tier: stepTier,
            event: needle,
            outcome: 'returned',
            ms: Math.max(0, performance.now() - stepStarted),
            received: value,
            returned: restored,
          })
          return restored
        })
        .finally(() => leaveModule(step.name))
    }
    enterModule(step.name)
    const stepHookOrigin: readonly HookOriginEntry[] =
      step.registration !== undefined
        ? [
            ...outerHookOrigin,
            { plugin: step.name, registration: step.registration },
          ]
        : [...outerHookOrigin, step.name]
    const running = Promise.resolve().then(() =>
      activeHookOriginAls.run(stepHookOrigin, () =>
        step.hook(engine, value, next),
      ),
    )
    watchHookBudget(running, step.name, event)
    return running
      .then(rawReturned => {
        const preStrip =
          step.isCore !== true &&
          site?.restoreResult !== undefined &&
          isEventRecord(rawReturned)
            ? site.restoreResult(rawReturned, downstreamResults, value)
            : rawReturned
        const stripResultFn = resolveStripResultForSite(event, site)
        const returned =
          step.isCore !== true &&
          stripResultFn !== undefined &&
          isEventRecord(preStrip)
            ? stripResultFn(preStrip, downstreamResults, {
                name: step.name,
              })
            : preStrip
        if (step.isCore !== true && site?.check !== undefined) {
          const problem = site.check(returned)
          if (problem !== undefined) {
            throw new Error(`${step.name}: returned ${problem}`)
          }
        }
        if (!step.isCore && !nextCalled && index + 1 < handlers.length) {
          recordHooksPassedBy({
            event,
            by: step.name,
            plugins: handlers
              .slice(index + 1)
              .filter(m => !m.isCore)
              .map(m => m.name),
          })
        }
        const outcome =
          hasDownstreamResult && Object.is(returned, lastDownstreamResult)
            ? 'passed'
            : 'returned'
        runNode.entry = Object.freeze({
          index,
          plugin: step.name,
          tier: stepTier,
          event: needle,
          outcome,
          ms: Math.max(0, performance.now() - stepStarted),
          received: value,
          returned,
        })
        return returned
      })
      .catch(err => {
        const thrown = describeThrown(err)
        notifyHookFailed(
          {
            plugin: step.name,
            environmentId: step.name,
            event,
            reason: prefixPluginReason(step.name, thrown),
            effect: 'skipped; what is below it ran in its place',
            hasOverrun: false,
          },
          thrown,
        )
        if (!step.catch) {
          runNode.entry = Object.freeze({
            index,
            plugin: step.name,
            tier: stepTier,
            event: needle,
            outcome: 'rejected',
            ms: Math.max(0, performance.now() - stepStarted),
            received: value,
            returned: undefined,
          })
          throw err
        }
        const catchHandler = step.catch
        const catchDeadline = Date.now() + HOOK_CATCH_GRACE_MS
        const catchTo = async (passed: unknown, ...tiers: string[]) =>
          inFlightDownstream ?? runDownstream(passed, nextFloorsForTo(tiers))
        const catchNext = Object.assign(
          (passed?: unknown) =>
            inFlightDownstream ?? runDownstream(passed, floors),
          {
            to: catchTo,
            is: (pattern: string) =>
              functionHookPatternMatches(pattern, needle),
            origin: callOrigin,
            event,
            ...(extra?.signal !== undefined && { signal: extra.signal }),
            error: Object.freeze({
              kind: 'throw' as const,
              ...(thrown !== '' && { message: thrown }),
              budget: HOOK_CATCH_GRACE_MS,
            }),
            called: nextCalled,
          },
        )
        Object.defineProperty(catchNext, 'trace', {
          get: () => collectHookTrace(beneathHolder.beneath),
          enumerable: true,
        })
        Object.defineProperty(catchNext, 'budget', {
          get: () => makeStepBudget(HOOK_CATCH_GRACE_MS, catchDeadline),
          enumerable: true,
        })
        return Promise.resolve()
          .then(() =>
            activeHookOriginAls.run(stepHookOrigin, () =>
              catchHandler(engine, value, catchNext),
            ),
          )
          .then(rawCaught => {
            const stripResultFn = resolveStripResultForSite(event, site)
            const returned =
              step.isCore !== true &&
              stripResultFn !== undefined &&
              isEventRecord(rawCaught)
                ? stripResultFn(rawCaught, downstreamResults, {
                    name: step.name,
                  })
                : rawCaught
            runNode.entry = Object.freeze({
              index,
              plugin: step.name,
              tier: stepTier,
              event: needle,
              outcome: 'caught',
              ms: Math.max(0, performance.now() - stepStarted),
              received: value,
              returned,
            })
            return returned
          })
      })
      .finally(() => leaveModule(step.name))
  }
  const rootTraceNode: HookTraceNode = {}
  return hookEvalAls.run(true, () =>
    callAt(0, payload, EMPTY_HOP_FLOORS, rootTraceNode),
  )
}

/**
 * Worker-local `engine.create` runner: runs against this thread's `pluginEngine`
 * and returns plain serializable interface metadata (never functions).
 */
export async function runEngineCreateLocalInProcess(
  payload: Record<string, unknown>,
  environments?: readonly string[],
): Promise<{ interfaces: Record<string, string[]> }> {
  const core = runtimeBridge.buildPluginEngine({ name: 'core' })
  const coreKeys = new Set(Object.keys(core))
  const out = await runFunctionHookChain(
    'engine.create',
    payload,
    async () => core,
    undefined,
    environments,
  )
  const interfaces: Record<string, string[]> = {}
  if (isEventRecord(out)) {
    const extraTable: Record<string, Record<string, unknown>> = {}
    for (const [noun, methods] of Object.entries(out)) {
      if (coreKeys.has(noun) || !isEventRecord(methods)) continue
      const methodNames = Object.entries(methods)
        .filter(([, fn]) => typeof fn === 'function')
        .map(([name]) => name)
      if (methodNames.length > 0) {
        interfaces[noun] = methodNames
        extraTable[noun] = methods
      }
    }
    if (Object.keys(extraTable).length > 0 && environments) {
      for (const envId of environments) {
        if (!fhState().finalizedEnvironments.has(envId)) {
          setOwnedTable(envId, {
            ...(fhState().ownedTables.get(envId) ?? {}),
            ...extraTable,
          })
        }
      }
    }
  }
  return { interfaces }
}

/** densable `engine.create` fold — initializes `$` extensions (e.g. `cc-plugin-telemetry` batcher). */
export async function runEngineCreateFold(): Promise<unknown> {
  const remaining = fhState()
    .loadedModules.filter(mod => mod.status !== 'unloaded')
    .map(mod => mod.name)
  const tried = new Set<string>()
  let folded: unknown
  while (true) {
    const activeMods = fhState().loadedModules.filter(
      mod => mod.status !== 'unloaded' && remaining.includes(mod.name),
    )
    const payload: Record<string, unknown> = {
      plugins: activeMods.map(mod => mod.name),
    }
    const hookingMods = activeMods.filter(
      mod =>
        !tried.has(mod.name) &&
        (mod.hooks ?? []).some(
          hook =>
            functionHookPatternMatches(hook.pattern, 'engine.create') &&
            matcherAllows(
              hook.matcher,
              payload,
              'engine.create',
              isBuiltinTierMod(mod),
            ),
        ),
    )
    if (hookingMods.length === 0 && tried.size === 0) return undefined
    const useWorker = Boolean(
      fhState().workerOwnsDispatch && fhState().functionHooksWorker,
    )
    const nativeHooking = hookingMods
      .filter(mod => !(useWorker && mod.native !== true))
      .map(mod => mod.name)
    const workerHooking = useWorker
      ? hookingMods.filter(mod => mod.native !== true).map(mod => mod.name)
      : []
    try {
      if (nativeHooking.length > 0) {
        folded = await runFunctionHookChain(
          'engine.create',
          payload,
          async () => runtimeBridge.buildPluginEngine({ name: 'core' }),
          undefined,
          nativeHooking,
        )
      }
      const createWorker = fhState().functionHooksWorker
      if (workerHooking.length > 0 && createWorker) {
        const workerReply = await createWorker.engineCreate(
          payload,
          workerHooking,
        )
        if (folded === undefined) folded = workerReply.returned
      }
      return folded
    } catch (err) {
      const failed =
        hookingMods.find(mod => !tried.has(mod.name)) ?? hookingMods[0]
      if (failed === undefined) throw err
      const reason = err instanceof Error ? err.message : String(err)
      logForDebugging(
        `hooks module ${failed.name} failed in engine.create: ${reason}; unloaded, $ built again without it`,
        { level: 'error' },
      )
      reportHeadlessInlineModStderr(
        { name: failed.name, source: failed.pluginStorageId },
        `failed in engine.create: ${reason}; unloaded`,
      )
      tried.add(failed.name)
      await runtimeBridge.retireModule(failed.name)
      runtimeBridge.unloadModule(failed.name)
      const failedAt = remaining.indexOf(failed.name)
      if (failedAt >= 0) remaining.splice(failedAt, 1)
    }
  }
}

/**
 * densable streaming hook chain (`turn.step`, `process.spawn`) — each matching
 * async-generator hook yields from `next(event)` and returns its generator completion.
 */
export async function* runFunctionHookStreamChain<TChunk, TReturn = unknown>(
  event: string,
  payload: Record<string, unknown>,
  tail: (
    event: Record<string, unknown>,
  ) => AsyncGenerator<TChunk, TReturn, unknown>,
  only?: string,
  environments?: readonly string[],
): AsyncGenerator<TChunk, TReturn, unknown> {
  const needle = event.includes('.') ? event : `classic.${event}`
  const rawMatched = fhState().loadedModules.flatMap(mod => {
    if (only !== undefined && mod.name !== only) return []
    if (environments !== undefined && !environments.includes(mod.name))
      return []
    if (mod.status === 'unloaded') return []
    if (
      mod.status === 'retiring' &&
      (fhState().inFlightByModule.get(mod.name) ?? 0) === 0
    ) {
      return []
    }
    const builtin = isBuiltinTierMod(mod)
    return (mod.hooks ?? [])
      .map((hook, registration) => ({ hook, registration }))
      .filter(({ hook }) => functionHookPatternMatches(hook.pattern, needle))
      .filter(({ hook }) =>
        matcherAllows(hook.matcher, payload, needle, builtin),
      )
      .map(({ hook, registration }) => ({ mod, hook, registration }))
  })
  const collapseWorkerSteps = Boolean(
    fhState().workerOwnsDispatch && fhState().functionHooksWorker,
  )
  const matched = collapseWorkerSteps
    ? rawMatched.filter((entry, idx) => {
        if (entry.mod.native === true) return true
        const prev = rawMatched[idx - 1]
        return prev === undefined || prev.mod.name !== entry.mod.name
      })
    : rawMatched
  if (matched.length === 0) {
    return yield* tail(payload)
  }
  let tailEntered = false
  const wrappedTail = async function* (
    finalEvent: Record<string, unknown>,
  ): AsyncGenerator<TChunk, TReturn, unknown> {
    tailEntered = true
    return yield* tail(finalEvent)
  }
  const budgetMs = budgetMsForHookEvent(event)
  const outerHookOrigin = activeHookOriginAls.getStore() ?? []
  const stepAt = (
    index: number,
    value: Record<string, unknown>,
  ): AsyncGenerator<TChunk, TReturn, unknown> => {
    const step = matched[index]
    if (step === undefined) return wrappedTail(value)
    const nextGen = (passed?: unknown) =>
      stepAt(index + 1, isEventRecord(passed) ? passed : value)
    const stepDeadline = Date.now() + budgetMs
    Object.assign(nextGen, {
      is: (pattern: string) => functionHookPatternMatches(pattern, needle),
      origin: ENGINE_HOOK_ORIGIN,
      event,
      trace: EMPTY_HOOK_TRACE,
    })
    Object.defineProperty(nextGen, 'budget', {
      get: () => makeStepBudget(budgetMs, stepDeadline),
      enumerable: true,
    })
    const workerClient = fhState().functionHooksWorker
    if (
      step.mod.native !== true &&
      fhState().workerOwnsDispatch &&
      workerClient
    ) {
      return (async function* (): AsyncGenerator<TChunk, TReturn, unknown> {
        enterModule(step.mod.name)
        try {
          return yield* workerClient.stream<TChunk, TReturn>(
            event,
            value,
            [step.mod.name],
            onward => nextGen(onward),
            step.mod.name,
          )
        } catch (err) {
          if (tailEntered) throw err
          logForDebugging(
            `${step.mod.name}: ${event} stream hook threw (${describeThrown(err)}); continuing beneath`,
            { level: 'warn' },
          )
          return yield* nextGen(value)
        } finally {
          leaveModule(step.mod.name)
        }
      })()
    }
    const engine = runtimeBridge.buildPluginEngine(step.mod)
    const stepHookOrigin: readonly HookOriginEntry[] = [
      ...outerHookOrigin,
      { plugin: step.mod.name, registration: step.registration },
    ]
    return (async function* (): AsyncGenerator<TChunk, TReturn, unknown> {
      enterModule(step.mod.name)
      try {
        const iter = activeHookOriginAls.run(stepHookOrigin, () =>
          step.hook.hook(
            engine,
            value,
            nextGen as unknown as Parameters<FunctionHookHandler>[2],
          ),
        ) as AsyncGenerator<TChunk, TReturn, unknown>
        if (
          iter !== null &&
          typeof iter === 'object' &&
          typeof iter.next === 'function'
        ) {
          return yield* iter
        }
        return yield* nextGen(value)
      } catch (err) {
        if (tailEntered) throw err
        logForDebugging(
          `${step.mod.name}: ${event} stream hook threw (${describeThrown(err)}); continuing beneath`,
          { level: 'warn' },
        )
        return yield* nextGen(value)
      } finally {
        leaveModule(step.mod.name)
      }
    })()
  }
  return yield* stepAt(0, payload)
}

/** densable `ra` — `telemetry.log` pins `to` (`ke(["to"])` + `checkArgument`). */
const TELEMETRY_LOG_SITE: FunctionHookHopSite = {
  restoreArgument: (passed, original) =>
    !Object.hasOwn(passed, 'to') && Object.hasOwn(original, 'to')
      ? { ...passed, to: original.to }
      : passed,
  checkArgument: (passed, original) =>
    passed.to === original.to ? undefined : 'a changed to (pinned)',
}

/**
 * densable `ya("telemetry.log", { origin, signal })(entry)` + `oQ` + `ZJ.core`:
 * default `to` is `'anthropic'`; when `finalEntry.to === 'collector'` and the
 * road signal is not aborted, `ZJ.core` emits the collector entry to OTEL.
 */
export function dispatchTelemetryLog(
  entry: Record<string, unknown>,
  options?: {
    plugin?: string
    signal?: AbortSignal
  },
): Promise<unknown> {
  const normalized: Record<string, unknown> =
    entry.to === 'collector' ? entry : { ...entry, to: entry.to ?? 'anthropic' }
  const origin = resolveHookCallOrigin(options?.plugin)
  const signal = options?.signal
  const run = () =>
    runFunctionHookChain(
      'telemetry.log',
      normalized,
      async rawFinal => {
        const candidate = isEventRecord(rawFinal) ? rawFinal : normalized
        const finalEntry =
          TELEMETRY_LOG_SITE.restoreArgument?.(candidate, normalized) ??
          candidate
        const problem = TELEMETRY_LOG_SITE.checkArgument?.(
          finalEntry,
          normalized,
        )
        if (problem !== undefined) {
          throw new Error(`next() passed an argument with ${problem}`)
        }
        if (finalEntry.to === 'collector' && !signal?.aborted) {
          emitCollectorTelemetryEntry(finalEntry)
        }
        return { value: undefined }
      },
      undefined,
      undefined,
      {
        origin,
        signal,
        site: TELEMETRY_LOG_SITE,
      },
    )
  if (normalized.to === 'collector') {
    return collectorTelemetryDispatchAls.run(true, run)
  }
  return run()
}

const DEFAULT_COLLECTOR_TELEMETRY_ROAD = {
  send: (entry: OTelCollectorLogEntry, signal: AbortSignal) =>
    dispatchTelemetryLog(entry, { signal }),
  isCollectorHooked: () =>
    collectorTelemetryDispatchAls.getStore() !== true &&
    hasMatchingFunctionHook('telemetry.log', { to: 'collector' }),
}

/** densable `Xue.setRoad(R)` — bind host collector road to `telemetry.log`. */
export function installDefaultCollectorTelemetryRoad(): void {
  collectorTelemetryRoad.setRoad(DEFAULT_COLLECTOR_TELEMETRY_ROAD)
}

function enterModule(name: string): void {
  fhState().inFlightByModule.set(
    name,
    (fhState().inFlightByModule.get(name) ?? 0) + 1,
  )
}

function leaveModule(name: string): void {
  const next = (fhState().inFlightByModule.get(name) ?? 1) - 1
  if (next <= 0) fhState().inFlightByModule.delete(name)
  else fhState().inFlightByModule.set(name, next)
  const mod = fhState().loadedModules.find(item => item.name === name)
  if (mod?.status === 'retiring' && next <= 0) runtimeBridge.unloadModule(name)
}

runtimeBridge.onHookFailed = report => {
  noteHookSkipFirst(fillUnappliedRewriteEffect(report))
}
