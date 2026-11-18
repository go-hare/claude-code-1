import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { MAX_ITEMS_PER_CALL, MAX_TOTAL_AGENTS } from '../constants.js'
import type {
  AgentProgressUpdate,
  AgentRunParams,
  AgentRunResult,
  JournalEntry,
  ProgressEvent,
} from '../types.js'
import type { EngineContext } from './context.js'
import { WorkflowAbortedError, WorkflowError } from './errors.js'
import { agentCallKey } from './journal.js'
import type { WorkflowHooks } from './script.js'

/** Sub-workflow executor for the workflow() hook (injected by runWorkflow to avoid circular dependencies). */
export type SubWorkflowRunner = (opts: {
  name?: string
  scriptPath?: string
  script?: string
  args?: unknown
}) => Promise<unknown>

type HookProgressInit =
  | { type: 'phase_started'; phase: string }
  | { type: 'phase_done'; phase: string }
  | {
      type: 'agent_started'
      agentId: number
      label?: string
      phase?: string
      model?: string
      agentType?: string
      isolation?: 'worktree'
      promptPreview?: string
    }
  | {
      type: 'agent_done'
      agentId: number
      label?: string
      phase?: string
      result: AgentRunResult
      cached?: boolean
    }
  | {
      type: 'agent_progress'
      agentId: number
      label?: string
      phase?: string
      tokenCount: number
      toolCount: number
      lastToolName?: string
    }
  | { type: 'log'; message: string }

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

/**
 * Official `NEe()` (2.1.296 #488) — resolve `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL`.
 * Returns `undefined` when unset or `"inherit"`.
 */
export function resolveWorkflowSubagentModel(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL?.trim()
  if (!raw || raw.toLowerCase() === 'inherit') {
    return undefined
  }
  return raw
}

function chainSlotKey(
  prev: string,
  op: string,
  arg: number | 'fork' | string | string[],
): string {
  const h = createHash('sha256')
    .update(prev)
    .update('\0')
    .update(op)
    .update('\0')
  if (typeof arg === 'number') {
    h.update(`slot:${arg}`)
  } else if (Array.isArray(arg)) {
    h.update('join')
    for (const k of arg) {
      h.update('\0').update(k)
    }
  } else {
    h.update(arg)
  }
  return h.digest('hex')
}

