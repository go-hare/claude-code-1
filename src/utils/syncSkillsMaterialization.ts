/**
 * Official Nit / gpo / Dsd densable — SYNC_SKILLS materialization wait registry.
 *
 * Official SkillTool waits on a per-skill promise when CLAUDE_CODE_SYNC_SKILLS
 * is on, so remote skill materialization can finish before invoke. Full
 * download/materialize stream remains denser; this densifies the wait gate +
 * registry so denser producers can register and SkillTool can await.
 */

import {
  isSyncSkillsEnabled,
  resolveSyncSkillsWaitTimeoutMs,
} from './residualFinalEnvGates.js'

export type SyncSkillMaterializationResult =
  | { ok: true }
  | { ok: false; reason: string }

type Pending = {
  promise: Promise<SyncSkillMaterializationResult>
  resolve: (r: SyncSkillMaterializationResult) => void
}

const pendingBySkill = new Map<string, Pending>()

/**
 * Official Dsd — register (or replace) a materialization waiter for skill name.
 * Returns the resolve callback for denser producers.
 */
export function registerSyncSkillMaterialization(
  skillName: string,
): (result: SyncSkillMaterializationResult) => void {
  let resolve!: (r: SyncSkillMaterializationResult) => void
  const promise = new Promise<SyncSkillMaterializationResult>(r => {
    resolve = r
  })
  pendingBySkill.set(skillName, { promise, resolve })
  return resolve
}

/**
 * Official Dsd producer densable — register a waiter, run work, settle result.
 * When SYNC_SKILLS is off, runs work without registering (SkillTool wait is
 * already a no-op). Full remote download stream remains denser; this is the
 * portable register→work→resolve shell denser hosts can call.
 */
export async function runSyncSkillMaterialization(
  skillName: string,
  work: () =>
    | Promise<SyncSkillMaterializationResult>
    | SyncSkillMaterializationResult,
  input?: { env?: NodeJS.ProcessEnv },
): Promise<SyncSkillMaterializationResult> {
  if (!isSyncSkillsEnabled(input?.env)) {
    try {
      return await work()
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }
  const resolve = registerSyncSkillMaterialization(skillName)
  try {
    const result = await work()
    resolve(result)
    return result
  } catch (error) {
    const result: SyncSkillMaterializationResult = {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }
    resolve(result)
    return result
  }
}

/**
 * Official gpo — wait for skill materialization when SYNC_SKILLS is on.
 * Returns {ok:true} immediately when env off or no pending registration.
 * Official Pbf densable: race against SYNC_SKILLS_WAIT_TIMEOUT_MS (default 5s).
 */
export async function waitForSyncSkillMaterialization(
  skillName: string,
  input?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<SyncSkillMaterializationResult> {
  if (!isSyncSkillsEnabled(input?.env)) {
    return { ok: true }
  }
  const pending = pendingBySkill.get(skillName)
  if (!pending) {
    return { ok: true }
  }
  const timeoutMs =
    input?.timeoutMs ?? resolveSyncSkillsWaitTimeoutMs(input?.env)
  try {
    if (!(timeoutMs > 0)) {
      return await pending.promise
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        pending.promise,
        new Promise<SyncSkillMaterializationResult>(resolve => {
          timer = setTimeout(
            () =>
              resolve({
                ok: false,
                reason: `wait timed out after ${timeoutMs}ms`,
              }),
            timeoutMs,
          )
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  } finally {
    pendingBySkill.delete(skillName)
  }
}

/** Test helper — clear all pending materializations. */
export function clearSyncSkillMaterializations(): void {
  pendingBySkill.clear()
}

/**
 * Format official not-materialized error:
 * `Skill X could not be downloaded (reason). Proceed without it.`
 */
export function formatSyncSkillNotMaterializedMessage(
  skillName: string,
  reason: string,
): string {
  return `Skill ${skillName} could not be downloaded (${reason}). Proceed without it.`
}
