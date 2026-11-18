import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('setup 2.1.300 alignment (#778)', () => {
  test('setup.ts resolves --plugin-dir paths and calls loadPluginHooks() before worktree creation', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'setup.ts'), 'utf8')
    const worktreeIdx = src.indexOf('if (worktreeEnabled)')
    const hasHookIdx = src.indexOf('hasWorktreeCreateHook()', worktreeIdx)
    const loadHooksIdx = src.indexOf('loadPluginHooks()', worktreeIdx)
    const resolveInlineIdx = src.indexOf('setInlinePlugins(', worktreeIdx)

    expect(worktreeIdx).toBeGreaterThan(-1)
    expect(resolveInlineIdx).toBeGreaterThan(worktreeIdx)
    expect(loadHooksIdx).toBeGreaterThan(resolveInlineIdx)
    expect(hasHookIdx).toBeGreaterThan(loadHooksIdx)
  })
})
