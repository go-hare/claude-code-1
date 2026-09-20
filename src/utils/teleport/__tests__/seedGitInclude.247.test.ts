/**
 * densable 2.1.247 — `_583` `rr`/`ar` include walk (not many_includes shortcut).
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { isAbsolute, join, sep } from 'path'
import {
  expandIncludePath,
  includePathTargets,
  joinIfRelative,
  originFilePath,
  seedPathContains,
  walkSeedIncludeGraph,
} from '../seedGitInclude.js'

describe('densable rr/ar include walk', () => {
  test('T: child path is inside parent', () => {
    const root = process.cwd()
    expect(seedPathContains(root, join(root, 'src'))).toBe(true)
    expect(seedPathContains(root, root)).toBe(true)
    expect(seedPathContains(join(root, 'src'), root)).toBe(false)
  })

  test('x/cr/lr: file: origin and absolute include', () => {
    const tree = join(process.cwd(), 'repo')
    expect(joinIfRelative(tree, 'rel.cfg')).toBe(`${tree}${sep}rel.cfg`)
    expect(originFilePath('file:.git/config', tree)).toBe(
      `${tree}${sep}.git/config`,
    )
    expect(originFilePath('command:foo', tree)).toBeNull()
    const abs = join(tree, 'abs.cfg')
    expect(expandIncludePath(abs, 'file:.git/config', tree)).toBe(abs)
    expect(
      expandIncludePath('extra.cfg', 'file:.git/config', tree).endsWith(
        `${sep}extra.cfg`,
      ),
    ).toBe(true)
  })

  test('Ln keeps absolute include.path', () => {
    const tree = process.cwd()
    const abs = join(tree, 'other.gitconfig')
    expect(isAbsolute(abs)).toBe(true)
    expect(includePathTargets(abs, 'file:.git/config', tree)).toEqual([abs])
  })

  test('ar tooMany at official depth 8', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'seed-ar-'))
    const files = Array.from({ length: 9 }, (_, i) => join(dir, `i${i}.cfg`))
    await Promise.all(files.map(file => writeFile(file, '')))
    const walked = await walkSeedIncludeGraph(
      [files[0] ?? null],
      async file => {
        const i = files.indexOf(file)
        const next = files[i + 1]
        return { keys: [], targets: next === undefined ? [] : [next] }
      },
      async () => undefined,
    )
    expect(walked).toEqual({ tooMany: true })
  })

  test('ar FFFD target contributes', async () => {
    const walked = await walkSeedIncludeGraph(
      ['C:\\bad\uFFFD.cfg'],
      async () => ({ keys: [], targets: [] }),
      async () => undefined,
    )
    expect(walked).toEqual({ contributes: 'C:\\bad\uFFFD.cfg' })
  })
})
