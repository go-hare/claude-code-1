/**
 * densable 2.1.246 #23 — hook spawn-fail contract (official kwe catch):
 * debug `Hook command failed to spawn (${hookName})` +
 * `Error occurred while executing hook command: ${Y(err)}` + spawnFailed.
 * Plugin-root substitution happens before spawn so Y(err) sees the resolved path.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const hooksSrc = [
  '../hooks.ts',
  '../hooks/hookCore.ts',
  '../hooks/hookShellRunner.ts',
  '../hooks/hookOutputProcessor.ts',
  '../hooks/hookConfigRegistry.ts',
  '../hooks/hookModelSlotPool.ts',
  '../hooks/hookEngine.ts',
  '../hooks/hookEntryExecutor.ts',
  '../hooks/hookOutsideReplEngine.ts',
  '../hooks/hookToolEvents.ts',
  '../hooks/hookSessionAndPromptEvents.ts',
  '../hooks/hookLifecycleEvents.ts',
]
  .map(rel => readFileSync(join(import.meta.dir, rel), 'utf8'))
  .join('\n')

describe('hook spawn fail (densable 2.1.246 #23)', () => {
  test('spawn-fail debug uses official wording', () => {
    expect(hooksSrc).toContain(
      'Hook command failed to spawn (${hookName}): ${errorMsg}',
    )
  })

  test('spawn-fail user string uses official wording', () => {
    expect(hooksSrc).toContain(
      'Error occurred while executing hook command: ${errorMsg}',
    )
  })

  test('spawn-fail returns spawnFailed: true', () => {
    expect(hooksSrc).toContain('spawnFailed: true')
  })

  test('plugin root is substituted on the command before spawn', () => {
    expect(hooksSrc).toContain('${CLAUDE_PLUGIN_ROOT}')
    expect(hooksSrc).toContain('command = subPluginVars(command)')
  })
})
