/**
 * densable 2.1.248 #10 — desktopSessionCleanupPeriodDays schema + Ae/xe/$te
 * + Ior skipIf / Sgn.
 *
 * GOLD: gold-248-na-10-schema.txt / gold-248-na-10-Ae.txt /
 * gold-248-na-10-xe.txt / gold-248-na-10-Ior.txt / gold-248-na-10-Sgn.txt
 *
 * Ae: tx("desktopSessionCleanupPeriodDays")[0] ?? Ce; Ce=0 → null cutoff.
 * xe: policySettings.cleanupPeriodDays !== undefined → true;
 *     else settings-error skip with $te.
 * $te = ["cleanupPeriodDays","desktopSessionCleanupPeriodDays"]
 * Sgn: r.has(e==="local_agent"?"local-agent":e) on
 *      {"claude-desktop","claude-desktop-3p","local-agent"}
 * Ior skipIf y: Ae ceiling, .desktop-released.json ie(), jsonl entrypoint + Sgn
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  CLEANUP_PERIOD_SETTINGS_KEYS,
  cleanupOldSessionFiles,
  getDesktopSessionCleanupCutoff,
  isDesktopHostEntrypoint,
  isDesktopSessionCleanupBlocked,
  shouldExemptDesktopSessionTranscript,
} from '../cleanup.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getFsImplementation } from '../fsOperations.js'
import { LITE_READ_BUF_SIZE } from '../sessionStoragePortable.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { SettingsSchema } from '../settings/types.js'

const GOLD_DESCRIBE =
  'Retention ceiling in days for session transcripts created or last written by a desktop-host surface (Claude Desktop, Cowork), which are otherwise exempt from the cleanupPeriodDays sweep. 0 (the default) means no ceiling: such transcripts are kept until deleted another way. Unlike cleanupPeriodDays, 0 is allowed because this setting never disables writes \u2014 it only bounds an exemption from deletion. The ceiling is a hard cap: it also bounds an active archive grace, so the grace window of a release marker never keeps files past the ceiling. Ignored when cleanupPeriodDays is managed by org policy. A ceiling at or below cleanupPeriodDays effectively disables the exemption: those transcripts age out on the regular cleanupPeriodDays schedule, so the effective retention is whichever of the two periods is longer.'

const srcRoot = join(import.meta.dir, '../..')
const cleanupSrc = readFileSync(join(srcRoot, 'utils/cleanup.ts'), 'utf8')
const typesSrc = readFileSync(join(srcRoot, 'utils/settings/types.ts'), 'utf8')

describe('densable 2.1.248 #10 desktopSessionCleanupPeriodDays schema', () => {
  test('int nonnegative optional; 0 is allowed (no ceiling)', () => {
    const schema = SettingsSchema()
    expect(schema.safeParse({}).success).toBe(true)
    expect(
      schema.safeParse({ desktopSessionCleanupPeriodDays: 0 }).success,
    ).toBe(true)
    expect(
      schema.safeParse({ desktopSessionCleanupPeriodDays: 7 }).success,
    ).toBe(true)
    expect(
      schema.safeParse({ desktopSessionCleanupPeriodDays: -1 }).success,
    ).toBe(false)
    expect(
      schema.safeParse({ desktopSessionCleanupPeriodDays: 1.5 }).success,
    ).toBe(false)
  })

  test('describe matches gold 1:1', () => {
    const field = SettingsSchema().shape.desktopSessionCleanupPeriodDays
    expect(field.description).toBe(GOLD_DESCRIBE)
    expect(typesSrc).toContain(
      'created or last written by a desktop-host surface (Claude Desktop, Cowork)',
    )
    expect(typesSrc).toContain(
      '0 (the default) means no ceiling: such transcripts are kept until deleted another way',
    )
  })
})

describe('densable 2.1.248 #10 Ae/xe/$te pairing', () => {
  test('$te pairs cleanupPeriodDays with desktopSessionCleanupPeriodDays', () => {
    expect(CLEANUP_PERIOD_SETTINGS_KEYS).toEqual([
      'cleanupPeriodDays',
      'desktopSessionCleanupPeriodDays',
    ])
    expect(cleanupSrc).toContain("'cleanupPeriodDays'")
    expect(cleanupSrc).toContain("'desktopSessionCleanupPeriodDays'")
  })

  test('Ae uses tx[0]??Ce; Ce is 0; 0 returns null (not 30 days)', () => {
    expect(cleanupSrc).toContain(
      "getSecuritySensitiveSetting('desktopSessionCleanupPeriodDays')[0]",
    )
    expect(cleanupSrc).toContain(
      'DEFAULT_DESKTOP_SESSION_CLEANUP_PERIOD_DAYS = 0',
    )
    expect(cleanupSrc).toContain('if (days === 0) return null')
    expect(cleanupSrc).toContain(
      'new Date(Date.now() - days * 24 * 60 * 60 * 1000)',
    )
    expect(cleanupSrc).not.toContain(
      'DEFAULT_DESKTOP_SESSION_CLEANUP_PERIOD_DAYS = 30',
    )
  })

  test('xe: policySettings.cleanupPeriodDays !== undefined → true; else $te errors', () => {
    expect(cleanupSrc).toContain("getSettingsForSource('policySettings')")
    expect(cleanupSrc).toContain('?.cleanupPeriodDays !== undefined')
    expect(cleanupSrc).toContain('error.file !== PARENT_MANAGED_SETTINGS_FILE')
    expect(cleanupSrc).toContain('CLEANUP_PERIOD_SETTINGS_KEYS.some')
    expect(cleanupSrc).toContain("error.severity !== 'warning'")
    expect(cleanupSrc).toContain('parent managed settings')
  })

  test('Jrt skip loops $te, not cleanupPeriodDays alone', () => {
    expect(cleanupSrc).toContain('CLEANUP_PERIOD_SETTINGS_KEYS.find(key =>')
    expect(cleanupSrc).toContain('rawSettingsContainsKey(key)')
    expect(cleanupSrc).not.toContain(
      "rawSettingsContainsKey('cleanupPeriodDays')",
    )
  })
})

describe('densable 2.1.248 #10 invent-ban', () => {
  test('does not invent writtenByDesktop / source===desktop / 30-day desktop default', () => {
    expect(cleanupSrc).not.toContain('writtenByDesktop')
    expect(cleanupSrc).not.toContain('source==="desktop"')
    expect(cleanupSrc).not.toContain("source === 'desktop'")
    expect(typesSrc).not.toContain('writtenByDesktop')
    expect(typesSrc).not.toContain('source==="desktop"')
  })
})

const sweepFn = cleanupSrc.slice(
  cleanupSrc.indexOf('export async function cleanupOldSessionFiles'),
)

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

function writeJsonl(dir: string, name: string, entrypoint?: string): string {
  const path = join(dir, name)
  const row: Record<string, unknown> = {
    type: 'user',
    message: { role: 'user', content: 'hi' },
  }
  if (entrypoint !== undefined) row.entrypoint = entrypoint
  writeFileSync(path, `${JSON.stringify(row)}\n`)
  return path
}

async function exemptVerdict(
  filePath: string,
  fileAgeDays: number,
  regularDays: number,
  desktopDays: number | null,
): Promise<boolean> {
  const mtime = daysAgo(fileAgeDays)
  utimesSync(filePath, mtime, mtime)
  const stats = await getFsImplementation().stat(filePath)
  return shouldExemptDesktopSessionTranscript(
    filePath,
    stats,
    daysAgo(regularDays),
    desktopDays === null ? null : daysAgo(desktopDays),
    getFsImplementation(),
    Buffer.allocUnsafe(LITE_READ_BUF_SIZE),
  )
}

describe('densable 2.1.248 #10 Sgn + Ior skipIf', () => {
  test('Sgn: desktop-host set + local_agent alias; not cli/cowork ident', () => {
    expect(isDesktopHostEntrypoint('claude-desktop')).toBe(true)
    expect(isDesktopHostEntrypoint('claude-desktop-3p')).toBe(true)
    expect(isDesktopHostEntrypoint('local-agent')).toBe(true)
    expect(isDesktopHostEntrypoint('local_agent')).toBe(true)
    expect(isDesktopHostEntrypoint('cli')).toBe(false)
    expect(isDesktopHostEntrypoint('claude-vscode')).toBe(false)
    expect(isDesktopHostEntrypoint('remote_cowork')).toBe(false)
    expect(cleanupSrc).toContain("'claude-desktop'")
    expect(cleanupSrc).toContain("'claude-desktop-3p'")
    expect(cleanupSrc).toContain("'local-agent'")
    expect(cleanupSrc).toContain("entrypoint === 'local_agent'")
    expect(cleanupSrc).toContain('.desktop-released.json')
  })

  test('Ae is called from sweep', () => {
    expect(sweepFn).toContain('getDesktopSessionCleanupCutoff()')
    expect(sweepFn).toContain('isDesktopSessionCleanupBlocked()')
    expect(sweepFn).toContain('shouldExemptDesktopSessionTranscript')
    expect(sweepFn).toContain(
      "entry.name.endsWith('.jsonl') ? skipDesktopJsonl",
    )
  })

  test('Ior true → uses desktop cutoff', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsk-248-ior-true-'))
    const desktop = writeJsonl(dir, 'desk.jsonl', 'claude-desktop')
    try {
      // past regular (1d) but inside Ae ceiling (7d) → exempt
      expect(await exemptVerdict(desktop, 3, 1, 7)).toBe(true)
      // past Ae ceiling → delete (no exemption)
      expect(await exemptVerdict(desktop, 10, 1, 7)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('Ior false → regular cleanupPeriodDays', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsk-248-ior-false-'))
    const cli = writeJsonl(dir, 'cli.jsonl', 'cli')
    try {
      expect(await exemptVerdict(cli, 3, 1, 7)).toBe(false)
      expect(await exemptVerdict(cli, 10, 1, null)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('Ce=0 → exempt (no delete)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsk-248-ce0-'))
    const desktop = writeJsonl(dir, 'desk.jsonl', 'local-agent')
    try {
      expect(await exemptVerdict(desktop, 40, 1, null)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('densable 2.1.248 #10 Ior sweep hook', () => {
  const temps: string[] = []
  const prevConfigDir = process.env.CLAUDE_CONFIG_DIR

  afterEach(() => {
    if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    getClaudeConfigHomeDir.cache?.clear?.()
    resetSettingsCache()
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function isolateHome(settings: Record<string, unknown>): string {
    const home = mkdtempSync(join(tmpdir(), 'dsk-248-home-'))
    temps.push(home)
    process.env.CLAUDE_CONFIG_DIR = home
    getClaudeConfigHomeDir.cache?.clear?.()
    const body = JSON.stringify(settings)
    writeFileSync(join(home, 'settings.json'), body)
    writeFileSync(join(home, 'cowork_settings.json'), body)
    resetSettingsCache()
    return home
  }

  function ageFile(path: string, days: number): void {
    const when = daysAgo(days)
    utimesSync(path, when, when)
  }

  test('sweep: Ae from Ior; Sgn true uses desktop cutoff; Sgn false uses regular; Ce=0 keeps', async () => {
    const home = isolateHome({
      cleanupPeriodDays: 1,
      desktopSessionCleanupPeriodDays: 0,
    })
    expect(getSettings_DEPRECATED().cleanupPeriodDays).toBe(1)
    expect(getDesktopSessionCleanupCutoff()).toBeNull()
    expect(isDesktopSessionCleanupBlocked()).toBe(false)
    const project = join(home, 'projects', 'p')
    mkdirSync(project, { recursive: true })
    const desktop = writeJsonl(project, 'desk.jsonl', 'claude-desktop')
    const cli = writeJsonl(project, 'cli.jsonl', 'cli')
    ageFile(desktop, 10)
    ageFile(cli, 10)
    await cleanupOldSessionFiles()
    expect(existsSync(desktop)).toBe(true)
    expect(existsSync(cli)).toBe(false)

    isolateHome({
      cleanupPeriodDays: 1,
      desktopSessionCleanupPeriodDays: 7,
    })
    expect(getSettings_DEPRECATED().cleanupPeriodDays).toBe(1)
    expect(getDesktopSessionCleanupCutoff()).not.toBeNull()
    expect(isDesktopSessionCleanupBlocked()).toBe(false)
    const project2 = join(getClaudeConfigHomeDir(), 'projects', 'p')
    mkdirSync(project2, { recursive: true })
    const pastCeiling = writeJsonl(project2, 'old-desk.jsonl', 'claude-desktop')
    const insideCeiling = writeJsonl(
      project2,
      'mid-desk.jsonl',
      'claude-desktop-3p',
    )
    const cli2 = writeJsonl(project2, 'cli.jsonl', 'cli')
    ageFile(pastCeiling, 10)
    ageFile(insideCeiling, 3)
    ageFile(cli2, 3)
    await cleanupOldSessionFiles()
    expect(existsSync(pastCeiling)).toBe(false)
    expect(existsSync(insideCeiling)).toBe(true)
    expect(existsSync(cli2)).toBe(false)
  })
})
