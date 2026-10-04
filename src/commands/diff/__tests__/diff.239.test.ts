/**
 * densable 2.1.283 /diff — D$e + G0t.
 * GB default (Bve / !tengu_jazzy_ripple) is on; description/immediate
 * follow fullscreen presentation, not willow crate.
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

describe('/diff densable 2.1.283 D$e', () => {
  test('index is local-jsx with G0t description getter and presentation immediate', async () => {
    const mod = await import('../index.js')
    const cmd = mod.default
    expect(cmd.name).toBe('diff')
    expect(cmd.type).toBe('local-jsx')
    expect(typeof cmd.description).toBe('string')
    expect(typeof cmd.immediate).toBe('function')
    expect(isCommandImmediate(cmd, '', 'inline')).toBe(false)
    expect(indexSrc).toContain('get description()')
    expect(indexSrc).toContain(
      'Toggle the diff panel showing uncommitted changes',
    )
    expect(indexSrc).toContain('resolveDiffPresentation')
    expect(indexSrc).not.toContain('isWillowCrateEnabled')
  })

  test('call uses G0t(presentation, dispatchedAsImmediate) then toggleDiffPanel', () => {
    expect(callSrc).toContain('resolveDiffPresentation')
    expect(callSrc).toContain('toggleDiffPanel')
    expect(callSrc).toContain('DiffDialog')
    expect(callSrc).toContain('dispatchedAsImmediate')
    expect(replSrc).toContain('toggleDiffPanel:')
    expect(replSrc).toContain(
      "presentation: isFullscreenEnvEnabled() ? 'fullscreen' : 'inline'",
    )
    expect(slashSrc).toContain('context.presentation ??')
  })
})
