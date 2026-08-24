/**
 * densable 2.1.234 #23 — trust prompts must not omit repository-wide scope
 * warning when the directory was first seen before the repository existed.
 *
 * Gold: I8e = rHo → Ydu (uncached); Yc/bd keep LRU. A negative miss in the
 * findGitRoot LRU must not make trust_root / showRepoRootNote stay false once
 * `.git` appears.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  findCanonicalGitRoot,
  findCanonicalGitRootUncached,
  findGitRoot,
  findGitRootUncached,
  refreshFindGitRoot,
} from '../git.js'
import { resolveTrustRootNote } from '../../components/TrustDialog/trustDialogCopy.js'

describe('densable 2.1.234 #23 I8e/rHo uncached git root for trust', () => {
  const dirs: string[] = []

  afterEach(() => {
    findGitRoot.cache.clear()
    findCanonicalGitRoot.cache.clear()
    for (const d of dirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  })

  function scratch(): string {
    const d = mkdtempSync(join(tmpdir(), 'cc-trust-23-'))
    dirs.push(d)
    return d
  }

  test('negative LRU miss does not poison uncached trust probe after .git appears', () => {
    const root = scratch()
    const nested = join(root, 'pkg')
    const sub = join(nested, 'src')
    mkdirSync(sub, { recursive: true })

    // First see: no repo → cached findGitRoot records negative miss for both
    expect(findGitRoot(nested)).toBeNull()
    expect(findGitRoot(sub)).toBeNull()
    expect(findCanonicalGitRoot(sub)).toBeNull()
    expect(findGitRoot.cache.has(sub)).toBe(true)

    // Repo appears under nested (directory first seen before repository existed)
    mkdirSync(join(nested, '.git'), { recursive: true })
    writeFileSync(join(nested, '.git', 'HEAD'), 'ref: refs/heads/main\n')

    // Cached path still wrong without refresh
    expect(findGitRoot(sub)).toBeNull()
    expect(findCanonicalGitRoot(sub)).toBeNull()

    // densable rHo / I8e — uncached — sees the new repo
    expect(findGitRootUncached(sub)).toBe(resolve(nested).normalize('NFC'))
    expect(findCanonicalGitRootUncached(sub)).toBe(
      resolve(nested).normalize('NFC'),
    )

    // Trust note via I8e/rHo shows repository-wide warning
    const note = resolveTrustRootNote(
      sub,
      findCanonicalGitRootUncached,
      findGitRootUncached,
    )
    expect(note.showRepoRootNote).toBe(true)
    expect(note.trustRoot).toBe(resolve(nested).normalize('NFC'))

    // Cached injectors would still omit the warning (the pre-#23 bug)
    const poisoned = resolveTrustRootNote(
      sub,
      findCanonicalGitRoot,
      findGitRoot,
    )
    expect(poisoned.showRepoRootNote).toBe(false)
  })

  test('refreshFindGitRoot (Rat) drops only negative miss then re-probes', () => {
    const root = scratch()
    expect(findGitRoot(root)).toBeNull()
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')

    expect(findGitRoot(root)).toBeNull()
    expect(refreshFindGitRoot(root)).toBe(resolve(root).normalize('NFC'))
    expect(findGitRoot(root)).toBe(resolve(root).normalize('NFC'))
  })

  test('uncached probe does not write into LRU', () => {
    const root = scratch()
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')

    findGitRoot.cache.clear()
    expect(findGitRootUncached(root)).toBe(resolve(root).normalize('NFC'))
    expect(findGitRoot.cache.has(root)).toBe(false)
  })
})
