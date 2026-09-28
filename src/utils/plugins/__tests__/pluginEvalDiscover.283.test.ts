import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  discoverEvalCaseDirs,
  emptyCaseFilterText,
} from '../pluginEval/discoverCases.js'
import { parseEvalDirFlag } from '../pluginEval/evalDir.js'

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

describe('plugin eval case scan (densable $R / _d subset)', () => {
  test('emptyCaseFilterText interpolates --case and --tag', () => {
    expect(emptyCaseFilterText()).toBe('')
    expect(emptyCaseFilterText('foo')).toBe(' matching --case "foo"')
    expect(emptyCaseFilterText(undefined, ['a', 'b'])).toBe(
      ' matching --tag "a" --tag "b"',
    )
  })

  test('discovers case.yaml and prompt.md dirs, skips node_modules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-283-'))
    tempDirs.push(root)
    await mkdir(join(root, 'evals', 'alpha'), { recursive: true })
    await writeFile(join(root, 'evals', 'alpha', 'prompt.md'), 'x')
    await mkdir(join(root, 'evals', 'beta'), { recursive: true })
    await writeFile(join(root, 'evals', 'beta', 'case.yaml'), 'name: beta')
    await mkdir(join(root, 'evals', 'node_modules', 'skip'), {
      recursive: true,
    })
    await writeFile(
      join(root, 'evals', 'node_modules', 'skip', 'prompt.md'),
      'nope',
    )
    const { caseDirs } = await discoverEvalCaseDirs(root, ['evals'])
    expect(caseDirs.sort()).toEqual([
      join(root, 'evals', 'alpha'),
      join(root, 'evals', 'beta'),
    ])
  })

  test('parseEvalDirFlag refuses absolute and ..', () => {
    expect(parseEvalDirFlag('/tmp/evals').ok).toBe(false)
    expect(parseEvalDirFlag('../evals').ok).toBe(false)
    expect(parseEvalDirFlag('evals').ok).toBe(true)
  })
})
