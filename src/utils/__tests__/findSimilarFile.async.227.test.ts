/**
 * densable 2.1.227 kmt — findSimilarFile is async (readdir) for fewer event-loop stalls.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { findSimilarFile } from '../file.js'

describe('findSimilarFile async', () => {
  const root = join(tmpdir(), `cc-find-similar-${process.pid}-${Date.now()}`)

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('returns sibling with different extension', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'foo.ts'), 'export {}\n')
    const missing = join(root, 'foo.js')
    const similar = await findSimilarFile(missing)
    expect(similar).toBe('foo.ts')
  })

  test('returns undefined when dir missing', async () => {
    expect(await findSimilarFile(join(root, 'nope', 'x.ts'))).toBeUndefined()
  })
})
