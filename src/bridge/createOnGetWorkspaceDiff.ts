import { getEmptyToolPermissionContext } from '../Tool.js'
import type { ToolPermissionContext } from '../Tool.js'
import { buildWorkspaceDiffResponse } from './buildWorkspaceDiffResponse.js'
import {
  WORKSPACE_DIFF_RESULT_CACHE_MS,
  type WorkspaceDiffComputeBudget,
} from './workspaceDiffBudget.js'

type WorkspaceDiffResult = Awaited<
  ReturnType<typeof buildWorkspaceDiffResponse>
>

type InFlight = {
  sequence: number
  permissionContext: ToolPermissionContext
  pendingWaiters: number
  promise: Promise<WorkspaceDiffResult>
}

type Settled = {
  sequence: number
  settledAt: number
  permissionContext: ToolPermissionContext
  result: WorkspaceDiffResult
}

/**
 * densable 2.1.247 `cd` `onGetWorkspaceDiff:a?(e)=>{...ki(a,n,t)}`.
 * Cache + coalesce + pendingWaiters. Host falsy → callback omitted.
 */
export function createOnGetWorkspaceDiff(
  host: object | undefined,
  getToolPermissionContext: (() => ToolPermissionContext) | undefined,
  budget: WorkspaceDiffComputeBudget | undefined,
): ((signal: AbortSignal) => Promise<WorkspaceDiffResult>) | undefined {
  if (!host) return undefined

  const fallbackContext = getEmptyToolPermissionContext()
  let inFlight: InFlight | undefined
  let settled: Settled | undefined
  let sequence = 0

  return signal => {
    const permissionContext = getToolPermissionContext?.() ?? fallbackContext
    const cached = settled
    settled = undefined
    if (
      cached &&
      cached.permissionContext === permissionContext &&
      Date.now() - cached.settledAt <= WORKSPACE_DIFF_RESULT_CACHE_MS
    ) {
      return Promise.resolve(cached.result)
    }

    let current = inFlight
    if (!current || current.permissionContext !== permissionContext) {
      const job: InFlight = {
        sequence: ++sequence,
        permissionContext,
        pendingWaiters: 0,
        promise: buildWorkspaceDiffResponse(host, permissionContext, budget)
          .then(result => {
            if (
              job.pendingWaiters === 0 &&
              !(settled && settled.sequence > job.sequence)
            ) {
              settled = {
                sequence: job.sequence,
                settledAt: Date.now(),
                permissionContext,
                result,
              }
            }
            return result
          })
          .finally(() => {
            if (inFlight === job) inFlight = undefined
          }),
      }
      inFlight = job
      current = job
    }

    if (!signal.aborted) {
      current.pendingWaiters++
      signal.addEventListener(
        'abort',
        () => {
          current.pendingWaiters--
        },
        { once: true },
      )
    }
    return current.promise
  }
}
