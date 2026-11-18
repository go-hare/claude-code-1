import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { checkGitBranchStorageForUltrareview } from './reviewRemote.js'

describe('#81 ultrareview refuses repos with branches stored outside .git', () => {
  test('refuses when .git/reftable exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ultrareview-reftable-'))
    try {
      mkdirSync(join(dir, '.git', 'objects'), { recursive: true })
      mkdirSync(join(dir, '.git', 'refs'), { recursive: true })
      mkdirSync(join(dir, '.git', 'reftable'), { recursive: true })
      writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
      const msg = await checkGitBranchStorageForUltrareview(dir, '/ultrareview')
      expect(msg).not.toBeNull()
      expect(msg).toContain('reftable')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
