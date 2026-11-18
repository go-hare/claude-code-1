import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../..')

describe('Wave 3 cross-file wiring (#969, #1170, #984, costMetadataPusher)', () => {
  test('src/cli/print.ts declares costMetadataPusher inside runHeadlessStreaming and wires #969', () => {
    const src = readFileSync(join(ROOT, 'src/cli/print.ts'), 'utf8')
    const streamingIdx = src.indexOf('function runHeadlessStreaming')
    expect(streamingIdx).toBeGreaterThan(-1)
    const streamingBody = src.slice(streamingIdx)
    expect(streamingBody).toContain(
      'const costMetadataPusher = new CostMetadataPusher(',
    )
    expect(streamingBody).toContain('costMetadataPusher.pushIfChanged()')
    expect(streamingBody).toContain('setBackgroundCeilingProvider(')
    expect(streamingBody).toContain('setSpawnedTurnTakenCallback(')
    expect(streamingBody).toContain('markSessionStoppedForPluginInput()')
  })

  test('src/query.ts #984 uses shouldSuppressInterruptionMessage instead of missing hasImmediateInterruptionMessage', () => {
    const src = readFileSync(join(ROOT, 'src/query.ts'), 'utf8')
    expect(src).not.toContain('hasImmediateInterruptionMessage')
    expect(src).toContain('!shouldSuppressInterruptionMessage(')
  })

  test('src/main.tsx #1170 registers ultrareview [target] with --trust-workspace', () => {
    const src = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8')
    expect(src).toContain(".command('ultrareview [target]')")
    expect(src).toContain("'--trust-workspace'")
    expect(src).toContain('checkUltrareviewWorkspaceTrust')
  })
})
