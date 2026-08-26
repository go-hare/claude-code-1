/**
 * densable 2.1.239 #19 — all-projects /resume must not `cd` into a
 * deleted directory. Gold: MTs / Yc / rft / MoA.
 */
import { mkdir, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, test } from 'bun:test'

import { getOriginalCwd } from '../../bootstrap/state.js'
import type { LogOption } from '../../types/logs.js'
import {
  checkCrossProjectResume,
  isPosixNetworkResumeSpelling,
  pathHasSymlinkAncestor,
  resumeCdJoiner,
} from '../crossProjectResume.js'
import { getPlatform } from '../platform.js'

function logAt(projectPath: string): LogOption {
  return {
    date: '2026-08-24',
    messages: [],
    value: 0,
    created: new Date(),
    modified: new Date(),
    firstPrompt: 'hi',
    messageCount: 1,
    isSidechain: false,
    sessionId: '11111111-1111-4111-8111-111111111111',
    projectPath,
  } as LogOption
}

const temps: string[] = []

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('checkCrossProjectResume', () => {
  test('MTs returns null when showAllProjects is off', async () => {
    expect(await checkCrossProjectResume(logAt('/other'), false, [])).toBe(null)
  })

  test('MTs returns null for the current directory', async () => {
    expect(
      await checkCrossProjectResume(logAt(getOriginalCwd()), true, []),
    ).toBe(null)
  })

  test('MTs returns null for a same-repo worktree (no ant gate)', async () => {
    const wt = join(getOriginalCwd(), 'wt-239')
    expect(await checkCrossProjectResume(logAt(wt), true, [wt])).toBe(null)
  })

  test('MTs returns null when the recorded directory is gone', async () => {
    const gone =
      getPlatform() === 'windows'
        ? 'C:\\claude-code-gone-239\\nested'
        : '/tmp/claude-code-gone-239/nested'
    expect(await checkCrossProjectResume(logAt(gone), true, [])).toBe(null)
    expect(await pathHasSymlinkAncestor(gone)).toBe(false)
  })

  test('MTs emits cd when the recorded directory still exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cc-resume-239-'))
    temps.push(dir)
    await mkdir(dir, { recursive: true })
    const command = await checkCrossProjectResume(logAt(dir), true, [])
    expect(command).toContain('cd ')
    expect(command).toContain(resumeCdJoiner())
    expect(command).toContain(
      'ccb --resume 11111111-1111-4111-8111-111111111111',
    )
    expect(command).toContain(dir)
  })

  test('Yc UNC / NT spelling still emits cd (MoA is skipped)', async () => {
    const command = await checkCrossProjectResume(
      logAt('\\\\server\\share\\gone'),
      true,
      [],
    )
    expect(command).toContain('cd ')
    expect(command).toContain('\\\\server\\share\\gone')
  })

  test('rft /net and /Network spellings emit cd', async () => {
    expect(isPosixNetworkResumeSpelling('/net/host/proj')).toBe(true)
    expect(isPosixNetworkResumeSpelling('/Network/host/proj')).toBe(true)
    expect(isPosixNetworkResumeSpelling('/home/me/proj')).toBe(false)
    const command = await checkCrossProjectResume(
      logAt('/net/host/proj'),
      true,
      [],
    )
    expect(command).toContain('cd ')
    expect(command).toContain('/net/host/proj')
  })

  test('DTs is ; on Windows and && elsewhere', () => {
    expect(resumeCdJoiner()).toBe(getPlatform() === 'windows' ? ';' : '&&')
  })
})
