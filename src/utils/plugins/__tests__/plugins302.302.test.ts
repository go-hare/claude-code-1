import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getFsImplementation } from '../../fsOperations.js'
import { calculatePluginVersion, getGitCommitSha } from '../pluginVersioning.js'
import { walkPluginMarkdown } from '../walkPluginMarkdown.js'

describe('plugins v2.1.302 (#903, #920)', () => {
  test('#903: getGitCommitSha and calculatePluginVersion resolve reftable repo HEAD', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reftable-plugin-'))
    try {
      execFileSync('git', ['init', '--ref-format=reftable', dir], {
        stdio: 'ignore',
      })
      execFileSync('git', [
        '-C',
        dir,
        'config',
        'user.email',
        'test@example.com',
      ])
      execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'])
      writeFileSync(join(dir, 'README.md'), 'hello\n')
      execFileSync('git', ['-C', dir, 'add', '.'])
      execFileSync('git', ['-C', dir, 'commit', '-m', 'init'], {
        stdio: 'ignore',
      })

      const sha = await getGitCommitSha(dir)
      expect(sha).toMatch(/^[0-9a-f]{40}$/)

      const version = await calculatePluginVersion(
        'my-plugin@mkt',
        './my-plugin',
        undefined,
        dir,
      )
      expect(version).toBe(sha!.slice(0, 12))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#920: walkPluginMarkdown with loadedPaths calls realpathSync once per rootDir and deduplicates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'walk-md-'))
    try {
      mkdirSync(join(dir, 'sub'), { recursive: true })
      writeFileSync(join(dir, 'a.md'), '# A')
      writeFileSync(join(dir, 'sub', 'b.md'), '# B')

      const fsImpl = getFsImplementation()
      const origRealpathSync = fsImpl.realpathSync
      let realpathCalls = 0
      fsImpl.realpathSync = ((...args: Parameters<typeof origRealpathSync>) => {
        realpathCalls++
        return origRealpathSync.apply(fsImpl, args)
      }) as typeof origRealpathSync

      try {
        const loadedPaths = new Set<string>()
        const seen: string[] = []
        await walkPluginMarkdown(
          dir,
          async fullPath => {
            seen.push(fullPath)
          },
          { loadedPaths },
        )
        expect(seen.length).toBe(2)
        expect(realpathCalls).toBe(1)

        // Second walk with same loadedPaths deduplicates both files
        const seen2: string[] = []
        await walkPluginMarkdown(
          dir,
          async fullPath => {
            seen2.push(fullPath)
          },
          { loadedPaths },
        )
        expect(seen2.length).toBe(0)
      } finally {
        fsImpl.realpathSync = origRealpathSync
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
