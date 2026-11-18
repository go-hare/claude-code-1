import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  directoryHasAgentsMd,
  processMemoryFile,
  processMdRules,
} from '../claudemd.js'

describe('v2.1.290 #23: symlinked CLAUDE.md / AGENTS.md / rules handling', () => {
  test('directoryHasAgentsMd returns false for broken (non-canonical) symlink', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudemd-broken-290-'))
    symlinkSync(join(dir, 'nonexistent-target.md'), join(dir, 'AGENTS.md'))
    try {
      const exists = await directoryHasAgentsMd(dir)
      expect(exists).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('processMemoryFile skips broken symlink (isSymlink && !isCanonical)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudemd-mem-290-'))
    const linkPath = join(dir, 'CLAUDE.md')
    symlinkSync(join(dir, 'missing.md'), linkPath)
    try {
      const files = await processMemoryFile(
        linkPath,
        'Project',
        new Set(),
        false,
      )
      expect(files).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('processMdRules skips broken symlinked .md entry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudemd-rules-290-'))
    const rulesDir = join(dir, '.claude', 'rules')
    mkdirSync(rulesDir, { recursive: true })
    writeFileSync(join(rulesDir, 'valid.md'), 'Valid rule content')
    symlinkSync(join(dir, 'missing.md'), join(rulesDir, 'broken.md'))
    try {
      const files = await processMdRules({
        rulesDir,
        type: 'Project',
        processedPaths: new Set(),
        includeExternal: false,
        conditionalRule: false,
      })
      expect(files.length).toBe(1)
      expect(files[0]!.content).toContain('Valid rule content')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
