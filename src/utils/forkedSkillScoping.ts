/**
 * densable 2.1.289 forked-skill scoping (W3e / f / Ywo / fIt / Kwo / Xwo / x / p / _).
 *
 * Semantic exports only — never export minify Ywo|W3e|fIt|Kwo|Xwo|H$n|p|x|F.
 * storageV5 reader is gated like gold F() via isHoverRestOn(); when gate off or
 * keys/backend missing, disk fIt is the official fallback.
 */
import { lstat, mkdir, readFile, writeFile } from 'fs/promises'
import { basename, dirname, join, sep } from 'path'
import { z } from 'zod/v4'
import {
  getOriginalCwd,
  getSessionId,
  getSessionProjectDir,
} from '../bootstrap/state.js'
import type { AgentId } from '../types/ids.js'
import { isENOENT } from './errors.js'
import {
  getAgentTranscriptPath,
  getProjectDir,
  getProjectsDir,
} from './sessionPaths.js'
import { isValidStoragePathSegment } from './sessionNameJobSidecar.js'
import { isHoverRestOn, type StorageV5 } from './storageV5/index.js'
import { validateStorageKey } from './storageV5/writeValidate.js'

/** densable `k` — refuse oversized sidecar. */
export const FORKED_SKILL_SCOPING_MAX_BYTES = 524288

/** densable `Or` — max walk depth for absolute-path → sidecar key (`cP`). */
const SIDECAR_PATH_WALK_MAX = 6

const skillNameSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(v => !/[\r\n]/.test(v), { message: 'invalid skill name' })

/** densable `$an` — persisted forked-skill scoping record. */
export const forkedSkillScopingRecordSchema = z.object({
  skillName: skillNameSchema,
  attributionName: skillNameSchema,
  effort: z.union([z.string(), z.number().int().min(1).max(1000)]).optional(),
  frozenCommandDenies: z.array(z.string().max(1024)).max(1000).optional(),
})

/** densable `bPo` — provenance marker body. */
export const forkedSkillProvenanceMarkerSchema = z.object({
  forkedSkill: z.literal(true),
  skillName: skillNameSchema.optional(),
})

export type ForkedSkillScopingRecord = z.infer<
  typeof forkedSkillScopingRecordSchema
>

export type ForkedSkillScopingPaths = {
  scoping: string
  provenanceMarker: string
}

export type ForkedSkillScopingRead =
  | { status: 'valid'; scoping: ForkedSkillScopingRecord; transientRead?: true }
  | { status: 'malformed'; transientRead?: true }
  | { status: 'absent'; transientRead?: true }
  | { status: 'absent-but-marked'; transientRead?: true }

type SidecarStorageKey = {
  namespace: 'sidecar'
  projectKey: string
  sessionId: string
  relPath: string[]
}

type ForkedSkillStorageKeys = {
  scoping: SidecarStorageKey
  provenanceMarker: SidecarStorageKey
}

type StorageV5ReadSurface = Pick<StorageV5, 'statMeta' | 'read'>

type StorageTextProbe =
  | { kind: 'text'; text: string }
  | { kind: 'absent' }
  | { kind: 'unusable'; transientRead?: true }

type StoragePresenceProbe = {
  present: boolean
  transientRead?: true
}

/**
 * densable W3e(jsonlPath) — sidecar paths next to the agent transcript.
 */
export function forkedSkillScopingPaths(
  jsonlPath: string,
): ForkedSkillScopingPaths {
  return {
    scoping: jsonlPath.replace(/\.jsonl$/, '.forked-skill.json'),
    provenanceMarker: jsonlPath.replace(
      /\.jsonl$/,
      '.forked-skill.marker.json',
    ),
  }
}

/**
 * densable f(agentId) = W3e(transcriptPath).
 */
export function forkedSkillScopingPathsForAgent(
  agentId: AgentId | string,
): ForkedSkillScopingPaths {
  return forkedSkillScopingPaths(getAgentTranscriptPath(agentId as AgentId))
}

