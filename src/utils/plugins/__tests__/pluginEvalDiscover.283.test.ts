import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  discoverEvalCaseDirs,
  emptyCaseFilterText,
  filterEvalCaseDirs,
  matchesCaseFilter,
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

  test('densable fd: --tag is OR-any; tags:[foo] excluded by bar, included by foo', () => {
    const identity = { name: 'tagged', tags: ['foo'] }
    expect(matchesCaseFilter(identity, { tags: ['bar'] })).toBe(false)
    expect(matchesCaseFilter(identity, { tags: ['foo'] })).toBe(true)
    expect(matchesCaseFilter(identity, { tags: ['bar', 'foo'] })).toBe(true)
  })

  test('filterEvalCaseDirs reads case.yaml tags (gold ma/fd)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-tag-'))
    tempDirs.push(root)
    const tagged = join(root, 'evals', 'tagged')
    await mkdir(tagged, { recursive: true })
    await writeFile(join(tagged, 'case.yaml'), 'name: tagged\ntags: [foo]\n')
    const { caseDirs } = await discoverEvalCaseDirs(root, ['evals'])
    expect(await filterEvalCaseDirs(caseDirs, { tags: ['bar'] })).toEqual([])
    expect(await filterEvalCaseDirs(caseDirs, { tags: ['foo'] })).toEqual([
      tagged,
    ])
  })

  test('filterEvalCaseDirs reads prompt.md frontmatter tags', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-fm-'))
    tempDirs.push(root)
    const tagged = join(root, 'evals', 'prose')
    await mkdir(tagged, { recursive: true })
    await writeFile(
      join(tagged, 'prompt.md'),
      '---\ntags: [foo]\n---\n\ndo the thing\n',
    )
    const { caseDirs } = await discoverEvalCaseDirs(root, ['evals'])
    expect(await filterEvalCaseDirs(caseDirs, { tags: ['bar'] })).toEqual([])
    expect(await filterEvalCaseDirs(caseDirs, { tags: ['foo'] })).toEqual([
      tagged,
    ])
  })

  test('densable _d: mocks/ reserved — cases there are skipped', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-mocks-'))
    tempDirs.push(root)
    await mkdir(join(root, 'evals', 'mocks', 'hidden'), { recursive: true })
    await writeFile(join(root, 'evals', 'mocks', 'hidden', 'prompt.md'), 'x')
    await mkdir(join(root, 'evals', 'ok'), { recursive: true })
    await writeFile(join(root, 'evals', 'ok', 'prompt.md'), 'x')
    const { caseDirs, skipped } = await discoverEvalCaseDirs(root, ['evals'])
    expect(caseDirs).toEqual([join(root, 'evals', 'ok')])
    expect(skipped.some(s => s.error.includes('mocks/ is reserved'))).toBe(true)
  })

  test('densable Ny: automounter /net spelling is refused', async () => {
    const { vetPluginEvalPath } = await import('../pluginEval/pathVet.js')
    await expect(
      vetPluginEvalPath('/tmp', '/net/host/foo', 'plugin eval'),
    ).rejects.toMatchObject({
      message: expect.stringContaining('is an automounter path'),
    })
  })
})
