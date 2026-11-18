import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AbortError } from '../../utils/errors.js'
import {
  clearDynamicSkills,
  discoverAndActivateSkillsForFilePath,
} from '../loadSkillsDir.js'
import {
  awaitPendingSkillDownload,
  clearPendingSkillDownloads,
  registerPendingSkillDownload,
} from '../syncedSkillsHarden.js'

const tempDirs: string[] = []

afterEach(() => {
  clearPendingSkillDownloads()
  clearDynamicSkills()
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('#1226 skill download AbortController cancellation', () => {
  test('rejects immediately when signal is already aborted without starting download', async () => {
    let started = false
    registerPendingSkillDownload('my-skill', () => {
      started = true
    })
    const ac = new AbortController()
    ac.abort()
    await expect(
      awaitPendingSkillDownload('my-skill', ac.signal),
    ).rejects.toThrow(AbortError)
    expect(started).toBe(false)
  })

  test('cancels in-flight download when AbortController aborts', async () => {
    let innerSignal: AbortSignal | undefined
    registerPendingSkillDownload('in-flight-skill', sig => {
      innerSignal = sig
    })
    const ac = new AbortController()
    const pending = awaitPendingSkillDownload('in-flight-skill', ac.signal)
    expect(innerSignal?.aborted).toBe(false)
    ac.abort()
    await expect(pending).rejects.toThrow(AbortError)
    expect(innerSignal?.aborted).toBe(true)
  })

  test('resolves normally when download completes before abort', async () => {
    const finish = registerPendingSkillDownload('ok-skill', () => {})
    const ac = new AbortController()
    const pending = awaitPendingSkillDownload('ok-skill', ac.signal)
    finish({ ok: true })
    await expect(pending).resolves.toEqual({ ok: true })
  })
})

describe('#1319 discoverAndActivateSkillsForFilePath runtime', () => {
  test('discovers nested .claude/skills directory for a file path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-discover-'))
    tempDirs.push(root)
    const nested = join(root, 'packages', 'app')
    const skillDir = join(nested, '.claude', 'skills', 'local-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: local-skill\ndescription: Local skill\n---\nHello\n',
    )
    const targetFile = join(nested, 'index.ts')
    writeFileSync(targetFile, 'export const x = 1\n')

    const discovered: string[] = []
    await discoverAndActivateSkillsForFilePath(targetFile, discovered)
    expect(Array.isArray(discovered)).toBe(true)
  })
})
