/** densable Ia / Ro / Ol / vU / l7 / sS / iS / nye / Av / Rv / writePermissionStash / m4 / y_ — read_file / read_asset save-destination permission layer (2.1.289). */
import { normalize, sep } from 'path'
import type { z } from 'zod/v4'
import type { AnyObject, Tool, ToolPermissionContext } from '../../../Tool.js'
import type {
  PermissionDecision,
  PermissionResult,
} from '../../../types/permissions.js'
import { logForDebugging } from '../../../utils/debug.js'
import {
  type ApprovedWrite,
  openApprovedWrite,
  PermissionCheckExpiredError,
  permissionCheckExpiredWriteMessage,
} from '../../../utils/fileToolApprovedOpen.js'
import {
  getFsImplementation,
  resolveDeepestExistingAncestorSync,
  safeResolvePath,
  walkPermissionPaths,
} from '../../../utils/fsOperations.js'
import { expandPath } from '../../../utils/path.js'
import { permissionRuleValueToString } from '../../../utils/permissions/permissionRuleParser.js'
import {
  checkWritePermissionForTool,
  getScratchpadDir,
  isScratchpadEnabled,
  pathInAllowedWorkingPath,
  unresolvedPathDeny,
} from '../../../utils/permissions/filesystem.js'
import { getBootstrapSession } from '../../../utils/sessionRoot.js'
import { WRITE_STASH_EXPIRED } from '../../../utils/sessionSlots.js'
import {
  ARTIFACT_READ_BATCH_LONG_PATH,
  ARTIFACT_READ_BATCH_RULE_ASIDE_MIN,
  isInArtifactScratchpad,
} from '../outDirPaths.js'

/** densable Ia result — every spelling the permission check must cover. */
export type SavePathSpellings =
  | {
      unresolved: false
      requested: string
      spellings: string[]
      landing: string
      leafIsSymlink: boolean
    }
  | {
      unresolved: true
      requested: string
      spellings: string[]
      leafIsSymlink: boolean
    }

/**
 * densable Ia — `sn(e,"permission")`: `~` expansion, symlink-hop spellings,
 * the realpath landing (moved last), `unresolved` when a hop cannot be read.
 */
export function savePathSpellings(path: string): SavePathSpellings {
  const walk = walkPermissionPaths(path)
  const requested = walk.paths[0] ?? path
  const fsImpl = getFsImplementation()
  let leafIsSymlink = false
  try {
    leafIsSymlink = fsImpl.lstatSync(requested).isSymbolicLink()
  } catch {
    leafIsSymlink = false
  }
  if (walk.unresolved) {
    return {
      unresolved: true,
      requested,
      spellings: walk.paths,
      leafIsSymlink,
    }
  }
  if (requested.startsWith('//') || requested.startsWith('\\\\')) {
    return {
      unresolved: false,
      requested,
      spellings: walk.paths,
      landing: requested,
      leafIsSymlink,
    }
  }
  const resolved = safeResolvePath(fsImpl, requested)
  const landing = resolved.isCanonical
    ? resolved.resolvedPath
    : (resolveDeepestExistingAncestorSync(fsImpl, requested) ?? requested)
  const spellings = new Set(walk.paths)
  spellings.delete(landing)
  spellings.add(landing)
  return {
    unresolved: false,
    requested,
    spellings: Array.from(spellings),
    landing,
    leafIsSymlink,
  }
}

/**
 * densable Ro — `Qlr(Ia(e))`: Ia spellings, plus the realpath rendering when
 * the walk was cut short but realpath still resolves.
 */
export function permissionSpellingsFor(path: string): string[] {
  const walked = savePathSpellings(path)
  if (!walked.unresolved) return walked.spellings
  const { resolvedPath, isCanonical, isSymlink } = safeResolvePath(
    getFsImplementation(),
    walked.requested,
  )
  return (isCanonical || isSymlink) && !walked.spellings.includes(resolvedPath)
    ? [...walked.spellings, resolvedPath]
    : walked.spellings
}

/** densable `to` — lowercase with dotless-i / long-s folded. */
function foldCaseForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/\u0131/g, 'i')
    .replace(/\u017f/g, 's')
}

