/**
 * densable 2.1.235 #13 — embedded/vendor ripgrep behavioral parity.
 *
 * SEA embeds ripgrep 14.1.1 (rev fdb5e06cce) via argv0='rg'.
 * Local prefers system 14.1.x when already installed; otherwise ships
 * sidecar vendor ripgrep 15.0.0 (rev 3a612f88b8). No remote 14.1.1 fetch.
 * Changelog claims: pathological fail-fast + `-m N` with `-A/-C` correct context.
 * This file locks the product-visible `-m`/`-A`/`-C` behavior against the
 * vendored binary (no JS invent). Skip when the platform binary is absent.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'fs'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { distRoot } from '../distRoot.js'

function vendorRgPath(): string | null {
  const platformDir =
    process.platform === 'win32'
      ? `${process.arch}-win32`
      : `${process.arch}-${process.platform}`
  const binaryName = process.platform === 'win32' ? 'rg.exe' : 'rg'
  const candidates = [
    join(distRoot, 'utils', 'vendor', 'ripgrep', platformDir, binaryName),
    join(
      process.cwd(),
      'src',
      'utils',
      'vendor',
      'ripgrep',
      platformDir,
      binaryName,
    ),
    join(process.cwd(), 'vendor', 'ripgrep', platformDir, binaryName),
  ]
  return candidates.find(p => existsSync(p)) ?? null
}

const rg = vendorRgPath()

describe('densable 2.1.235 #13 vendor ripgrep -m/-A/-C', () => {
  test.skipIf(!rg)('reports ripgrep 15.x (newer than SEA embed 14.1.1)', () => {
    const r = spawnSync(rg!, ['--version'], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/^ripgrep 15\./)
    expect(r.stdout).toContain('rev 3a612f88b8')
  })

  test.skipIf(!rg)('-m 1 -A 1 prints match + after-context only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rg235-'))
    try {
      const file = join(dir, 'a.txt')
      writeFileSync(
        file,
        'alpha\nMATCH me\nbeta\ngamma\nMATCH again\ndelta\nMATCH third\n',
      )
      const r = spawnSync(rg!, ['-m', '1', '-A', '1', 'MATCH', file], {
        encoding: 'utf8',
      })
      expect(r.status).toBe(0)
      expect(r.stdout).toBe('MATCH me\nbeta\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test.skipIf(!rg)(
    '-m 1 -A 2 stops after max-count even when context lines also match',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'rg235-'))
      try {
        const file = join(dir, 'ctx.txt')
        // Classic #1380 shape: matches in after-context must not keep expanding.
        writeFileSync(file, 'a\nb\nc\nd\ne\nd\nf\nd\ng\n')
        const r = spawnSync(rg!, ['-n', '-m', '1', '-A', '2', 'd', file], {
          encoding: 'utf8',
        })
        expect(r.status).toBe(0)
        expect(r.stdout).toBe('4:d\n5-e\n6:d\n')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})