function asStorageV5ReadSurface(
  value: unknown,
): StorageV5ReadSurface | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { statMeta?: unknown; read?: unknown }
  if (
    typeof candidate.statMeta !== 'function' ||
    typeof candidate.read !== 'function'
  ) {
    return undefined
  }
  return value as StorageV5ReadSurface
}

function createSidecarStorageKey(
  projectKey: string,
  sessionId: string,
  relPath: string[],
): SidecarStorageKey {
  return { namespace: 'sidecar', projectKey, sessionId, relPath }
}

function isValidSidecarStorageKey(key: SidecarStorageKey): boolean {
  return validateStorageKey(key) === undefined
}

function basenameHasJsonlSegment(name: string): boolean {
  const lower = name.toLowerCase()
  const colon = lower.indexOf(':')
  const parts =
    colon === -1
      ? [lower]
      : [lower, lower.slice(0, colon)].map(part => {
          let end = part.length
          while (end > 0) {
            const code = part.charCodeAt(end - 1)
            if (code !== 46 && code !== 32) break
            end -= 1
          }
          return end === part.length ? part : part.slice(0, end)
        })
  return parts.some(part => part.endsWith('.jsonl'))
}

/**
 * densable `cP` — absolute path under projects/ → sidecar key, else undefined.
 */
function sidecarKeyFromAbsolutePath(
  absolutePath: string,
): SidecarStorageKey | undefined {
  const leaf = basename(absolutePath)
  if (basenameHasJsonlSegment(leaf)) return undefined
  const projectsDir = getProjectsDir()
  const segments = [leaf]
  let cursor = dirname(absolutePath)
  while (
    cursor !== projectsDir &&
    segments.length <= SIDECAR_PATH_WALK_MAX + 1
  ) {
    const parent = dirname(cursor)
    if (parent === cursor) return undefined
    segments.unshift(basename(cursor))
    cursor = parent
  }
  if (cursor !== projectsDir || segments.length < 3) return undefined
  const [projectKey, sessionId, ...relPath] = segments
  if (
    projectKey === undefined ||
    sessionId === undefined ||
    !isValidStoragePathSegment(projectKey) ||
    !isValidStoragePathSegment(sessionId) ||
    relPath.length === 0 ||
    !relPath.every(isValidStoragePathSegment)
  ) {
    return undefined
  }
  const key = createSidecarStorageKey(projectKey, sessionId, relPath)
  return isValidSidecarStorageKey(key) ? key : undefined
}

/**
 * densable `_` — map disk sidecar paths to storageV5 keys.
 */
function forkedSkillStorageKeysFromDiskPaths(
  paths: ForkedSkillScopingPaths,
): ForkedSkillStorageKeys | undefined {
  const scoping = sidecarKeyFromAbsolutePath(paths.scoping)
  const provenanceMarker = sidecarKeyFromAbsolutePath(paths.provenanceMarker)
  return scoping && provenanceMarker ? { scoping, provenanceMarker } : undefined
}

function sessionProjectDirForStorage(): string {
  return getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
}

/**
 * densable `p(agentId)` — agent transcript → storageV5 sidecar keys.
 */
function forkedSkillStorageKeysForAgent(
  agentId: AgentId | string,
): ForkedSkillStorageKeys | undefined {
  const projectDir = sessionProjectDirForStorage()
  if (dirname(projectDir) !== getProjectsDir()) return undefined
  const projectKey = basename(projectDir)
  const sessionId = getSessionId()
  const sessionPrefix = join(projectDir, sessionId) + sep
  const transcriptPath = getAgentTranscriptPath(agentId as AgentId)
  if (!transcriptPath.startsWith(sessionPrefix)) return undefined
  const relativeParts = transcriptPath.slice(sessionPrefix.length).split(sep)
  const leaf = relativeParts.at(-1)
  if (
    leaf === undefined ||
    !leaf.endsWith('.jsonl') ||
    ![projectKey, sessionId, ...relativeParts].every(isValidStoragePathSegment)
  ) {
    return undefined
  }
  const parentRel = relativeParts.slice(0, -1)
  const makeKey = (fileName: string): SidecarStorageKey =>
    createSidecarStorageKey(projectKey, sessionId, [...parentRel, fileName])
  const scoping = makeKey(leaf.replace(/\.jsonl$/, '.forked-skill.json'))
  const provenanceMarker = makeKey(
    leaf.replace(/\.jsonl$/, '.forked-skill.marker.json'),
  )
  return isValidSidecarStorageKey(scoping) &&
    isValidSidecarStorageKey(provenanceMarker)
    ? { scoping, provenanceMarker }
    : undefined
}

