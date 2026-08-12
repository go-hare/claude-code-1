/**
 * densable 2.1.224 #8 — long project path shared sanitized prefix must not
 * steal another project's session directory (mar / dirBelongsToProject).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  dirBelongsToProject,
  findProjectDirs,
  MAX_SANITIZED_LENGTH,
  sanitizePath,
  sanitizePathRaw,
} from '../sessionStoragePortable.js'

let tempHome = ''
let previousConfigDir: string | undefined

function seedSession(projectDir: string, sessionId: string, cwd: string): void {
  mkdirSync(projectDir, { recursive: true })
  const line = JSON.stringify({
    type: 'user',
    cwd,
    message: { content: 'hi' },
    timestamp: new Date(0).toISOString(),
  })
  writeFileSync(join(projectDir, `${sessionId}.jsonl`), `${line}\n`, 'utf-8')
}

describe('densable 2.1.224 #8 dirBelongsToProject / findProjectDirs', () => {
  beforeEach(() => {
    previousConfigDir = process.env.CLAUDE_CONFIG_DIR
    tempHome = mkdtempSync(join(tmpdir(), 'dir-belongs-224-'))
    process.env.CLAUDE_CONFIG_DIR = tempHome
  })

  afterEach(() => {
    if (previousConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousConfigDir
    }
    rmSync(tempHome, { recursive: true, force: true })
    tempHome = ''
  })

  test('sanitizePath truncates at MAX_SANITIZED_LENGTH and appends hash', () => {
    const long = `/Users/${'a'.repeat(250)}/project-one`
    const s = sanitizePath(long)
    expect(s.length).toBeGreaterThan(MAX_SANITIZED_LENGTH)
    expect(
      s.startsWith(sanitizePathRaw(long).slice(0, MAX_SANITIZED_LENGTH)),
    ).toBe(true)
    expect(s).toContain('-')
  })

  test('two long paths can share the same 200-char sanitized prefix', () => {
    // Shared head long enough that fJi first 200 chars are identical after AX truncate.
    const head = `/Users/u/${'x'.repeat(250)}`
    const a = `${head}/project-alpha-extra`
    const b = `${head}/project-bravo-extra`
    const sa = sanitizePathRaw(a)
    const sb = sanitizePathRaw(b)
    expect(sa.length).toBeGreaterThan(MAX_SANITIZED_LENGTH)
    expect(sa.slice(0, MAX_SANITIZED_LENGTH)).toBe(
      sb.slice(0, MAX_SANITIZED_LENGTH),
    )
    // Full sanitize still differs by hash suffix.
    expect(sanitizePath(a)).not.toBe(sanitizePath(b))
    expect(sanitizePath(a).length).toBeGreaterThan(MAX_SANITIZED_LENGTH)
  })

  test('dirBelongsToProject matches cwd in jsonl head', async () => {
    const projectPath = '/Users/u/real-project'
    const dir = join(tempHome, 'projects', 'real-project-dir')
    seedSession(dir, '11111111-1111-1111-1111-111111111111', projectPath)
    await expect(dirBelongsToProject(dir, projectPath)).resolves.toBe(true)
    await expect(
      dirBelongsToProject(dir, '/Users/u/other-project'),
    ).resolves.toBe(false)
  })

  test('dirBelongsToProject prefers relocated.relocatedCwd over head cwd', async () => {
    const original = '/Users/u/old-home'
    const relocated = '/Users/u/new-home'
    const dir = join(tempHome, 'projects', 'reloc-dir')
    mkdirSync(dir, { recursive: true })
    const head = JSON.stringify({
      type: 'user',
      cwd: original,
      message: { content: 'hi' },
      timestamp: new Date(0).toISOString(),
    })
    const tail = JSON.stringify({
      type: 'relocated',
      relocatedCwd: relocated,
      timestamp: new Date(1).toISOString(),
    })
    writeFileSync(
      join(dir, '22222222-2222-2222-2222-222222222222.jsonl'),
      `${head}\n${tail}\n`,
      'utf-8',
    )
    await expect(dirBelongsToProject(dir, relocated)).resolves.toBe(true)
    // densable mar: relocated wins; original alone is not enough once relocated present
    // (head cwd still present but mar uses ndt relocated first)
    await expect(dirBelongsToProject(dir, original)).resolves.toBe(false)
  })

  test('findProjectDirs does not return foreign prefix-matched dir', async () => {
    const head = `/Users/u/${'y'.repeat(250)}`
    const pathA = `${head}/alpha-end`
    const pathB = `${head}/bravo-end`
    expect(sanitizePath(pathA).length).toBeGreaterThan(MAX_SANITIZED_LENGTH)
    expect(sanitizePathRaw(pathA).slice(0, MAX_SANITIZED_LENGTH)).toBe(
      sanitizePathRaw(pathB).slice(0, MAX_SANITIZED_LENGTH),
    )

    const projectsDir = join(tempHome, 'projects')
    // Foreign dir: shares prefix, owns pathB sessions only.
    const foreignName = `${sanitizePathRaw(pathA).slice(0, MAX_SANITIZED_LENGTH)}-foreignhash`
    const foreignDir = join(projectsDir, foreignName)
    seedSession(foreignDir, '33333333-3333-3333-3333-333333333333', pathB)

    // Exact dir for pathA is empty / missing — must not fall back to foreign.
    const dirs = await findProjectDirs(pathA)
    expect(dirs).not.toContain(foreignDir)
    expect(dirs.every(d => d !== foreignDir)).toBe(true)
  })

  test('findProjectDirs includes prefix-matched dir when mar confirms ownership', async () => {
    const head = `/Users/u/${'z'.repeat(250)}`
    const pathA = `${head}/alpha-own`
    expect(sanitizePath(pathA).length).toBeGreaterThan(MAX_SANITIZED_LENGTH)
    const projectsDir = join(tempHome, 'projects')
    // Hash-mismatched sibling that still belongs to pathA (Bun vs Node hash).
    const siblingName = `${sanitizePathRaw(pathA).slice(0, MAX_SANITIZED_LENGTH)}-otherhash`
    const siblingDir = join(projectsDir, siblingName)
    seedSession(siblingDir, '44444444-4444-4444-4444-444444444444', pathA)

    const dirs = await findProjectDirs(pathA)
    expect(dirs).toContain(siblingDir)
  })
})
