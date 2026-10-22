/**
 * densable 2.1.289 Read deny through symlink:
 * - Attachment IG raw spelling, then gold vge/wge walk when any Read deny exists.
 * - FileRead tool deny walks symlink landings via `walkPermissionPaths`.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { getCwd } from '../cwd.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { walkPermissionPaths } from '../fsOperations.js'
import { matchingRuleForInput } from '../permissions/filesystem.js'

const ATTACHMENTS = join(import.meta.dir, '../attachments.ts')
const FILESYSTEM = join(import.meta.dir, '../permissions/filesystem.ts')
const FIXTURE = join(getCwd(), '.tmp-ide-symlink-deny-289')

describe('densable 2.1.289 Read deny hosts', () => {
  beforeEach(() => {
    rmSync(FIXTURE, { recursive: true, force: true })
    mkdirSync(FIXTURE, { recursive: true })
  })
  afterEach(() => {
    rmSync(FIXTURE, { recursive: true, force: true })
  })

  test('isFileReadDenied source-lock walks when a Read deny exists', () => {
    const src = readFileSync(ATTACHMENTS, 'utf8')
    const start = src.indexOf('function isFileReadDenied')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start, start + 1400)
    expect(body).toContain('walkPermissionPaths(filePath)')
    expect(body).toContain('hasReadDenyRules')
    expect(body).toContain('matchingRuleForInput(\n        pathToCheck,')
  })

  test('checkReadPermissionForTool source-lock walks pathsToCheck for deny', () => {
    const src = readFileSync(FILESYSTEM, 'utf8')
    const start = src.indexOf('export function checkReadPermissionForTool')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start, start + 1800)
    expect(body).toContain('walkPermissionPaths(path)')
    expect(body).toContain('for (const pathToCheck of pathsToCheck)')
    expect(body).toContain('matchingRuleForInput(\n      pathToCheck,')
  })

  test('walkPermissionPaths landing is matched by Read deny on landing spelling', () => {
    const landing = join(FIXTURE, 'landing.txt')
    const link = join(FIXTURE, 'via-link.txt')
    writeFileSync(landing, 'x')
    symlinkSync(landing, link)
    const walked = walkPermissionPaths(link).paths
    expect(walked).toContain(link)
    expect(walked).toContain(landing)
    const relLanding = relative(getCwd(), landing)
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: { session: [`Read(${relLanding})`] },
    }
    const hit = walked.some(
      p => matchingRuleForInput(p, ctx, 'read', 'deny') !== null,
    )
    expect(hit).toBe(true)
  })
})
