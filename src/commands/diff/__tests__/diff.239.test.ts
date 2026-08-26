/**
 * densable 2.1.239 /diff — jDl + uH0.
 * GB-off default stays DiffDialog; fullscreen+GB (or dispatchedAsImmediate)
 * mounts ToggleDiffSidebar.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isCommandImmediate } from '../../../utils/immediateCommand.js'

const indexSrc = readFileSync(join(import.meta.dir, '../index.ts'), 'utf8')
const callSrc = readFileSync(join(import.meta.dir, '../diff.tsx'), 'utf8')
const replSrc = readFileSync(
  join(import.meta.dir, '../../../screens/REPL.tsx'),
  'utf8',
)
const slashSrc = readFileSync(
  join(
    import.meta.dir,
    '../../../utils/processUserInput/processSlashCommand.tsx',
  ),
  'utf8',
)

describe('/diff densable 2.1.239 jDl', () => {
  test('index is local-jsx with P6e description getter and wa/Vs immediate', async () => {
    const mod = await import('../index.js')
    const cmd = mod.default
    expect(cmd.name).toBe('diff')
    expect(cmd.type).toBe('local-jsx')
    expect(typeof cmd.description).toBe('string')
    expect(cmd.description).toBe('View uncommitted changes and per-turn diffs')
    expect(typeof cmd.immediate).toBe('function')
    // GB default false → immediate is false even in fullscreen
    expect(isCommandImmediate(cmd, '')).toBe(false)
    expect(indexSrc).toContain('get description()')
    expect(indexSrc).toContain(
      'Toggle the diff panel showing uncommitted changes',
    )
  })

  test('uH0 and dispatchedAsImmediate hosts', () => {
    expect(callSrc).toContain('getIsRemoteMode()')
    expect(callSrc).toContain('isFullscreenEnvEnabled()')
    expect(callSrc).toContain('isWillowCrateEnabled()')
    expect(callSrc).toContain('context.dispatchedAsImmediate')
    expect(replSrc).toContain('dispatchedAsImmediate: true')
    expect(slashSrc).toContain(
      'dispatchedAsImmediate: isCommandImmediate(command, argsForDispatch)',
    )
  })
})