export function makeHooks(
  ctx: EngineContext,
  runSubWorkflow: SubWorkflowRunner,
): WorkflowHooks {
  const slotStorage = new AsyncLocalStorage<{ prev: string }>()
  const rootSlotState = { prev: '' }

  const enterSlotScope = (op: 'parallel' | 'pipeline') => {
    const parent = slotStorage.getStore() ?? rootSlotState
    const basePrev = parent.prev
    parent.prev = chainSlotKey(basePrev, op, 'fork')
    const slotStates: Array<{ prev: string } | undefined> = []
    return {
      inSlot<R>(index: number, fn: () => Promise<R>): Promise<R> {
        const state = { prev: chainSlotKey(basePrev, op, index) }
        slotStates[index] = state
        return slotStorage.run(state, fn)
      },
      join(): void {
        parent.prev = chainSlotKey(
          parent.prev,
          op,
          slotStates.map(s => s?.prev ?? ''),
        )
      },
    }
  }

  // All progress events auto-inject runId so the adapter can route them to the corresponding task (multiple concurrent workflows)
  const emit = (init: HookProgressInit): void => {
    ctx.ports.progressEmitter.emit({
      runId: ctx.runId,
      ...init,
    } as ProgressEvent)
  }

  const agent: WorkflowHooks['agent'] = async (prompt, opts = {}) => {
    const r = ctx.resources
    if (r.agentCountBox.value >= MAX_TOTAL_AGENTS) {
      throw new WorkflowError(
        `workflow exceeds total agent cap (${MAX_TOTAL_AGENTS})`,
      )
    }

    // Assign a unique id to each agent() call (including journal hits); stamp started/done so the reducer can associate them precisely
    const agentId = r.agentIdSeq.value++

    const params: AgentRunParams = { prompt, ...opts }
    const workflowSubagentModel = resolveWorkflowSubagentModel()
    const forceSubagentModel = isEnvTruthy(
      process.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE,
    )
    const ignoreReason =
      workflowSubagentModel !== undefined
        ? 'CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL is set'
        : forceSubagentModel
          ? 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE is on'
          : undefined
    if (params.model !== undefined && ignoreReason !== undefined) {
      ctx.ports.logger.warn?.(
        `Workflow agent model "${params.model}" ignored: ${ignoreReason}`,
      )
      params.model = workflowSubagentModel
    } else if (workflowSubagentModel !== undefined) {
      params.model = workflowSubagentModel
    }
    const key = agentCallKey(prompt, params)
    const label = opts.label as string | undefined
    const phase =
      (opts.phase as string | undefined) ?? ctx.currentPhase ?? undefined

    const activeSlot = slotStorage.getStore()
    const slotKey = activeSlot
      ? chainSlotKey(activeSlot.prev, 'agent', key)
      : undefined
    if (activeSlot && slotKey !== undefined) {
      activeSlot.prev = slotKey
      // Per-slot journal replay: look up by deterministic slotKey so parallel/pipeline
      // completion order or partial failure never invalidates sibling slots.
      const matchedEntry = ctx.journal.find(e => e.key === slotKey)
      if (matchedEntry !== undefined) {
        emit({
          type: 'agent_done',
          agentId,
          label,
          phase,
          result: matchedEntry.result,
          cached: true,
        })
        return resultToOutput(matchedEntry.result)
      }
    } else if (
      !ctx.journalInvalidated &&
      ctx.journalIndex < ctx.journal.length
    ) {
      // Journal hit -> return cached result directly
      const entry = ctx.journal[ctx.journalIndex]!
      if (entry.key === key) {
        ctx.journalIndex++
        emit({
          type: 'agent_done',
          agentId,
          label,
          phase,
          result: entry.result,
          cached: true,
        })
        return resultToOutput(entry.result)
      }
      // Divergence: discard subsequent journal entries; everything from here on runs live
      ctx.journalInvalidated = true
      ctx.journal = ctx.journal.slice(0, ctx.journalIndex)
      await ctx.ports.journalStore.truncate(ctx.runId)
    }

    let release: () => void
    try {
      release = await ctx.resources.semaphore.acquire(ctx.signal)
    } catch {
      // Queued wait during abort: the semaphore already removed the waiter and did not consume a permit
      throw new WorkflowAbortedError()
    }
    try {
      if (ctx.signal.aborted) throw new WorkflowAbortedError()
      // Budget check inside the semaphore critical section: a queued waiter sees the latest spent when woken,
      // otherwise N waiters enqueued while spent=0 all pass the check and overspend on wake-up without re-check.
      // Journal-hit path does not charge budget and needs no check.
      r.budget.assertCanSpend()

      const pending = ctx.ports.taskRegistrar.pendingAction(ctx.runId)
      if (pending?.kind === 'skip') {
        const result: AgentRunResult = { kind: 'skipped' }
        emit({ type: 'agent_done', agentId, label, phase, result })
        return null
      }

      ctx.resources.agentCountBox.value++
      // densable-shaped start fields: model/agentType/isolation/promptPreview for Desktop fold.
      emit({
        type: 'agent_started',
        agentId,
        label,
        phase,
        ...(params.model ? { model: params.model } : {}),
        ...(params.agentType ? { agentType: params.agentType } : {}),
        ...(params.isolation ? { isolation: params.isolation } : {}),
        promptPreview:
          typeof prompt === 'string' ? prompt.slice(0, 200) : undefined,
      })
      const registry = ctx.ports.agentAdapterRegistry
      // onProgress closure: the backend loop accumulates token/tool counts -> emits an agent_progress event (carrying agentId for association)
      const onProgress = (update: AgentProgressUpdate): void => {
        emit({ type: 'agent_progress', agentId, label, phase, ...update })
      }
      // Inject agent-level AbortController register/unregister: the backend creates the controller then calls
      // registerAgentAbort to inject ports-layer bindings; service.kill(runId, agentId) uses this to
      // precisely abort a single agent. When the registry is absent (agentRunner fallback path), there is no backend middle layer,
      // and agentAbortControllers at the ports layer is always empty — single-agent kill degrades to a no-op on this path.
      const adapterCtx = registry
        ? {
            host: ctx.host,
            signal: ctx.signal,
            runId: ctx.runId,
            agentId,
            onProgress,
            ...(ctx.ports.taskRegistrar.registerAgentAbort
              ? {
                  registerAgentAbort: (
                    id: number,
                    ac: AbortController,
                  ): void => {
                    ctx.ports.taskRegistrar.registerAgentAbort?.(
                      ctx.runId,
                      id,
                      ac,
                    )
                  },
                }
              : {}),
            ...(ctx.ports.taskRegistrar.unregisterAgentAbort
              ? {
                  unregisterAgentAbort: (id: number): void => {
                    ctx.ports.taskRegistrar.unregisterAgentAbort?.(
                      ctx.runId,
                      id,
                    )
                  },
                }
              : {}),
          }
        : null
      // resolve is outside the try: configuration errors (e.g. AdapterNotFoundError) propagate directly without retry —
      // this is a workflow configuration problem, not a transient backend failure; retrying is meaningless and would mask the bug.
      const adapter = registry ? registry.resolve(params) : null
      const invokeBackend = (): Promise<AgentRunResult> =>
        adapter
          ? adapter.run(params, adapterCtx!)
          : ctx.ports.agentRunner.runAgentToResult(params, ctx.host)

      // Auto-retry once on failure: dead (terminal API error after retries) or a non-abort throw
      // both get one retry chance; WorkflowAbortedError (kill) is not retried — it is the user's intent.
      // If retry still fails: dead stays dead; a throw degrades to dead (one agent must not take down the workflow).
      // budget is not double-charged: dead does not call addOutputTokens; retry-ok charges once (at the final ok).
      // dead.reason is passed through to the log: no-structured-output (the agent's final text block did not produce plain-object JSON)
      // is a high-frequency cause of death; logging detail lets you immediately see what the agent last said.
      // detail is wrapped with String() defensively: old journals or third-party adapters may write non-strings (corrupted data),
      // and calling .slice directly would throw a TypeError that pierces the logging path.
      let result: AgentRunResult
      try {
        result = await invokeBackend()
        if (result.kind === 'dead') {
          const detailStr =
            typeof result.detail === 'string' ? result.detail : ''
          ctx.ports.logger.warn?.(
            `agent "${label ?? `#${agentId}`}" returned dead` +
              (result.reason ? ` (${result.reason})` : '') +
              (detailStr ? `: ${detailStr.slice(0, 150)}` : '') +
              '; retrying once',
          )
          result = await invokeBackend()
        }
      } catch (e) {
        if (e instanceof WorkflowAbortedError) throw e
        const eMsg = e instanceof Error ? e.message : String(e)
        ctx.ports.logger.warn?.(
          `agent "${label ?? `#${agentId}`}" threw (${eMsg}); retrying once`,
        )
        try {
          result = await invokeBackend()
        } catch (e2) {
          if (e2 instanceof WorkflowAbortedError) throw e2
          // Retry still threw: degrade to dead (keep the workflow going; hooks.agent returns null)
          result = {
            kind: 'dead',
            reason: 'runagent-threw',
            detail: e2 instanceof Error ? e2.message : String(e2),
          }
        }
      }
      if (result.kind === 'ok') {
        ctx.resources.budget.addOutputTokens(result.usage.outputTokens)
      }
      emit({ type: 'agent_done', agentId, label, phase, result })

      const entry: JournalEntry = {
        key: slotKey ?? key,
        seq: agentId,
        result,
      }
      // Key point: push order = completion order (not call order); read() already re-sorts by seq,
      // so during resume the call order aligns with the journal order and the key index stays stable.
      ctx.journal.push(entry)
      if (!activeSlot) {
        ctx.journalIndex++
      }
      await ctx.ports.journalStore.append(ctx.runId, entry)
      return resultToOutput(result)
    } finally {
      release()
    }
  }

  const parallel: WorkflowHooks['parallel'] = async thunks => {
    if (thunks.length > MAX_ITEMS_PER_CALL) {
      throw new WorkflowError(
        `parallel exceeds the per-call items cap (${MAX_ITEMS_PER_CALL})`,
      )
    }
    const scope = enterSlotScope('parallel')
    try {
      return await Promise.all(
        thunks.map((t, i) =>
          scope.inSlot(i, async () => {
            try {
              return await t()
            } catch (e) {
              // The "null on error" contract is unchanged, but it should log — otherwise the workflow author cannot locate why an agent failed
              ctx.ports.logger.warn?.(
                `parallel thunk #${i} failed: ${(e as Error).message}`,
              )
              return null
            }
          }),
        ),
      )
    } finally {
      scope.join()
    }
  }

  const pipeline: WorkflowHooks['pipeline'] = async <T, R>(
    items: readonly T[],
    ...stages: Array<
      (prev: unknown, item: T, index: number) => Promise<unknown>
    >
  ): Promise<Array<R | null>> => {
    if (items.length > MAX_ITEMS_PER_CALL) {
      throw new WorkflowError(
        `pipeline exceeds the per-call items cap (${MAX_ITEMS_PER_CALL})`,
      )
    }
    const scope = enterSlotScope('pipeline')
    try {
      return await Promise.all(
        items.map((item, index) =>
          scope.inSlot(index, async (): Promise<R | null> => {
            try {
              let prev: unknown = item
              for (const stage of stages) {
                prev = await stage(prev, item, index)
              }
              return prev as R
            } catch (e) {
              ctx.ports.logger.warn?.(
                `pipeline item #${index} failed: ${(e as Error).message}`,
              )
              return null
            }
          }),
        ),
      )
    } finally {
      scope.join()
    }
  }

  const phase: WorkflowHooks['phase'] = title => {
    if (ctx.currentPhase) {
      emit({ type: 'phase_done', phase: ctx.currentPhase })
    }
    ctx.currentPhase = title
    emit({ type: 'phase_started', phase: title })
  }

  const log: WorkflowHooks['log'] = message => {
    emit({ type: 'log', message })
  }

  const workflow: WorkflowHooks['workflow'] = async (nameOrRef, args) => {
    if (ctx.resources.depth >= 1) {
      throw new WorkflowError('workflow() nesting allows only one level')
    }
    const sub: Parameters<SubWorkflowRunner>[0] =
      typeof nameOrRef === 'string'
        ? { name: nameOrRef }
        : { scriptPath: nameOrRef.scriptPath }
    return runSubWorkflow({ ...sub, args })
  }

  return { agent, parallel, pipeline, phase, log, workflow }
}

function resultToOutput(result: AgentRunResult): unknown {
  return result.kind === 'ok' ? result.output : null
}