function transientReadFlag(value: boolean | undefined): {
  transientRead?: true
} {
  return value === true ? { transientRead: true } : {}
}

/** densable `R` / `pIt` — Unavailable or retryable telemetry codes. */
function isTransientStorageError(error: {
  code: string
  telemetryCode?: string
}): boolean {
  if (error.code === 'Unavailable') return true
  const code = error.telemetryCode
  if (code === undefined) return false
  if (
    code === 'EBUSY' ||
    code === 'EMFILE' ||
    code === 'ENFILE' ||
    code === 'EAGAIN' ||
    code === 'EINTR'
  ) {
    return true
  }
  return code === 'EPERM' && process.platform === 'win32'
}

function transientFromStorageError(error: {
  code: string
  telemetryCode?: string
}): { transientRead?: true } {
  return transientReadFlag(isTransientStorageError(error))
}

async function probeStorageText(
  storage: StorageV5ReadSurface,
  key: SidecarStorageKey,
): Promise<StorageTextProbe> {
  const meta = await storage.statMeta(key)
  if (!meta.ok) {
    return meta.error.code === 'NotFound'
      ? { kind: 'absent' }
      : { kind: 'unusable', ...transientFromStorageError(meta.error) }
  }
  if (meta.value.size > FORKED_SKILL_SCOPING_MAX_BYTES) {
    return { kind: 'unusable' }
  }
  const read = await storage.read([key])
  if (!read.ok) {
    return { kind: 'unusable', ...transientFromStorageError(read.error) }
  }
  const item = read.value.items[0]
  if (!item?.found || item.value === undefined) return { kind: 'absent' }
  return { kind: 'text', text: Buffer.from(item.value).toString('utf8') }
}

async function probeStoragePresence(
  storage: StorageV5ReadSurface,
  key: SidecarStorageKey,
): Promise<StoragePresenceProbe> {
  const meta = await storage.statMeta(key)
  if (meta.ok) return { present: true }
  return meta.error.code === 'NotFound'
    ? { present: false }
    : { present: true, ...transientFromStorageError(meta.error) }
}

function parseScopingText(text: string): ForkedSkillScopingRead {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { status: 'malformed' }
  }
  const result = forkedSkillScopingRecordSchema.safeParse(parsed)
  return result.success
    ? { status: 'valid', scoping: result.data }
    : { status: 'malformed' }
}

/**
 * densable `x(storageV5, keys)` — read scoping via storageV5.
 */
async function readForkedSkillScopingFromStorage(
  storage: StorageV5ReadSurface,
  keys: ForkedSkillStorageKeys,
): Promise<ForkedSkillScopingRead> {
  const scoping = await probeStorageText(storage, keys.scoping)
  switch (scoping.kind) {
    case 'text':
      return parseScopingText(scoping.text)
    case 'unusable':
      return {
        status: 'malformed',
        ...transientReadFlag(scoping.transientRead),
      }
    case 'absent': {
      const marker = await probeStoragePresence(storage, keys.provenanceMarker)
      return marker.present
        ? {
            status: 'absent-but-marked',
            ...transientReadFlag(marker.transientRead),
          }
        : { status: 'absent' }
    }
  }
}

async function readAbsentOrMarked(
  provenanceMarker: string,
): Promise<ForkedSkillScopingRead> {
  try {
    await lstat(provenanceMarker)
    return { status: 'absent-but-marked' }
  } catch (err) {
    if (isENOENT(err)) return { status: 'absent' }
    return { status: 'absent-but-marked' }
  }
}

