/**
 * densable 2.1.239 #32 — gdc keepDotPrefix.
 * Official bash-path Tab (`!`) calls gdc(..., {keepDotPrefix:true}) so
 * `./script` is not rewritten to `script`. Default / @-path still strips.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearPathCache, getPathCompletions } from '../directoryCompletion.js'

const dir = mkdtempSync(join(tmpdir(), 'keep-dot-prefix-239-'))
mkdirSync(join(dir, 'src'))
writeFileSync(join(dir, 'script.sh'), '')
writeFileSync(join(dir, 'src', 'app.ts'), '')

afterEach(() => {
  clearPathCache()
})

describe('getPathCompletions densable 2.1.239 keepDotPrefix', () => {
  test('default strips leading ./', async () => {
    const items = await getPathCompletions('./sc', { basePath: dir })
    expect(items.map(i => i.id)).toContain('script.sh')
    expect(items.map(i => i.id)).not.toContain('./script.sh')
  })

  test('keepDotPrefix keeps leading ./ (bash ! Tab)', async () => {
    const items = await getPathCompletions('./sc', {
      basePath: dir,
      keepDotPrefix: true,
    })
    expect(items.map(i => i.id)).toContain('./script.sh')
  })

  test('nested ./src/ still keeps the prefix when keepDotPrefix', async () => {
    const items = await getPathCompletions('./src/a', {
      basePath: dir,
      keepDotPrefix: true,
    })
    expect(items.map(i => i.id)).toContain('./src/app.ts')
  })
})
