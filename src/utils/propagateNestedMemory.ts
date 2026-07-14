/**
 * Official runAgent cleanup step `propagateNestedMemory` (portable).
 *
 * When coordinator mode + CLAUDE_CODE_COORDINATOR_PROPAGATE_NESTED_MEMORY:
 * paths the subagent loaded as nested memory (CLAUDE.md / CLAUDE.local.md)
 * are remapped out of `.claude/worktrees/<name>/` and queued onto the parent
 * as pendingNestedMemoryTriggers so the parent turn can re-attach them.
 */

import { basename, join, resolve, sep } from 'path'
import { isCoordinatorMode } from '../coordinator/coordinatorMode.js'
import { logForDebugging } from './debug.js'
import { shouldPropagateNestedMemory } from './coordinatorEnv.js'

const NESTED_MEMORY_BASENAMES = new Set(['CLAUDE.md', 'CLAUDE.local.md'])

/**
 * Official cTy — map a worktree-scoped nested memory path back to the
 * primary checkout. Paths under an explicit worktreePath that are not under
 * `.claude/worktrees/` are skipped (return null). Paths outside any worktree
 * layout are returned unchanged.
 */
export function mapWorktreeNestedMemoryPath(
  filePath: string,
  worktreePath?: string,
): string | null {
  const marker = `${sep}.claude${sep}worktrees${sep}`
  const idx = filePath.indexOf(marker)
  if (idx < 0) {
    if (worktreePath && filePath.startsWith(worktreePath + sep)) {
      return null
    }
    return filePath
  }
  const root = filePath.slice(0, idx)
  const after = filePath.slice(idx + marker.length)
  const slash = after.indexOf(sep)
  if (slash < 0) return null
  const relative = after.slice(slash + 1)
  const mapped = join(root, relative)
  const resolvedRoot = resolve(root)
  if (!resolve(mapped).startsWith(resolvedRoot + sep)) return null
  return mapped
}

export function isNestedMemoryBasename(filePath: string): boolean {
  return NESTED_MEMORY_BASENAMES.has(basename(filePath))
}

/**
 * Drain parent pendingNestedMemoryTriggers into nestedMemoryAttachmentTriggers
 * (official oFy prefix). Only for the root agent (no agentId).
 */
export function mergePendingNestedMemoryTriggers(context: {
  agentId?: string
  nestedMemoryAttachmentTriggers?: Set<string>
  pendingNestedMemoryTriggers?: Set<string>
}): void {
  if (context.agentId) return
  const pending = context.pendingNestedMemoryTriggers
  const triggers = context.nestedMemoryAttachmentTriggers
  if (!pending || !triggers || pending.size === 0) return
  for (const path of pending) {
    triggers.add(path)
  }
  pending.clear()
}

/**
 * Official cleanup body for propagateNestedMemory.
 * Mutates parent.pendingNestedMemoryTriggers when the gate is on.
 */
export function propagateNestedMemoryFromChild(input: {
  parent: {
    pendingNestedMemoryTriggers?: Set<string>
    loadedNestedMemoryPaths?: Set<string>
  }
  childLoadedNestedMemoryPaths?: Iterable<string>
  worktreePath?: string
  /** Injected for tests; defaults to isCoordinatorMode(). */
  isCoordinator?: boolean
  env?: NodeJS.ProcessEnv
}): void {
  const isCoordinator = input.isCoordinator ?? isCoordinatorMode()
  if (!isCoordinator || !shouldPropagateNestedMemory(input.env)) {
    return
  }
  const pending = input.parent.pendingNestedMemoryTriggers
  if (!pending) {
    logForDebugging(
      'propagateNestedMemory: parent context has no pendingNestedMemoryTriggers; skipping',
    )
    return
  }
  const parentLoaded = input.parent.loadedNestedMemoryPaths
  for (const path of input.childLoadedNestedMemoryPaths ?? []) {
    if (!isNestedMemoryBasename(path)) continue
    const mapped = mapWorktreeNestedMemoryPath(path, input.worktreePath)
    if (mapped === null) continue
    if (parentLoaded?.has(mapped)) continue
    pending.add(mapped)
  }
}
