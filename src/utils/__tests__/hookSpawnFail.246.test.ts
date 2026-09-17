/**
 * densable 2.1.246 #23 — hook spawn-fail contract (official kwe catch):
 * debug `Hook command failed to spawn (${hookName})` +
 * `Error occurred while executing hook command: ${Y(err)}` + spawnFailed.
 * Plugin-root substitution happens before spawn so Y(err) sees the resolved path.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const hooksSrc = readFileSync(join(import.meta.dir, '../hooks.ts'), 'utf8')

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
