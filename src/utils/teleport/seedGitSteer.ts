/**
 * densable `_583` `pXo` / `fXo` — refuse a seed upload when a settings
 * file a cloud session can reach names (or once named) a steered env key.
 * Gold: gold-forged-pXo.txt / gold-forged-fXo.txt / gold-forged-G4n.txt /
 * gold-forged-q4n.txt / gold-forged-V4n.txt / gold-forged-bCt.txt /
 * gold-forged-W4n.txt / gold-forged-Xr.txt
 *
 * Xr is `_705` `h` / getSettingsForSource — shared loader, not reimplemented.
 * G4n nested skips (more accept): `yn` (flagSettingsFilePinnedContent),
 * `bn` (legacy local path `Y(p())`), `_n` (flagSettingsExpectedContent).
 * V4n `j()` startup env is unset here — official `if(n===void 0)return`.
 */

import { statSync } from 'fs'
import { join } from 'path'
import { uniq } from '../array.js'
import { logForDebugging } from '../debug.js'
import { errorMessage, getErrnoCode } from '../errors.js'
import {
  getSettingsFilePathForSource,
  getSettingsForSource,
  parseSettingsFile,
} from '../settings/settings.js'
import type { SettingSource } from '../settings/constants.js'

/** densable `K` / TCt `W4n` */
export const SEED_STEER_HOME_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'CLAUDE_CODE_USE_COWORK_PLUGINS',
] as const

/** densable `Lt` */
const SEED_STEER_TMP_KEYS = [
  'CLAUDE_CODE_TMPDIR',
  'TMPDIR',
  'TEMP',
  'TMP',
] as const

/** densable `Pi` / TCt `bCt` */
export const SEED_STEER_KEYS = [
  ...SEED_STEER_HOME_KEYS,
  ...SEED_STEER_TMP_KEYS,
  'XDG_CONFIG_HOME',
  'PATH',
  'GIT_EXEC_PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'DYLD_FALLBACK_LIBRARY_PATH',
  'DYLD_FALLBACK_FRAMEWORK_PATH',
] as const

/** densable `Se` — `_n`/Pe flagSettings branch skipped. */
const CLOUD_REACHABLE_SOURCES = [
  'projectSettings',
  'localSettings',
] as const satisfies readonly SettingSource[]

const REACHABLE =
  'a settings file a cloud session could reach (this repository\u2019s .claude/settings.json or .claude/settings.local.json, or a --settings file)'

export type SeedSteerHit =
  | { kind: 'unreadable' }
  | { kind: 'names'; name: string }
  | { kind: 'moved'; name: string }

export type SeedSteerWorkTree = {
  workTree: string
}

/** densable `hn(e)` — `En` is parseSettingsFile. */
function settingsFileUnreadable(path: string): boolean {
  const { settings, errors } = parseSettingsFile(path)
  return settings === null || errors.some(error => error.severity !== 'warning')
}

/**
 * densable `Ri` / `G4n`.
 * `yn` / `bn` / `_n` unlocked — n and t stay undefined (more accept).
 */
function settingsFilesUnreadable(layout: SeedSteerWorkTree): boolean {
  const paths = uniq(
    [
      ...CLOUD_REACHABLE_SOURCES.map(source =>
        getSettingsFilePathForSource(source),
      ),
      join(layout.workTree, '.claude', 'settings.json'),
      join(layout.workTree, '.claude', 'settings.local.json'),
    ].filter((path): path is string => path !== undefined),
  )
  return paths.some(path => {
    try {
      if (!statSync(path).isFile()) return true
    } catch (error) {
      return getErrnoCode(error) !== 'ENOENT'
    }
    return settingsFileUnreadable(path)
  })
}

/**
 * densable `Rn` / `V4n`. Startup env `j()` is unset here — official
 * `if(n===void 0)return` skips the moved check.
 */
function driftedSteerEnv(_keys: readonly string[]): string | undefined {
  return undefined
}

/** densable `fXo` */
export function formatSeedSteerRefuse(hit: SeedSteerHit): string {
  if (hit.kind === 'unreadable') {
    return `Not uploading this working tree this way: ${REACHABLE} could not be parsed, so what it sets cannot be checked. Fix or remove it (see /status), then restart Claude Code.`
  }
  const home = (SEED_STEER_HOME_KEYS as readonly string[]).includes(
    hit.name.toUpperCase(),
  )
  if (hit.kind === 'names') {
    return home
      ? `Not uploading this working tree this way: ${REACHABLE} names ${hit.name}, which decides where your own settings are found. Remove it there (set it in the shell if you need it), then restart Claude Code.`
      : `Not uploading this working tree this way: ${REACHABLE} names ${hit.name}, and the upload's own git runs would have to trust what it names. Set it in your user settings (~/.claude/settings.json), managed settings or the shell instead (or pass the settings inline), then restart Claude Code.`
  }
  return home
    ? `Not uploading this working tree this way: ${hit.name} was changed by a settings file after Claude Code started; it decides where your own settings are found, so the upload only trusts the value the process was started with. Set it in the shell rather than in a settings file, then restart Claude Code.`
    : `Not uploading this working tree this way: ${hit.name} was set by ${REACHABLE} that no longer names it, and the upload's own git runs would still have to trust it. Keep it out of those files and restart Claude Code.`
}

/** densable `pXo` */
export function refuseSeedSteerEnv(
  layout: SeedSteerWorkTree,
): SeedSteerHit | null {
  const keys = SEED_STEER_KEYS as readonly string[]
  try {
    if (settingsFilesUnreadable(layout)) return { kind: 'unreadable' }
    for (const source of CLOUD_REACHABLE_SOURCES) {
      const name = Object.keys(getSettingsForSource(source)?.env ?? {}).find(
        key => keys.includes(key.toUpperCase()),
      )
      if (name !== undefined) return { kind: 'names', name }
    }
    const moved = driftedSteerEnv(keys)
    return moved === undefined ? null : { kind: 'moved', name: moved }
  } catch (error) {
    logForDebugging(
      `[gitBundle] could not read the repository's settings: ${errorMessage(error)}`,
    )
    return { kind: 'unreadable' }
  }
}
