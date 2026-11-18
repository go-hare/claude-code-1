import { describe, expect, test } from 'bun:test'
import { createRootSession } from './sessionRoot.js'
import { createSessionHost } from './sessionHost.js'

describe('v2.1.290 #109 — sessionRoot isolationRoot & withProject inheritance', () => {
  test('setIsolationRoot updates isolationRoot and notifies subscribers', () => {
    const root = createRootSession({
      host: createSessionHost(),
      id: 'sess-1',
      project: {
        originalCwd: '/repo',
        projectRoot: '/repo',
        cwd: '/repo',
      },
    })

    expect(root.project.isolationRoot).toBeUndefined()
    let notifications = 0
    const unsub = root.subscribe(() => {
      notifications++
    })

    root.setIsolationRoot('/repo/.claude/worktrees/wt1')
    expect(root.project.isolationRoot).toBe('/repo/.claude/worktrees/wt1')
    expect(notifications).toBe(1)

    // No-op when setting same value
    root.setIsolationRoot('/repo/.claude/worktrees/wt1')
    expect(notifications).toBe(1)
    unsub()
  })

  test('withProject inherits isolationRoot unless explicitly overridden', () => {
    const root = createRootSession({
      host: createSessionHost(),
      id: 'sess-2',
      project: {
        originalCwd: '/repo',
        projectRoot: '/repo',
        cwd: '/repo',
        isolationRoot: '/repo/.claude/worktrees/wt-a',
      },
    })

    const inherited = root.withProject({ cwd: '/repo/sub' })
    expect(inherited.project.cwd).toBe('/repo/sub')
    expect(inherited.project.isolationRoot).toBe('/repo/.claude/worktrees/wt-a')

    const overridden = root.withProject({
      cwd: '/repo/wt-b',
      isolationRoot: '/repo/wt-b',
    })
    expect(overridden.project.isolationRoot).toBe('/repo/wt-b')
  })
})