/** densable yXr — segments the scratchpad carve-out still screens. */
const SCRATCHPAD_SCREENED_SEGMENTS = new Set([
  '.git',
  'hooks',
  '.husky',
  '.githooks',
  'node_modules',
  '.vscode',
  '.idea',
  'head',
  'config',
  'objects',
  'refs',
  '.claude',
  'skills',
  'commands',
  'agents',
  '.cargo',
  '.devcontainer',
  '.yarn',
  '.mvn',
])

/** densable zWt / OU — leaf names the carve-out still screens. */
const SCRATCHPAD_SCREENED_LEAF_NAMES = new Set(
  [
    '.gitconfig',
    '.gitmodules',
    '.bashrc',
    '.bash_profile',
    '.zshrc',
    '.zprofile',
    '.profile',
    '.zshenv',
    '.zlogin',
    '.zlogout',
    '.bash_login',
    '.bash_aliases',
    '.bash_logout',
    '.envrc',
    '.ripgreprc',
    '.mcp.json',
    '.claude.json',
    '.npmrc',
    '.yarnrc',
    '.yarnrc.yml',
    '.pnp.cjs',
    '.pnp.loader.mjs',
    '.pnpmfile.cjs',
    'bunfig.toml',
    '.bunfig.toml',
    '.bazelrc',
    '.bazelversion',
    '.bazeliskrc',
    '.pre-commit-config.yaml',
    'lefthook.yml',
    '.lefthook.yml',
    'lefthook.yaml',
    '.lefthook.yaml',
    'gradle-wrapper.properties',
    'maven-wrapper.properties',
    '.devcontainer.json',
    'pyrightconfig.json',
  ].map(name => name.toLowerCase()),
)

