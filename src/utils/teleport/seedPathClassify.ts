/**
 * densable `_465` `le`/`be`/`Yi` + TCt `SXo`.
 * Gold: gold-forged-alias-lock.txt / gold-forged-SXo.txt
 *
 * `ee`/`Qe` @210508964. `Ji` @210738867. `be`/`Ki` @210739047 / 210743221.
 * TCt `i` = `hardenForDeviceSessions ?? (platform!=="windows" && !gXo())`.
 * `gXo` = `V.CLAUDE_CODE_LEGACY_BUNDLE===!0` — boolean true only (1/true/TRUE).
 */

import { getPlatform } from '../platform.js'
import { formatSeedPathList, seedPlural } from './seedDisplay.js'

const WIN_8_3 = /^[^~.]{1,6}~[0-9]+(?:\.[^.]{1,3})?$/

export type SeedPathWhy =
  | 'forged'
  | 'alias'
  | 'added'
  | 'changed'
  | 'resurrected'
  | 'hardlinked'
  | 'filtered'

export type SeedPathRow = { path: string; why: SeedPathWhy }

export type SeedInspection = {
  staged: ReadonlyArray<{ path: string }>
  working: ReadonlyArray<{ path: string }>
}

function isWindowsFamily(): boolean {
  const p = getPlatform()
  return p === 'windows' || p === 'wsl'
}

/** densable `Vi` */
function slashNormalize(path: string): string {
  return getPlatform() === 'windows' ? path.replaceAll('\\', '/') : path
}

/** densable `_582` `Qe` */
export function seedPathSegmentsOk(path: string): boolean {
  return !path.split('/').some(seg => seg === '' || seg === '.' || seg === '..')
}

/** densable `Ji` — ADS colon or trailing `.`/` ` on win/wsl. */
export function seedPathHasWindowsAdsOrTrailingDot(path: string): boolean {
  return (
    isWindowsFamily() &&
    path
      .replaceAll('\\', '/')
      .split('/')
      .some(seg => seg.includes(':') || /[. ]$/.test(seg))
  )
}

/** densable `le` */
export function seedPathListingOk(path: string): boolean {
  return (
    seedPathSegmentsOk(slashNormalize(path)) &&
    !seedPathHasWindowsAdsOrTrailingDot(path)
  )
}

/** densable `be` */
export function seedPathIsWindows83Alias(path: string): boolean {
  if (!isWindowsFamily()) return false
  return path
    .replaceAll('\\', '/')
    .split('/')
    .some(seg => WIN_8_3.test(seg.replace(/:.*$/, '').replace(/[. ]+$/, '')))
}

/** densable `Yi` — listing refuse before eYn builds a tree. */
export function classifySeedListing(inspection: SeedInspection): SeedPathRow[] {
  const paths = [
    ...new Set([
      ...inspection.staged.map(e => e.path),
      ...inspection.working.map(e => e.path),
    ]),
  ].sort()
  return paths.flatMap((path): SeedPathRow[] => {
    if (!seedPathListingOk(path)) return [{ path, why: 'forged' as const }]
    if (seedPathIsWindows83Alias(path)) return [{ path, why: 'alias' as const }]
    return []
  })
}

export { formatSeedPathList } from './seedDisplay.js'

function formatReadRuleClause(coveredByReadRule: boolean): string {
  return coveredByReadRule ? ', or covered by a Read rule in your settings' : ''
}

/** densable `SXo` — forged → alias → credential leftover (added/changed/resurrected). */
export function formatSeedListingRefuse(
  rows: SeedPathRow[],
  coveredByReadRule = false,
): string {
  const of = (why: SeedPathWhy) =>
    rows.filter(r => r.why === why).map(r => r.path)
  const forged = of('forged')
  if (forged.length > 0) {
    return `Not uploading this working tree: git reports changed paths spelled in a way git itself never writes (${formatSeedPathList(forged)}), so this checkout's index or HEAD was edited by something other than git. Inspect it (git status, git log) before retrying.`
  }
  const alias = of('alias')
  if (alias.length > 0) {
    return `Not uploading this working tree: its uncommitted changes include paths shaped like Windows 8.3 short names (${formatSeedPathList(alias)}), which can open a different file than they name. Rename or remove them — committing them as they stand would put whatever they open into git — then retry.`
  }
  const added = of('added')
  const changed = of('changed')
  const resurrected = of('resurrected')
  return [
    `Not uploading this working tree: its uncommitted changes include ${rows.length} ${seedPlural(rows.length, 'file')} named like credentials or keys${formatReadRuleClause(coveredByReadRule)} (${formatSeedPathList(rows.map(r => r.path))}).`,
    ...(added.length > 0
      ? [
          `${formatSeedPathList(added)} ${seedPlural(added.length, 'was', 'were')} added to git's index but never committed: unless you meant to start tracking ${seedPlural(added.length, 'it', 'them')}, take ${seedPlural(added.length, 'it', 'them')} back out with ` +
            '`git rm --cached -- <file>` (the file itself stays on disk) — if you did not add ' +
            `${seedPlural(added.length, 'it', 'them')} yourself, something else did.`,
        ]
      : []),
    ...(changed.length > 0
      ? [
          `${formatSeedPathList(changed)} ${seedPlural(changed.length, 'differs', 'differ')} from what is committed: commit the change if it belongs in git; if ` +
            '`git status` shows no change there, running it once settled the difference — retry; if git should not be tracking ' +
            `${seedPlural(changed.length, 'that file', 'those files')} at all, this checkout's history was rewritten — see ` +
            '`git log -- <file>`.',
        ]
      : []),
    ...(resurrected.length > 0
      ? [
          `${formatSeedPathList(resurrected)} ${seedPlural(resurrected.length, 'is', 'are')} committed but removed from the index with the file still on disk: commit the removal, or if you never committed ${seedPlural(resurrected.length, 'it', 'them')}, see \`git log -- <file>\` for who did.`,
        ]
      : []),
    'Then retry.',
  ].join(' ')
}

/**
 * densable `gXo` — `V.CLAUDE_CODE_LEGACY_BUNDLE===!0`.
 * Same boolean env as `V.CLAUDE_CODE_REMOTE` (1/true/TRUE only).
 */
export function isLegacyBundleEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.CLAUDE_CODE_LEGACY_BUNDLE === '1' ||
    env.CLAUDE_CODE_LEGACY_BUNDLE === 'true' ||
    env.CLAUDE_CODE_LEGACY_BUNDLE === 'TRUE'
  )
}

/**
 * densable TCt `i`:
 * `hardenForDeviceSessions ?? (platform!=="windows" && !gXo())`.
 */
export function shouldRunSeedListingGate(
  hardenForDeviceSessions?: boolean,
): boolean {
  if (hardenForDeviceSessions === true) return true
  if (hardenForDeviceSessions === false) return false
  return getPlatform() !== 'windows' && !isLegacyBundleEnabled()
}