/**
 * densable fIt — disk reader for scoping + provenance marker.
 * Optional storageV5 arm matches gold `fIt(paths, storageV5?)` via `_` + `x`.
 */
export async function readForkedSkillScopingFromDisk(
  paths: ForkedSkillScopingPaths,
  storageV5?: unknown,
): Promise<ForkedSkillScopingRead> {
  const storage = asStorageV5ReadSurface(storageV5)
  const storageKeys =
    isHoverRestOn() && storage
      ? forkedSkillStorageKeysFromDiskPaths(paths)
      : undefined
  if (storage && storageKeys) {
    return readForkedSkillScopingFromStorage(storage, storageKeys)
  }

  let text: string
  try {
    const st = await lstat(paths.scoping)
    if (!st.isFile() || st.size > FORKED_SKILL_SCOPING_MAX_BYTES) {
      return { status: 'malformed' }
    }
    text = await readFile(paths.scoping, 'utf-8')
  } catch (err) {
    if (isENOENT(err)) return readAbsentOrMarked(paths.provenanceMarker)
    return { status: 'malformed' }
  }
  return parseScopingText(text)
}

/**
 * densable Ywo(agentId, storageV5?) — storageV5 when F() + keys, else disk fIt.
 */
export async function readForkedSkillScoping(
  agentId: AgentId | string,
  storageV5?: unknown,
): Promise<ForkedSkillScopingRead> {
  const storage = asStorageV5ReadSurface(storageV5)
  const storageKeys =
    isHoverRestOn() && storage
      ? forkedSkillStorageKeysForAgent(agentId)
      : undefined
  if (storage && storageKeys) {
    return readForkedSkillScopingFromStorage(storage, storageKeys)
  }
  return readForkedSkillScopingFromDisk(
    forkedSkillScopingPathsForAgent(agentId),
  )
}

/**
 * densable Xwo — read skillName from provenance marker witness (cold path).
 * Storage arm mirrors gold: F() && storageV5 → p(agentId) then P(marker).
 */
export async function readForkedSkillProvenanceSkillName(
  agentId: AgentId | string,
  storageV5?: unknown,
): Promise<string | undefined> {
  let text: string | undefined
  const storage = asStorageV5ReadSurface(storageV5)
  const storageKeys =
    isHoverRestOn() && storage
      ? forkedSkillStorageKeysForAgent(agentId)
      : undefined
  if (storage && storageKeys) {
    const probe = await probeStorageText(storage, storageKeys.provenanceMarker)
    if (probe.kind !== 'text') return undefined
    text = probe.text
  } else {
    const { provenanceMarker } = forkedSkillScopingPathsForAgent(agentId)
    try {
      const st = await lstat(provenanceMarker)
      if (!st.isFile() || st.size > FORKED_SKILL_SCOPING_MAX_BYTES)
        return undefined
      text = await readFile(provenanceMarker, 'utf-8')
    } catch {
      return undefined
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const result = forkedSkillProvenanceMarkerSchema.safeParse(parsed)
  return result.success ? result.data.skillName : undefined
}

function provenanceMarkerBody(skillName?: string): string {
  return JSON.stringify({
    forkedSkill: true as const,
    ...(skillName !== undefined ? { skillName } : {}),
  })
}

/**
 * densable Kwo disk arm — write provenance marker + scoping record next to
 * the agent transcript. Call on forked-skill launch.
 */
export async function writeForkedSkillScoping(
  agentId: AgentId | string,
  record: ForkedSkillScopingRecord,
): Promise<void> {
  const parsed = forkedSkillScopingRecordSchema.safeParse(record)
  if (!parsed.success) {
    throw new Error('forked-skill scoping record write failed')
  }
  const paths = forkedSkillScopingPathsForAgent(agentId)
  await mkdir(dirname(paths.scoping), { recursive: true })
  await writeFile(
    paths.provenanceMarker,
    provenanceMarkerBody(parsed.data.skillName),
    'utf-8',
  )
  await writeFile(paths.scoping, JSON.stringify(parsed.data), 'utf-8')
}