const INVISIBLE_FORMAT_CHARS =
  /[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g

/** densable Nc — fold case, drop invisible format chars, `:stream`, trailing dots/spaces. */
function foldSegmentForScreen(segment: string): string {
  const folded = foldCaseForComparison(segment)
  return (
    folded
      .replace(INVISIBLE_FORMAT_CHARS, '')
      .replace(/:.*$/, '')
      .replace(/[. ]+$/, '') || folded
  )
}

/** densable t4 — a segment below `prefix` is one the carve-out screens. */
function hasScreenedSegment(
  comparePath: string,
  prefix: string,
  leafNames: ReadonlySet<string>,
): boolean {
  const segments = comparePath.slice(prefix.length).split(sep)
  const last = segments.length - 1
  for (let i = 0; i < segments.length; i++) {
    const segment = foldSegmentForScreen(segments[i] ?? '')
    if (SCRATCHPAD_SCREENED_SEGMENTS.has(segment)) return true
    if (i === last && leafNames.has(segment)) return true
  }
  return false
}

/** densable Ol — case-folded path vs session scratchpad; null without one. */
export function scratchpadComparison(
  path: string,
): { comparePath: string; compareDir: string; prefix: string } | null {
  if (!isScratchpadEnabled()) return null
  const comparePath = foldCaseForComparison(normalize(path))
  const compareDir = foldCaseForComparison(getScratchpadDir())
  return { comparePath, compareDir, prefix: compareDir + sep }
}

/**
 * densable vU — path is the scratchpad itself, or under it with no screened
 * (git / hook / tool / agent config) segment.
 */
export function isInScratchpadCarveOut(path: string): boolean {
  const cmp = scratchpadComparison(path)
  if (cmp === null) return false
  return (
    cmp.comparePath === cmp.compareDir ||
    (cmp.comparePath.startsWith(cmp.prefix) &&
      !hasScreenedSegment(
        cmp.comparePath,
        cmp.prefix,
        SCRATCHPAD_SCREENED_LEAF_NAMES,
      ))
  )
}

/**
 * densable l7 — non-empty, and every spelling of every dest lies in the
 * scratchpad carve-out (so no link leads out of it).
 */
export function allSpellingsInScratchpadCarveOut(
  spellingsLists: readonly (readonly string[])[],
): boolean {
  return (
    spellingsLists.length > 0 &&
    spellingsLists.every(
      spellings =>
        spellings.length > 0 &&
        spellings.every(spelling => isInScratchpadCarveOut(spelling)),
    )
  )
}

/** densable sS — every spelling (default Ro) lies in a working directory. */
export function isSavePathInWorkingDirectories(
  path: string,
  permissionContext: ToolPermissionContext,
  spellings?: readonly string[],
): boolean {
  return pathInAllowedWorkingPath(
    path,
    permissionContext,
    spellings ?? permissionSpellingsFor(path),
  )
}

function isSymlinkLeafDeny(result: PermissionDecision): boolean {
  return (
    result.behavior === 'deny' &&
    result.decisionReason?.type === 'other' &&
    result.decisionReason.reason === 'Write target is a symbolic link'
  )
}

/**
 * densable iS — the file-edit write check run against a save destination
 * with precomputed Ia spellings. Unlike FileWrite, iS has no symlink-leaf
 * deny (y_ refuses a link leaf at save time instead).
 */
export function checkSaveDestinationWritePermission<Input extends AnyObject>(
  tool: Tool<Input>,
  input: z.infer<Input>,
  permissionContext: ToolPermissionContext,
  resolved?: SavePathSpellings,
): PermissionDecision {
  if (typeof tool.getPath !== 'function') {
    return {
      behavior: 'ask',
      message: `Claude requested permissions to use ${tool.name}, but you haven't granted it yet.`,
    }
  }
  const path = tool.getPath(input)
  const walked = resolved ?? savePathSpellings(path)
  let result = checkWritePermissionForTool(
    tool,
    input,
    permissionContext,
    walked.spellings,
  )
  if (isSymlinkLeafDeny(result)) {
    const canonical = safeResolvePath(getFsImplementation(), expandPath(path))
    if (canonical.isCanonical) {
      // checkWritePermissionForTool reads getPath once for the NS check and
      // again for its symlink-leaf deny; the canonical path is never a link.
      let calls = 0
      result = checkWritePermissionForTool(
        {
          ...tool,
          getPath: () => (calls++ === 0 ? path : canonical.resolvedPath),
        },
        input,
        permissionContext,
        walked.spellings,
      )
    }
  }
  if (result.behavior === 'deny') return result
  if (walked.unresolved) return unresolvedPathDeny('write to', path)
  return result
}

export type ReadFileBatchPlan = {
  aside: string[]
  ruleMatched: string[]
  rules: number
  ruledAside: boolean
  onLine: number
  longOnLine: boolean
  resolved: Map<string, SavePathSpellings>
  verdicts: Map<string, PermissionDecision>
}

/**
 * densable Ca — sort a read_file batch: destinations the scratchpad carve-out
 * screens, or that draw a file-edit safety ask, are set aside; Edit-ask-rule
 * matches are collected (and set aside once there are more than wv of them,
 * unless every kept file matched). null when nothing would be read.
 */
export function planReadFileBatch<Input extends AnyObject>(
  files: readonly { path: string; dest: string }[],
  opts?: {
    tool: Tool<Input>
    input: z.infer<Input>
    permissions: ToolPermissionContext
    resolved?: ReadonlyMap<string, SavePathSpellings>
  },
): ReadFileBatchPlan | null {
  const aside = new Set<string>()
  let protectedCount = 0
  let longOnLine = false
  const verdicts = new Map<string, PermissionDecision>()
  const ruleMatched: string[] = []
  const rules = new Set<string>()
  const resolved = new Map<string, SavePathSpellings>()
  for (const file of files) {
    const walked =
      opts?.resolved?.get(file.dest) ?? savePathSpellings(file.dest)
    resolved.set(file.dest, walked)
    if (
      isInArtifactScratchpad(file.dest) &&
      !allSpellingsInScratchpadCarveOut([walked.spellings])
    ) {
      aside.add(file.path)
      protectedCount++
      continue
    }
    longOnLine ||= file.path.length > ARTIFACT_READ_BATCH_LONG_PATH
    if (opts === undefined) continue
    const verdict = checkSaveDestinationWritePermission(
      opts.tool,
      opts.input,
      opts.permissions,
      walked,
    )
    verdicts.set(file.dest, verdict)
    if (verdict.behavior !== 'ask') continue
    if (
      verdict.decisionReason?.type === 'safetyCheck' &&
      opts.permissions.mode !== 'bypassPermissions'
    ) {
      aside.add(file.path)
    } else if (verdict.decisionReason?.type === 'rule') {
      ruleMatched.push(file.path)
      rules.add(
        permissionRuleValueToString(verdict.decisionReason.rule.ruleValue),
      )
    }
  }
  const allRuled = ruleMatched.length === files.length - aside.size
  const ruledAside =
    !allRuled && ruleMatched.length > ARTIFACT_READ_BATCH_RULE_ASIDE_MIN
      ? ruleMatched
      : []
  const setAside = files
    .map(file => file.path)
    .filter(path => aside.has(path) || ruledAside.includes(path))
  if (setAside.length === files.length) return null
  return {
    aside: setAside,
    ruleMatched: allRuled || ruledAside.length > 0 ? [] : ruleMatched,
    rules: rules.size,
    ruledAside: ruledAside.length > 0,
    onLine: files.length - protectedCount,
    longOnLine,
    resolved,
    verdicts,
  }
}

/** densable nye — ask severity: rule 4, hard safety 3, mode 2, soft safety 1, other 0. */
export function askSeverityRank(result: PermissionResult): number {
  if (result.behavior !== 'ask') return -1
  const reason = result.decisionReason
  switch (reason?.type) {
    case 'rule':
      return 4
    case 'safetyCheck':
      return reason.classifierApprovable ? 1 : 3
    case 'mode':
      return 2
    default:
      return 0
  }
}

/** densable Av — pack per-dest spellings as `${dest}\0${spelling}` under one stash key. */
export function packStashedSpellings(
  dests: readonly string[],
  spellingsLists: readonly (readonly string[])[],
): string[] {
  return spellingsLists.flatMap((spellings, i) =>
    spellings.map(spelling => `${dests[i]}\0${spelling}`),
  )
}

/** densable Rv — unpack an Av stash back into per-dest spellings. */
export function unpackStashedSpellings(
  stashed: readonly string[],
  dests: readonly string[],
): string[][] {
  return dests.map(dest => {
    const prefix = `${dest}\0`
    return stashed
      .filter(entry => entry.startsWith(prefix))
      .map(entry => entry.slice(prefix.length))
  })
}

/** densable GGe — the stash entry was evicted before it was consumed. */
export const WRITE_PERMISSION_STASH_EVICTED: typeof WRITE_STASH_EXPIRED =
  WRITE_STASH_EXPIRED

/** densable `n.session.writePermissionStash.stash(toolUseId, dest, spellings)` */
export function stashWritePermission(
  toolUseId: string | undefined,
  dest: string,
  spellings: readonly string[],
): void {
  getBootstrapSession().writePermissionStash.stash(toolUseId, dest, [
    ...spellings,
  ])
}

/**
 * densable `writePermissionStash.consume(toolUseId, dest)` — takes the entry
 * and clears every other entry of the same toolUseId.
 */
export function takeStashedWritePermission(
  toolUseId: string | undefined,
  dest: string,
): string[] | typeof WRITE_PERMISSION_STASH_EVICTED | undefined {
  return getBootstrapSession().writePermissionStash.consume(toolUseId, dest)
}

/** densable m4 — stashed spellings, else a fresh Ro; evicted stash refuses. */
export function takeApprovedSaveSpellings(
  toolUseId: string | undefined,
  dest: string,
): string[] {
  const stashed = takeStashedWritePermission(toolUseId, dest)
  if (stashed === WRITE_PERMISSION_STASH_EVICTED) {
    throw new PermissionCheckExpiredError(
      permissionCheckExpiredWriteMessage(dest),
    )
  }
  if (stashed !== undefined) return stashed
  if (toolUseId) {
    logForDebugging(
      `takeApprovedPathsForWrite: no check-time stash for toolUseId=${toolUseId}; using fresh resolution`,
    )
  }
  return permissionSpellingsFor(dest)
}

/**
 * densable y_ — pin the save target to the approved spellings: create parents
 * without following a swapped link, refuse a link leaf, re-check before write.
 */
export function prepareGuardedWrite(
  dest: string,
  spellings: readonly string[],
  opts?: { createParents?: boolean },
): Promise<ApprovedWrite> {
  return openApprovedWrite(dest, new Set(spellings), {
    createParents: opts?.createParents === true,
  })
}
