import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  isNestedMemoryBasename,
  mapWorktreeNestedMemoryPath,
  mergePendingNestedMemoryTriggers,
  propagateNestedMemoryFromChild,
} from '../propagateNestedMemory.js'

describe('mapWorktreeNestedMemoryPath', () => {
  test('maps .claude/worktrees layout back to primary checkout', () => {
    const mapped = mapWorktreeNestedMemoryPath(
      join('/repo', '.claude', 'worktrees', 'agent-1', 'src', 'CLAUDE.md'),
    )
    expect(mapped).toBe(join('/repo', 'src', 'CLAUDE.md'))
  })

  test('returns null for non-worktree-layout paths under worktreePath', () => {
    expect(
      mapWorktreeNestedMemoryPath(
        join('/tmp', 'wt', 'src', 'CLAUDE.md'),
        join('/tmp', 'wt'),
      ),
    ).toBeNull()
  })

  test('returns path unchanged when not in worktree layout and no worktreePath', () => {
    expect(mapWorktreeNestedMemoryPath(join('/repo', 'CLAUDE.md'))).toBe(
      join('/repo', 'CLAUDE.md'),
    )
  })
})

describe('isNestedMemoryBasename', () => {
  test('only CLAUDE.md and CLAUDE.local.md', () => {
    expect(isNestedMemoryBasename(join('/a', 'CLAUDE.md'))).toBe(true)
    expect(isNestedMemoryBasename(join('/a', 'CLAUDE.local.md'))).toBe(true)
    expect(isNestedMemoryBasename(join('/a', 'README.md'))).toBe(false)
  })
})

describe('propagateNestedMemoryFromChild', () => {
  test('skips when not coordinator or env off', () => {
    const pending = new Set<string>()
    propagateNestedMemoryFromChild({
      parent: { pendingNestedMemoryTriggers: pending },
      childLoadedNestedMemoryPaths: [join('/repo', 'CLAUDE.md')],
      isCoordinator: false,
      env: { CLAUDE_CODE_COORDINATOR_PROPAGATE_NESTED_MEMORY: '1' },
    })
    expect(pending.size).toBe(0)

    propagateNestedMemoryFromChild({
      parent: { pendingNestedMemoryTriggers: pending },
      childLoadedNestedMemoryPaths: [join('/repo', 'CLAUDE.md')],
      isCoordinator: true,
      env: {},
    })
    expect(pending.size).toBe(0)
  })

  test('queues remapped CLAUDE.md when gate on', () => {
    const pending = new Set<string>()
    const parentLoaded = new Set<string>()
    propagateNestedMemoryFromChild({
      parent: {
        pendingNestedMemoryTriggers: pending,
        loadedNestedMemoryPaths: parentLoaded,
      },
      childLoadedNestedMemoryPaths: [
        join('/repo', '.claude', 'worktrees', 'a1', 'pkg', 'CLAUDE.md'),
        join('/repo', '.claude', 'worktrees', 'a1', 'pkg', 'README.md'),
        join('/repo', 'other', 'CLAUDE.local.md'),
      ],
      isCoordinator: true,
      env: { CLAUDE_CODE_COORDINATOR_PROPAGATE_NESTED_MEMORY: '1' },
    })
    expect(pending.has(join('/repo', 'pkg', 'CLAUDE.md'))).toBe(true)
    expect(pending.has(join('/repo', 'other', 'CLAUDE.local.md'))).toBe(true)
    expect(pending.size).toBe(2)
  })

  test('skips paths already loaded by parent', () => {
    const pending = new Set<string>()
    const parentLoaded = new Set([join('/repo', 'CLAUDE.md')])
    propagateNestedMemoryFromChild({
      parent: {
        pendingNestedMemoryTriggers: pending,
        loadedNestedMemoryPaths: parentLoaded,
      },
      childLoadedNestedMemoryPaths: [join('/repo', 'CLAUDE.md')],
      isCoordinator: true,
      env: { CLAUDE_CODE_COORDINATOR_PROPAGATE_NESTED_MEMORY: '1' },
    })
    expect(pending.size).toBe(0)
  })
})

describe('mergePendingNestedMemoryTriggers', () => {
  test('drains pending into triggers for root agent only', () => {
    const pending = new Set([join('/repo', 'CLAUDE.md')])
    const triggers = new Set<string>()
    mergePendingNestedMemoryTriggers({
      nestedMemoryAttachmentTriggers: triggers,
      pendingNestedMemoryTriggers: pending,
    })
    expect(triggers.has(join('/repo', 'CLAUDE.md'))).toBe(true)
    expect(pending.size).toBe(0)
  })

  test('no-op for subagents with agentId', () => {
    const pending = new Set([join('/repo', 'CLAUDE.md')])
    const triggers = new Set<string>()
    mergePendingNestedMemoryTriggers({
      agentId: 'agent-1' as never,
      nestedMemoryAttachmentTriggers: triggers,
      pendingNestedMemoryTriggers: pending,
    })
    expect(triggers.size).toBe(0)
    expect(pending.size).toBe(1)
  })
})
