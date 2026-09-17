/**
 * densable leftover zl validators @207412582:
 * z/Ua @207239073, re/bt @207248863, _e/Ka @207235325,
 * Vi/Ct @207297172, Gi/Dt @207297291, rn/O @206342900,
 * Wa @207415651, tn @207414652, qa @207415320.
 */

import { lstat } from 'fs/promises'
import { join } from 'path'

export type WriteValidateErr = { code: string; argument?: string }

function w(argument: string, _message: string): WriteValidateErr {
  return { code: 'InvalidArgument', ...(argument && { argument }) }
}

const s = w

/** densable leftover `I` @206342226. */
export function getKeyWriteDiscipline(
  e: Record<string, unknown>,
): 'plain' | 'versioned' | undefined {
  switch (e.namespace) {
    case 'globalConfig':
      return 'kind' in e ? 'plain' : 'versioned'
    case 'task':
      return 'highWaterMark' in e ? 'plain' : 'versioned'
    case 'team':
    case 'mailbox':
    case 'identity':
      return 'versioned'
    case 'settings':
    case 'memory':
    case 'pluginRegistry':
    case 'marketplaceCache':
    case 'pluginCache':
    case 'pluginAssetCache':
    case 'cache':
    case 'paste':
    case 'state':
    case 'plan':
    case 'feedbackDraft':
    case 'agentMemory':
    case 'sidecar':
    case 'scratch':
    case 'userConfigDir':
    case 'fileHistory':
    case 'job':
    case 'daemon':
    case 'jobsRoot':
    case 'session':
    case 'bridgePointer':
    case 'sessionAliases':
    case 'dirSyncRecord':
      return 'plain'
    default:
      return
  }
}

/** densable leftover `x` @206343415. */
export function formatKeyDisciplineLabel(e: Record<string, unknown>): string {
  if (e.namespace === 'globalConfig' && 'kind' in e) {
    return `globalConfig ${String(e.kind)} copy`
  }
  if (e.namespace === 'task' && 'highWaterMark' in e) {
    return 'task high-water-mark key'
  }
  return `${String(e.namespace)} key`
}

/** densable leftover `N` segment — error text @207239200. */
export function isValidPathSegment(t: string): boolean {
  if (t === '' || /^[.\s]+$/.test(t)) return false
  if (t.includes('/') || t.includes('\\') || t.includes('\0')) return false
  return true
}

function isValidPathSegmentArray(t: unknown): boolean {
  return (
    Array.isArray(t) &&
    t.length > 0 &&
    t.every(s => typeof s === 'string' && isValidPathSegment(s))
  )
}

function isRelPathKeyField(e: string): boolean {
  return e === 'relPath' || e === 'agentRelPath'
}

/** densable leftover `Tn` @207246437. */
export function getKeyFieldSpecs(
  e: Record<string, unknown>,
): Array<[string, unknown, string?]> | undefined {
  switch (e.namespace) {
    case 'transcript':
      return [
        ['projectKey', e.projectKey],
        ['sessionId', e.sessionId],
        ['agentId', e.agentId, 'optional'],
        ['agentRelPath', e.agentRelPath, 'optional'],
      ]
    case 'history':
    case 'identity':
    case 'pluginRegistry':
      return []
    case 'globalConfig':
      return 'kind' in e ? [['stamp', e.stamp]] : []
    case 'settings':
      return e.layer === 'user'
        ? []
        : e.layer === 'project'
          ? [['projectKey', e.projectKey]]
          : [['consentRootKey', e.consentRootKey]]
    case 'task':
      return 'taskId' in e
        ? [
            ['listId', e.listId],
            ['taskId', e.taskId],
          ]
        : [['listId', e.listId]]
    case 'memory':
      return [
        ['projectKey', e.projectKey],
        ['relPath', e.relPath],
      ]
    case 'marketplaceCache':
      return 'relPath' in e
        ? [
            ['marketplace', e.marketplace],
            ['relPath', e.relPath],
          ]
        : [['marketplace', e.marketplace]]
    case 'pluginCache':
      return [
        ['marketplace', e.marketplace],
        ['plugin', e.plugin],
        ['version', e.version],
        ['relPath', e.relPath],
      ]
    case 'cache':
      return [
        ['store', e.store],
        ['id', e.id],
      ]
    case 'paste':
      return [['id', e.id]]
    case 'pluginAssetCache':
      return [['digest', e.digest]]
    case 'state':
      return [['id', e.id]]
    case 'plan':
      return [['name', e.name]]
    case 'feedbackDraft':
      return [['draftId', e.draftId]]
    case 'agentMemory':
      return [
        ...(e.layer === 'user'
          ? []
          : [['projectKey', e.projectKey] as [string, unknown]]),
        ['agentType', e.agentType],
        ['relPath', e.relPath],
      ]
    case 'team':
      return [['team', e.team]]
    case 'sidecar':
      return [
        ['projectKey', e.projectKey],
        ['sessionId', e.sessionId],
        ['relPath', e.relPath],
      ]
    case 'scratch':
      return [
        ['sessionId', e.sessionId],
        ['relPath', e.relPath],
      ]
    case 'userConfigDir':
      return [['relPath', e.relPath]]
    case 'fileHistory':
      return [
        ['sessionId', e.sessionId],
        ['backupFileName', e.backupFileName],
      ]
    case 'job':
      return [
        ['jobId', e.jobId],
        ['relPath', e.relPath],
      ]
    case 'daemon':
      return [['relPath', e.relPath]]
    case 'jobsRoot':
      return 'file' in e ? [['file', e.file]] : [['draftKey', e.draftKey]]
    case 'session':
      return [['file', e.file]]
    case 'bridgePointer':
    case 'sessionAliases':
      return [['projectKey', e.projectKey]]
    case 'dirSyncRecord':
      return [
        ['projectKey', e.projectKey],
        ['sessionId', e.sessionId],
      ]
    case 'mailbox':
      return [
        ['team', e.team],
        ['teammate', e.teammate],
      ]
    case 'log':
      return [
        ['sessionId', e.sessionId],
        ['channel', e.channel],
        ['agentId', e.agentId, 'optional'],
        ['runId', e.runId, 'optional'],
      ]
    case 'jobTimeline':
      return [['jobId', e.jobId]]
    case 'recording':
      return [
        ['projectKey', e.projectKey],
        ['sessionId', e.sessionId],
        ['stamp', e.stamp],
      ]
    case 'sessionLog':
      return [
        ['projectKey', e.projectKey],
        ['year', e.year],
        ['month', e.month],
        ['day', e.day],
        ['logName', e.logName],
      ]
    default:
      return
  }
}

/** densable leftover `an` @207239200. */
export function validateKeyFields(
  e: string,
  n: Array<[string, unknown, string?]>,
): WriteValidateErr | undefined {
  for (const [r, t, o] of n) {
    const i = `${e}.${r}`
    if (t === undefined) {
      if (o !== 'optional') return s(i, 'required')
    } else if (isRelPathKeyField(r)) {
      if (
        !(
          e === 'scope' &&
          r === 'agentRelPath' &&
          Array.isArray(t) &&
          t.length === 0
        ) &&
        !isValidPathSegmentArray(t)
      ) {
        return s(
          i,
          'expected a non-empty array of segments, none empty or made only of dots and spaces, with no path separator, NUL or set-aside shape',
        )
      }
    } else if (typeof t !== 'string' || !isValidPathSegment(t)) {
      return s(i, 'expected a path segment')
    }
  }
}

function isSha256Digest(e: unknown): boolean {
  return typeof e === 'string' && /^[0-9a-f]{64}$/.test(e)
}

/** densable leftover `mn` digest arm — full `mn` is `validateKeyExtrasMn`. */
export function validatePluginAssetDigest(
  e: Record<string, unknown>,
): WriteValidateErr | undefined {
  if (e.namespace === 'pluginAssetCache' && !isSha256Digest(e.digest)) {
    return s(
      'key.digest',
      'must be a SHA-256 digest: 64 lowercase hexadecimal characters',
    )
  }
}

/** densable leftover `z`/`Ua` @207239073 — leftover `mn` then `Tn` then `an`. */
export function validateStorageKey(e: unknown): WriteValidateErr | undefined {
  if (typeof e !== 'object' || e === null) {
    return s('key', 'expected a key object')
  }
  const key = e as Record<string, unknown>
  const n = validateKeyExtrasMn(key)
  if (n !== undefined) return n
  const r = getKeyFieldSpecs(key)
  if (r === undefined) {
    return s('key', `${String(key.namespace)} is not a storage namespace`)
  }
  return validateKeyFields('key', r)
}

/** densable leftover `Ie` @207249800 — scope field specs. */
export function getScopeFieldSpecs(
  e: Record<string, unknown>,
): Array<[string, unknown, string?]> | undefined {
  switch (e.namespace) {
    case 'transcript':
      return [
        ['projectKey', e.projectKey, 'optional'],
        ['sessionId', e.sessionId, 'optional'],
        ['agentRelPath', e.agentRelPath, 'optional'],
      ]
    case 'task':
      return [['listId', e.listId, 'optional']]
    case 'mailbox':
      return [['team', e.team, 'optional']]
    case 'memory':
      return [
        ['projectKey', e.projectKey],
        ['relPath', e.relPath, 'optional'],
      ]
    case 'pluginCache':
      return [
        ['marketplace', e.marketplace, 'optional'],
        ['plugin', e.plugin, 'optional'],
        ['version', e.version, 'optional'],
        ['relPath', e.relPath, 'optional'],
      ]
    case 'marketplaceCache':
      return [
        ['marketplace', e.marketplace],
        ['relPath', e.relPath, 'optional'],
      ]
    case 'cache':
      return [['store', e.store]]
    case 'state':
    case 'plan':
    case 'paste':
    case 'pluginAssetCache':
    case 'feedbackDraft':
    case 'jobsRoot':
    case 'session':
      return []
    case 'sidecar':
      return [
        ['projectKey', e.projectKey],
        ['sessionId', e.sessionId],
        ['relPath', e.relPath, 'optional'],
      ]
    case 'agentMemory':
      return [
        [
          'projectKey',
          e.layer === 'user' ? undefined : e.projectKey,
          'optional',
        ],
        ['agentType', e.agentType, 'optional'],
        ['relPath', e.relPath, 'optional'],
      ]
    case 'scratch':
      return [
        ['sessionId', e.sessionId, 'optional'],
        ['relPath', e.relPath, 'optional'],
      ]
    case 'userConfigDir':
      return [['relPath', e.relPath, 'optional']]
    case 'fileHistory':
      return [['sessionId', e.sessionId, 'optional']]
    case 'job':
      return [
        ['jobId', e.jobId, 'optional'],
        ['relPath', e.relPath, 'optional'],
      ]
    case 'daemon':
      return [['relPath', e.relPath, 'optional']]
    case 'bridgeSpawn':
      return [['dir', e.dir, 'optional']]
    case 'globalConfig':
      return [['kind', e.kind, 'optional']]
    case 'log':
      return [['sessionId', e.sessionId, 'optional']]
    case 'sessionLog':
      return [
        ['projectKey', e.projectKey, 'optional'],
        ['year', e.year, 'optional'],
        ['month', e.month, 'optional'],
        ['day', e.day, 'optional'],
      ]
    default:
      return
  }
}

/** densable leftover `$n` @207249390 — `Et` + `Y` + leftover `It` + extras. */
function validateScopeExtraConstraints(
  e: Record<string, unknown>,
): WriteValidateErr | undefined {
  if (e.namespace === 'agentMemory') {
    const n = validateAgentMemoryScopeEt(e)
    if (n !== undefined) return n
  }
  if (e.namespace === 'transcript' || e.namespace === 'sidecar') {
    const t = validateSessionIdFieldY('scope.sessionId', e.sessionId)
    if (t !== undefined) return t
  }
  const ns = typeof e.namespace === 'string' ? e.namespace : ''
  for (const [t, o] of SCOPE_STREAM_KEY_IT[ns] ?? []) {
    if (t in e && e[t] !== undefined) return s(`scope.${t}`, o)
  }
  if (e.namespace === 'sidecar' && relPathHasJsonlV(e.relPath)) {
    return s('scope.relPath', JSONL_STREAM_O)
  }
  if (e.namespace === 'sidecar' && isRecordingRelQ(e.relPath)) {
    return s('scope.relPath', RECORDING_REL_EN)
  }
  if (
    e.namespace === 'log' &&
    e.channel !== undefined &&
    !isLogChannelWn(e.channel)
  ) {
    return s('scope.channel', LOG_CHANNEL_N)
  }
  if (e.namespace === 'job' && isJobTimelineRelPathSe(e.relPath)) {
    return s('scope.relPath', JOB_TIMELINE_REL_XN)
  }
  if (e.namespace === 'sessionLog') {
    const r = validateSessionLogScopePt(e)
    if (r !== undefined) return r
  }
  if (
    e.namespace === 'scratch' &&
    e.sessionId === undefined &&
    e.relPath !== undefined
  ) {
    return s(
      'scope.relPath',
      'requires scope.sessionId: a scratch relPath narrows one session directory, and no cross-session prefix filter exists',
    )
  }
  if (e.namespace === 'userConfigDir' && !USER_CONFIG_DIR_ON.has(e.dir)) {
    return s('scope.dir', USER_CONFIG_DIR_CN)
  }
  if (
    e.namespace === 'transcript' &&
    e.agentRelPath !== undefined &&
    (e.projectKey === undefined || e.sessionId === undefined)
  ) {
    return s(
      'scope.agentRelPath',
      'requires scope.projectKey and scope.sessionId: an agentRelPath narrows the subagents/ tree of one session directory',
    )
  }
  if (e.namespace === 'transcript' && relPathHasJsonlV(e.agentRelPath)) {
    return s('scope.agentRelPath', JSONL_STREAM_O)
  }
  if (e.namespace === 'pluginCache') {
    if (e.marketplace === undefined && e.plugin !== undefined) {
      return s(
        'scope.plugin',
        'requires scope.marketplace: a plugin narrows one marketplace folder',
      )
    }
    if (e.plugin === undefined && e.version !== undefined) {
      return s(
        'scope.version',
        'requires scope.plugin: a version narrows one plugin folder',
      )
    }
    if (e.version === undefined && e.relPath !== undefined) {
      return s(
        'scope.relPath',
        'requires scope.version: a relPath narrows one version folder',
      )
    }
  }
  if (
    e.namespace === 'job' &&
    e.jobId === undefined &&
    e.relPath !== undefined
  ) {
    return s(
      'scope.relPath',
      'requires scope.jobId: a job relPath narrows one job directory, and no cross-job prefix filter exists',
    )
  }
  if (
    e.namespace === 'transcript' &&
    e.projectKey === undefined &&
    e.sessionId !== undefined
  ) {
    return s(
      'scope.sessionId',
      'requires scope.projectKey: a session narrows one project folder, and no cross-project session filter exists',
    )
  }
  if (
    e.namespace === 'globalConfig' &&
    e.kind !== undefined &&
    !isGlobalCopyKindSn(e.kind)
  ) {
    return s('scope.kind', GLOBAL_COPY_KIND_YN)
  }
}

/** densable leftover `qa`/`ke` @207249242. */
export function validateStorageScope(e: unknown): WriteValidateErr | undefined {
  if (typeof e !== 'object' || e === null) {
    return s('scope', 'expected a scope object')
  }
  const scope = e as Record<string, unknown>
  const n = getScopeFieldSpecs(scope)
  if (n === undefined) {
    return s('scope', `${String(scope.namespace)} is not a listable namespace`)
  }
  return validateScopeExtraConstraints(scope) ?? validateKeyFields('scope', n)
}

/** densable leftover `re`/`bt`/`Wa`/`Dn` @207248863. */
export function validateBridgeSpawnRoot(
  roots: { configHome: string; bridgeSpawnRoot?: string },
  n: Record<string, unknown>,
  argument: 'key' | 'scope' = 'key',
): WriteValidateErr | undefined {
  if (n.namespace !== 'bridgeSpawn') return
  const t = roots.bridgeSpawnRoot
  if (t === undefined) {
    return s(argument, 'this store has no bridge-spawn root')
  }
  if (t === roots.configHome || t.startsWith(roots.configHome)) {
    return s(argument, 'the bridge-spawn root cannot hold the config home')
  }
}

/** densable leftover `_e`/`Ka` @207235325. */
export function validateMarketplaceCacheReadOnly(
  e: Record<string, unknown>,
): WriteValidateErr | undefined {
  if (e.namespace === 'marketplaceCache' && 'relPath' in e) {
    return s(
      'key',
      'marketplace tree keys are read-only: the tree is written by its clone or publish',
    )
  }
}

/** densable leftover `Vi`/`Ct` @207297172. */
export function validateWriteData(e: unknown): WriteValidateErr | undefined {
  return typeof e === 'string' || e instanceof Uint8Array
    ? undefined
    : w('data', 'must be a string or a Uint8Array')
}

function isIfMatchPrecondition(e: unknown): boolean {
  if (typeof e !== 'object' || e === null || !('type' in e)) return false
  const rec = e as Record<string, unknown>
  if (rec.type === 'ifMatch' && typeof rec.version === 'string') return true
  return false
}

function isValidPreconditionShape(e: unknown): boolean {
  if (typeof e !== 'object' || e === null || !('type' in e)) return false
  const rec = e as Record<string, unknown>
  if (rec.type === 'none') return Object.keys(rec).length === 1
  if (rec.type === 'ifAbsent') return true
  return isIfMatchPrecondition(e)
}

/** densable leftover `Gi`/`Dt` @207297291. */
export function validatePreconditionOpt(
  e: unknown,
): WriteValidateErr | undefined {
  if (e === undefined) return
  return isValidPreconditionShape(e)
    ? undefined
    : w(
        'opts.precondition',
        'must be { type: ifMatch, version }, { type: ifAbsent }, or { type: none }',
      )
}

/** densable leftover `rn`/`O` @206342900. */
export function validatePreconditionDiscipline(
  e: Record<string, unknown>,
  n: { type?: string } | undefined,
): WriteValidateErr | undefined {
  const a = getKeyWriteDiscipline(e)
  if (a === undefined) {
    return w(
      'key',
      `${String(e.namespace)} is not a value namespace: the write cannot classify its discipline`,
    )
  }
  const t = formatKeyDisciplineLabel(e)
  if (a === 'versioned' && n === undefined) {
    return w(
      'opts.precondition',
      `a ${t} is versioned: update(), write with ifMatch (casRetry), create with ifAbsent, or declare { type: 'none' } for a blind overwrite`,
    )
  }
  if (a === 'plain' && n?.type === 'ifMatch') {
    return w(
      'opts.precondition',
      `a ${t} is plain, last writer wins: ifMatch cannot be honored against unconditional writers`,
    )
  }
}

/** densable leftover `tn` @207414652. */
export function validateParentOpt(
  e: { parent?: string } | undefined,
): WriteValidateErr | undefined {
  const r = e?.parent
  return r === undefined || r === 'create' || r === 'mustExist'
    ? undefined
    : w('opts.parent', "must be 'create' or 'mustExist'")
}

/** densable leftover `qa` @207415320. */
export function validateWriteMiscOpts(
  e: Record<string, unknown> | undefined,
): WriteValidateErr | undefined {
  if (!e) return
  const r = e.exactMode
  if (
    r !== undefined &&
    (typeof r !== 'number' || !Number.isInteger(r) || r < 0 || r > 4095)
  ) {
    return w(
      'opts.exactMode',
      'must be an integer permission mode between 0 and 0o7777',
    )
  }
  for (const n of ['keepExistingMode', 'flush'] as const) {
    const t = e[n]
    if (t !== undefined && typeof t !== 'boolean') {
      return w(`opts.${n}`, 'must be a boolean')
    }
  }
}

/** densable leftover `Wa` @207415651. */
export function validatePublishDisciplineOpt(
  e: Record<string, unknown>,
  r:
    | { publishDiscipline?: string; precondition?: { type?: string } }
    | undefined,
): WriteValidateErr | undefined {
  const n = r?.publishDiscipline
  if (n === undefined || n === 'atomic') return
  if (n !== 'inPlace' && n !== 'followAtomic') {
    return w(
      'opts.publishDiscipline',
      "must be 'atomic', 'inPlace' or 'followAtomic'",
    )
  }
  if (n === 'inPlace' && getKeyWriteDiscipline(e) === 'versioned') {
    return w(
      'opts.publishDiscipline',
      `a ${formatKeyDisciplineLabel(e)} is versioned: its writers compare-and-set, and an in-place rewrite would tear their reads — 'inPlace' is refused on versioned keys`,
    )
  }
  const t = r?.precondition
  if (t !== undefined && t.type !== 'none') {
    return w(
      'opts.publishDiscipline',
      `'${n}' writes are unconditional; omit the precondition`,
    )
  }
}

/** densable leftover `za`/`er` @207257341 — makeParent except jobTimeline. */
export function shouldMakeParentDir(e: Record<string, unknown>): boolean {
  return e.namespace !== 'jobTimeline'
}

/** densable leftover `Or` @207275728 — state ids `Lr` follows. */
const READ_FOLLOW_STATE_IDS = new Set([
  'user-memory',
  'keybindings',
  'daemon-config',
  'loop-file',
])

/**
 * densable leftover `J`=`Lr`=`w8c` @207234064 — read symlink class.
 * Write path stays leftover `Kr`.
 */
export function getReadSymlinkClass(
  e: Record<string, unknown>,
): 'follow' | 'refuse' {
  switch (e.namespace) {
    case 'settings':
      return e.layer === 'user' ? 'follow' : 'refuse'
    case 'globalConfig':
      return 'kind' in e ? 'refuse' : 'follow'
    case 'state':
      return typeof e.id === 'string' && READ_FOLLOW_STATE_IDS.has(e.id)
        ? 'follow'
        : 'refuse'
    case 'userConfigDir':
      return getUserConfigDirReadSymlinkClass(e.dir)
    case 'memory':
      return getMemoryRelPathSymlinkPolicy(e.relPath)
    case 'agentMemory':
      return 'follow'
    case 'marketplaceCache':
      return 'relPath' in e ? 'follow' : 'refuse'
    case 'plan':
    case 'task':
    case 'pluginRegistry':
    case 'pluginCache':
    case 'pluginAssetCache':
    case 'cache':
    case 'paste':
    case 'feedbackDraft':
    case 'identity':
    case 'team':
    case 'sidecar':
    case 'scratch':
    case 'job':
    case 'jobsRoot':
    case 'session':
    case 'transcript':
    case 'history':
    case 'mailbox':
    case 'log':
    case 'jobTimeline':
    case 'recording':
    case 'sessionLog':
    case 'bridgePointer':
    case 'sessionAliases':
    case 'dirSyncRecord':
    case 'daemon':
    case 'fileHistory':
      return 'refuse'
    default:
      return 'refuse'
  }
}

/** densable leftover `me` @207238009 — `Lr` userConfigDir. */
function getUserConfigDirReadSymlinkClass(dir: unknown): 'follow' | 'refuse' {
  switch (dir) {
    case 'commands':
    case 'agents':
    case 'output-styles':
    case 'skills':
    case 'workflows':
    case 'routines':
    case 'themes':
    case 'rules':
      return 'follow'
    case 'session-env':
    case 'uploads':
    case 'mcp-skill-archives':
    case 'usage-data':
    case 'mcp-discovery-cache':
      return 'refuse'
    default:
      return 'refuse'
  }
}

/** densable leftover `Kr` @207236900 — symlink policy. */
export function getSymlinkPolicy(
  e: Record<string, unknown>,
): 'follow' | 'refuse' {
  switch (e.namespace) {
    case 'userConfigDir':
      return getUserConfigDirSymlinkPolicy(e.dir) === 'follow'
        ? 'follow'
        : 'refuse'
    case 'memory':
      return getMemoryRelPathSymlinkPolicy(e.relPath)
    case 'agentMemory':
    case 'marketplaceCache':
      return 'follow'
    default:
      return 'refuse'
  }
}

function getUserConfigDirSymlinkPolicy(dir: unknown): 'follow' | 'refuse' {
  switch (dir) {
    case 'commands':
    case 'agents':
    case 'output-styles':
    case 'skills':
    case 'workflows':
    case 'routines':
    case 'themes':
    case 'rules':
      return 'follow'
    default:
      return 'refuse'
  }
}

/**
 * densable leftover `M`=`"timeline.jsonl"` @207274040 — job first-seg.
 * leftover `xn` @207277702: `${M} is the job's timeline stream: address it
 * as keys.jobTimeline(jobId)`.
 */
const JOB_TIMELINE_FILE_M = 'timeline.jsonl'
const JOB_TIMELINE_REL_XN = `${JOB_TIMELINE_FILE_M} is the job's timeline stream: address it as keys.jobTimeline(jobId)`

/**
 * densable leftover `Xe`=`Had`=`T`=`"team"` @206341034 — first-seg alias.
 * Official `rn` is `I(n).includes(Xe)`, not `includes('..')`.
 */
const MEMORY_REL_ALIAS_XE = 'team'
/** densable leftover `V` @206341034 — `p` alias-segment cache cap. */
const MEMORY_REL_ALIAS_CACHE_CAP = 32768
const memoryRelAliasCache = new Map<string, readonly string[]>()

/** densable leftover `c` @206341034 — trim trailing `.` / space. */
function trimMemoryRelAliasTail(e: string): string {
  let n = e.length
  while (n > 0) {
    const a = e.charCodeAt(n - 1)
    if (a !== 46 && a !== 32) break
    n -= 1
  }
  return n === e.length ? e : e.slice(0, n)
}

/** densable leftover `o` @206341034 — lower + optional `:` prefix pair. */
function memoryRelAliasSegmentsO(e: string): string[] {
  const n = e.toLowerCase()
  const a = n.indexOf(':')
  return a === -1
    ? [trimMemoryRelAliasTail(n)]
    : [trimMemoryRelAliasTail(n), trimMemoryRelAliasTail(n.slice(0, a))]
}

/**
 * densable leftover `I`=`Iad`=`p` @206341557 — cached `o` alias segments.
 * Distinct from leftover `I`=`Pad` `getKeyWriteDiscipline` @206342226.
 */
function memoryRelAliasSegmentsI(e: string): readonly string[] {
  const cached = memoryRelAliasCache.get(e)
  if (cached !== undefined) return cached
  const a = Object.freeze(memoryRelAliasSegmentsO(e))
  if (memoryRelAliasCache.size >= MEMORY_REL_ALIAS_CACHE_CAP) {
    memoryRelAliasCache.clear()
  }
  memoryRelAliasCache.set(e, a)
  return a
}

/** densable leftover `rn` @207237689. */
function getMemoryRelPathSymlinkPolicy(relPath: unknown): 'follow' | 'refuse' {
  const n = Array.isArray(relPath) ? relPath[0] : undefined
  return typeof n === 'string' &&
    memoryRelAliasSegmentsI(n).includes(MEMORY_REL_ALIAS_XE)
    ? 'refuse'
    : 'follow'
}

/**
 * densable leftover `Se` @207245150 — `I(e[0]).includes(M)`.
 * Distinct from leftover `Se`=`ma` identity @207228950.
 */
function isJobTimelineRelPathSe(relPath: unknown): boolean {
  return (
    Array.isArray(relPath) &&
    typeof relPath[0] === 'string' &&
    memoryRelAliasSegmentsI(relPath[0]).includes(JOB_TIMELINE_FILE_M)
  )
}

/** leftover `mn`/`$n` job `Se` → `s(key|scope.relPath, xn)`. */
function validateJobTimelineRelPathSe(
  e: Record<string, unknown>,
  prefix: 'key' | 'scope',
): WriteValidateErr | undefined {
  if (e.namespace === 'job' && isJobTimelineRelPathSe(e.relPath)) {
    return s(`${prefix}.relPath`, JOB_TIMELINE_REL_XN)
  }
}

const RECORDING_SUFFIX_F = '.cast'
const DIR_SYNC_YE = '.dir-sync.json'
const META_JSON_BE = '.meta.json'
const JSONL_STREAM_O =
  'names a .jsonl stream, which only a transcript key addresses'
const LOG_CHANNEL_N = 'must be debug, telemetry or apiDump'
const RECORDING_STAMP_QR =
  'must be the recording stamp: 1 to 16 decimal digits (epoch milliseconds)'
const RECORDING_REL_EN = `<stamp>${RECORDING_SUFFIX_F} inside a session's folder is that session's terminal recording stream: address it as keys.recording(projectKey, sessionId, stamp)`
const USER_CONFIG_DIRS_SN = [
  'commands',
  'agents',
  'output-styles',
  'skills',
  'workflows',
  'routines',
  'themes',
  'rules',
  'session-env',
  'uploads',
  'mcp-skill-archives',
  'usage-data',
  'mcp-discovery-cache',
] as const
const USER_CONFIG_DIR_ON = new Set<unknown>(USER_CONFIG_DIRS_SN)
const USER_CONFIG_DIR_CN = `must be one of the userConfigDir directory names (${USER_CONFIG_DIRS_SN.join(', ')})`
const PLUGIN_REGISTRY_UN = [
  'installed',
  'marketplaces',
  'flagged',
  'catalog',
  'inUseSweep',
] as const
const PLUGIN_REGISTRY_GR = new Set<unknown>(PLUGIN_REGISTRY_UN)
const PLUGIN_REGISTRY_HR = `must be one of the pluginRegistry files (${PLUGIN_REGISTRY_UN.join(', ')})`
const MARKET_FORMS_LN = ['manifest', 'catalog'] as const
const MARKET_FORMS_UR = new Set<unknown>(MARKET_FORMS_LN)
const MARKET_FORMS_YR = `must be one of the marketplaceCache forms (${MARKET_FORMS_LN.join(', ')})`
const SESSION_JOURNALS_DN = ['world'] as const
const SESSION_JOURNALS_BR = new Set<unknown>(SESSION_JOURNALS_DN)
const SESSION_JOURNALS_JR = `must be one of the session journal names (${SESSION_JOURNALS_DN.join(', ')})`
const GLOBAL_COPY_KINDS_HE = ['backup', 'corrupted'] as const
const GLOBAL_COPY_KINDS_QR = new Set<unknown>(GLOBAL_COPY_KINDS_HE)
const GLOBAL_COPY_KIND_YN = `must be one of the global-config copy kinds (${GLOBAL_COPY_KINDS_HE.join(', ')})`
const RESERVED_SESSION_IN = new Set([
  'memory',
  'tiny_memory',
  'bagel',
  'cloud-snapshots',
  'bridge-pointer.json',
  '.session-aliases',
])
const STAMP_DIGITS_ZR = /^[0-9]{1,16}$/
const SIBLING_ENDS_KN = [
  '.ccr-tip.json',
  '.precompact.json',
  RECORDING_SUFFIX_F,
]
const SIBLING_ET = `must not end with ${SIBLING_ENDS_KN.join(', ')}: those name a session's project-level sibling files`
const DIR_SYNC_NT = `must not end with ${DIR_SYNC_YE}: that names a cloud session's directory-sync record at the project level`
const RESERVED_RT = `${[...RESERVED_SESSION_IN].join(', ')} are reserved: they name project-level entries, not sessions`
const YEAR_KN = /^\d{4}$/
const MONTH_DAY_DE = /^\d{2}$/
const SESSION_LOG_UT = /^[A-Za-z0-9_-]{1,8}(?:-[a-z0-9]+)*$/
const SESSION_LOG_LT = 128
const DEVICE_DT = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i
const DRAFT_KEY_HT = /^[0-9a-f]{8}$/
/** densable leftover `fe`=`qad`=`zn` @205859549. */
const BACKUP_FILE_FE = /^[0-9a-f]{16}(?:[0-9a-f]{48})?@v\d+$/
const META_TASK_AT =
  '.meta is reserved for the list metadata key, under every spelling that opens its file'

/**
 * densable leftover `It` @207277935 — scope stream-key refusals.
 */
const SCOPE_STREAM_KEY_IT: Record<
  string,
  ReadonlyArray<readonly [string, string]>
> = {
  transcript: [
    [
      'agentId',
      'names one agent transcript, a stream key, not a scope: narrow a scope with agentRelPath',
    ],
    [
      'journal',
      'names a run journal, a stream key, not a scope: narrow a scope with agentRelPath',
    ],
    [
      'sessionJournal',
      "names a session's own journal, a stream key, not a scope: the session scope lists it",
    ],
  ],
  log: [
    ['agentId', 'names one log stream, a stream key, not a scope'],
    ['runId', 'names one log stream, a stream key, not a scope'],
  ],
  sessionLog: [
    [
      'logName',
      "names one session's log, a stream key, not a scope: a day scope lists its logs",
    ],
  ],
  task: [
    [
      'taskId',
      'names one task value, a key, not a scope: a list scope narrows with listId only',
    ],
    [
      'meta',
      'names one task value, a key, not a scope: a list scope narrows with listId only',
    ],
    [
      'highWaterMark',
      'names one task value, a key, not a scope: a list scope narrows with listId only',
    ],
  ],
  mailbox: [['teammate', 'names one inbox, a key, not a scope']],
  cache: [
    [
      'id',
      'names one cached value, a key, not a scope: a cache scope narrows with store only',
    ],
  ],
  pluginAssetCache: [['digest', 'names one cached asset, a key, not a scope']],
  fileHistory: [
    [
      'backupFileName',
      'names one backup, a key, not a scope: a file-history scope narrows with sessionId only',
    ],
  ],
  state: [['id', 'names one value, a key, not a scope']],
  feedbackDraft: [['draftId', 'names one draft, a key, not a scope']],
  jobsRoot: [
    ['file', 'names one value, a key, not a scope'],
    ['draftKey', 'names one value, a key, not a scope'],
  ],
  plan: [['name', 'names one plan, a key, not a scope']],
  paste: [['id', 'names one paste, a key, not a scope']],
  session: [['file', 'names one value, a key, not a scope']],
  globalConfig: [
    [
      'stamp',
      'names one recovery copy, a key, not a scope: the scope narrows with kind only',
    ],
  ],
  marketplaceCache: [
    [
      'form',
      "names one of the marketplace's two engine-written files, a key, not a scope: the tree narrows with relPath only",
    ],
  ],
  memory: [],
  pluginCache: [],
  daemon: [],
  sidecar: [],
  agentMemory: [],
  scratch: [],
  userConfigDir: [],
  job: [],
  bridgeSpawn: [],
}

/** densable leftover `S`=`E`=`Gad` @206341034. */
function endsWithJsonlAliasS(e: string): boolean {
  return memoryRelAliasSegmentsI(e).some(n => n.endsWith('.jsonl'))
}

function isReservedSessionNameCn(e: string): boolean {
  return memoryRelAliasSegmentsI(e).some(n => RESERVED_SESSION_IN.has(n))
}

function endsWithSiblingRn(e: string): boolean {
  return memoryRelAliasSegmentsI(e).some(n =>
    SIBLING_ENDS_KN.some(r => n.endsWith(r)),
  )
}

function endsWithDirSyncPn(e: string): boolean {
  return memoryRelAliasSegmentsI(e).some(n => n.endsWith(DIR_SYNC_YE))
}

/** densable leftover `Y` @207243559. */
function validateSessionIdFieldY(
  e: string,
  n: unknown,
): WriteValidateErr | undefined {
  if (typeof n !== 'string') return
  if (isReservedSessionNameCn(n)) return s(e, RESERVED_RT)
  if (endsWithSiblingRn(n)) return s(e, SIBLING_ET)
  if (endsWithDirSyncPn(n)) return s(e, DIR_SYNC_NT)
  return endsWithJsonlAliasS(n) ? s(e, JSONL_STREAM_O) : undefined
}

/** densable leftover `V` @207243781. */
function relPathHasJsonlV(e: unknown): boolean {
  return (
    Array.isArray(e) &&
    e.some(n => typeof n === 'string' && endsWithJsonlAliasS(n))
  )
}

/** densable leftover `jn` @207243075. */
function isRecordingStampJn(e: unknown): boolean {
  return typeof e === 'string' && STAMP_DIGITS_ZR.test(e)
}

/** densable leftover `X` @207243180. */
function recordingStampFromSegX(e: string): string | undefined {
  if (!e.endsWith(RECORDING_SUFFIX_F)) return
  const n = e.slice(0, -RECORDING_SUFFIX_F.length)
  return isRecordingStampJn(n) ? n : undefined
}

/** densable leftover `q` @207243129. */
function isRecordingRelQ(e: unknown): boolean {
  return (
    Array.isArray(e) &&
    typeof e[0] === 'string' &&
    memoryRelAliasSegmentsI(e[0]).some(
      n => recordingStampFromSegX(n) !== undefined,
    )
  )
}

function isLayerHn(e: unknown): boolean {
  return e === 'user' || e === 'project' || e === 'local'
}

function isLogChannelWn(e: unknown): boolean {
  return e === 'debug' || e === 'telemetry' || e === 'apiDump'
}

function isGlobalCopyKindSn(e: unknown): boolean {
  return GLOBAL_COPY_KINDS_QR.has(e)
}

function matchesDigitsLe(re: RegExp, n: unknown): boolean {
  return typeof n === 'string' && re.test(n)
}

function isSessionLogStemFn(e: unknown): boolean {
  return (
    typeof e === 'string' &&
    e.length <= SESSION_LOG_LT &&
    SESSION_LOG_UT.test(e) &&
    !DEVICE_DT.test(e)
  )
}

function isMetaTaskIdSt(e: unknown): boolean {
  return (
    typeof e === 'string' &&
    memoryRelAliasSegmentsI(`${e}.json`).includes(META_JSON_BE)
  )
}

/** densable leftover `On` @207245377. */
function validateSessionLogDateOn(
  e: string,
  n: Record<string, unknown>,
): WriteValidateErr | undefined {
  if (n.year !== undefined && !matchesDigitsLe(YEAR_KN, n.year)) {
    return s(`${e}.year`, 'must be four digits (YYYY)')
  }
  if (n.month !== undefined && !matchesDigitsLe(MONTH_DAY_DE, n.month)) {
    return s(`${e}.month`, 'must be two digits (MM)')
  }
  if (n.day !== undefined && !matchesDigitsLe(MONTH_DAY_DE, n.day)) {
    return s(`${e}.day`, 'must be two digits (DD)')
  }
}

/** densable leftover `pt` @207245708. */
function validateSessionLogScopePt(
  e: Record<string, unknown>,
): WriteValidateErr | undefined {
  if (e.year !== undefined && e.projectKey === undefined) {
    return s('scope.projectKey', 'required when year is given')
  }
  if (e.month !== undefined && e.year === undefined) {
    return s('scope.year', 'required when month is given')
  }
  if (e.day !== undefined && e.month === undefined) {
    return s('scope.month', 'required when day is given')
  }
  return validateSessionLogDateOn('scope', e)
}

/** densable leftover `Wr` @207241923. */
function validateFileHistoryBackupWr(
  e: Record<string, unknown>,
): WriteValidateErr | undefined {
  return typeof e.backupFileName !== 'string' ||
    !BACKUP_FILE_FE.test(e.backupFileName)
    ? s(
        'key.backupFileName',
        'must be a backup file name the engine has ever written (hex hash @v version)',
      )
    : undefined
}

/** densable leftover `it` @207243986. */
function validateTaskKeyIt(
  e: Record<string, unknown>,
): WriteValidateErr | undefined {
  if ('taskId' in e && ('meta' in e || 'highWaterMark' in e)) {
    return s(
      'key.taskId',
      'a task key names an item, the list metadata or the list high-water mark, never more than one',
    )
  }
  if ('meta' in e && 'highWaterMark' in e) {
    return s(
      'key.highWaterMark',
      'a task key names an item, the list metadata or the list high-water mark, never more than one',
    )
  }
  if ('meta' in e && e.meta !== true) return s('key.meta', 'must be true')
  if ('highWaterMark' in e && e.highWaterMark !== true) {
    return s('key.highWaterMark', 'must be true')
  }
  if (typeof e.listId !== 'string') {
    return s('key.listId', 'a task key carries its listId')
  }
  if ('meta' in e || 'highWaterMark' in e) return
  if (typeof e.taskId !== 'string') {
    return s('key.taskId', 'a task item key carries its taskId')
  }
  if (isMetaTaskIdSt(e.taskId)) return s('key.taskId', META_TASK_AT)
}

/** densable leftover `ct` @207244753. */
function validateJobsRootKeyCt(
  e: Record<string, unknown>,
): WriteValidateErr | undefined {
  if ('file' in e && 'draftKey' in e) {
    return s(
      'key.draftKey',
      'a jobs-root key names the pins file or one draft, never both',
    )
  }
  if ('file' in e) {
    return e.file === 'pins' ? undefined : s('key.file', 'must be pins')
  }
  if (typeof e.draftKey !== 'string') {
    return s('key.draftKey', 'a jobs-root draft key carries its draftKey')
  }
  return DRAFT_KEY_HT.test(e.draftKey)
    ? undefined
    : s('key.draftKey', 'must be 8 lowercase hex characters')
}

/** densable leftover `Xr` @207242211. */
function validateTranscriptKeyXr(
  e: Record<string, unknown>,
): WriteValidateErr | undefined {
  const n = validateSessionIdFieldY('key.sessionId', e.sessionId)
  if (n !== undefined) return n
  if (relPathHasJsonlV(e.agentRelPath)) {
    return s('key.agentRelPath', JSONL_STREAM_O)
  }
  if ('sessionJournal' in e) {
    if (
      typeof e.sessionJournal !== 'string' ||
      !SESSION_JOURNALS_BR.has(e.sessionJournal)
    ) {
      return s('key.sessionJournal', SESSION_JOURNALS_JR)
    }
    return e.agentId === undefined &&
      e.agentRelPath === undefined &&
      !('journal' in e)
      ? undefined
      : s(
          'key.sessionJournal',
          "a session journal key names the session's own journal: no agentId, agentRelPath or run journal",
        )
  }
  if ('journal' in e) {
    if (e.journal !== true) return s('key.journal', 'must be true')
    if (!Array.isArray(e.agentRelPath)) {
      return s(
        'key.agentRelPath',
        'a run journal key carries its run directory',
      )
    }
    return e.agentId === undefined
      ? undefined
      : s(
          'key.agentId',
          'a transcript key names an agent transcript or the run journal, never both',
        )
  }
  return e.agentRelPath !== undefined && e.agentId === undefined
    ? s('key.agentRelPath', 'requires agentId or journal')
    : undefined
}

/** densable leftover `Et` @207251601. */
function validateAgentMemoryScopeEt(
  e: Record<string, unknown>,
): WriteValidateErr | undefined {
  if (!isLayerHn(e.layer)) {
    return s('scope.layer', 'must be user, project or local')
  }
  if (e.layer === 'user' && 'projectKey' in e) {
    return s('scope.projectKey', 'the user layer is not keyed by project')
  }
  if (e.layer !== 'user' && typeof e.projectKey !== 'string') {
    return s('scope.projectKey', 'required for the project and local layers')
  }
  return e.agentType === undefined && e.relPath !== undefined
    ? s(
        'scope.relPath',
        'requires scope.agentType: an agent-memory relPath narrows one agent directory',
      )
    : undefined
}

/**
 * densable leftover `mn` @207239882 — `Ua` extras before `Tn`/`an`.
 */
function validateKeyExtrasMn(
  e: Record<string, unknown>,
): WriteValidateErr | undefined {
  if (e.namespace === 'transcript') return validateTranscriptKeyXr(e)
  if (e.namespace === 'pluginAssetCache' && !isSha256Digest(e.digest)) {
    return s(
      'key.digest',
      'must be a SHA-256 digest: 64 lowercase hexadecimal characters',
    )
  }
  if (e.namespace === 'globalConfig' && 'kind' in e) {
    if (!isGlobalCopyKindSn(e.kind)) return s('key.kind', GLOBAL_COPY_KIND_YN)
    if (typeof e.stamp !== 'string') {
      return s('key.stamp', 'a recovery copy key carries its stamp')
    }
  }
  if (e.namespace === 'task') return validateTaskKeyIt(e)
  if (e.namespace === 'sidecar') {
    const n = validateSessionIdFieldY('key.sessionId', e.sessionId)
    if (n !== undefined) return n
    if (relPathHasJsonlV(e.relPath)) return s('key.relPath', JSONL_STREAM_O)
    return isRecordingRelQ(e.relPath)
      ? s('key.relPath', RECORDING_REL_EN)
      : undefined
  }
  if (e.namespace === 'recording') {
    return (
      validateSessionIdFieldY('key.sessionId', e.sessionId) ??
      (isRecordingStampJn(e.stamp)
        ? undefined
        : s('key.stamp', RECORDING_STAMP_QR))
    )
  }
  if (e.namespace === 'jobsRoot') return validateJobsRootKeyCt(e)
  if (e.namespace === 'userConfigDir' && !USER_CONFIG_DIR_ON.has(e.dir)) {
    return s('key.dir', USER_CONFIG_DIR_CN)
  }
  if (e.namespace === 'fileHistory') return validateFileHistoryBackupWr(e)
  if (e.namespace === 'settings' && !isLayerHn(e.layer)) {
    return s('key.layer', 'must be user, project or local')
  }
  if (e.namespace === 'log' && !isLogChannelWn(e.channel)) {
    return s('key.channel', LOG_CHANNEL_N)
  }
  if (e.namespace === 'job' && isJobTimelineRelPathSe(e.relPath)) {
    return s('key.relPath', JOB_TIMELINE_REL_XN)
  }
  if (e.namespace === 'sessionLog') {
    return (
      validateSessionLogDateOn('key', e) ??
      (isSessionLogStemFn(e.logName)
        ? undefined
        : s(
            'key.logName',
            'must be the session-log stem <sessionId8>[-<title-slug>]: up to eight word characters, then lower-case a-z / 0-9 runs joined by single hyphens; not a bare device name',
          ))
    )
  }
  if (e.namespace === 'pluginRegistry' && !PLUGIN_REGISTRY_GR.has(e.file)) {
    return s('key.file', PLUGIN_REGISTRY_HR)
  }
  if (e.namespace === 'marketplaceCache') {
    if (!('relPath' in e)) {
      return MARKET_FORMS_UR.has(e.form)
        ? undefined
        : s('key.form', MARKET_FORMS_YR)
    }
    return e.form === undefined
      ? undefined
      : s('key.form', 'a tree file key carries relPath, not form')
  }
  if (e.namespace !== 'agentMemory') return
  if (!isLayerHn(e.layer)) {
    return s('key.layer', 'must be user, project or local')
  }
  if (e.layer === 'user' && 'projectKey' in e) {
    return s('key.projectKey', 'the user layer is not keyed by project')
  }
  if (e.layer !== 'user' && typeof e.projectKey !== 'string') {
    return s('key.projectKey', 'required for the project and local layers')
  }
  return typeof e.agentType === 'string'
    ? undefined
    : s('key.agentType', 'an agent memory key names its agent')
}

/** densable leftover `vr`/`Wi` @207235800. */
export function getDefaultPublishDiscipline(
  e: Record<string, unknown>,
): string {
  if (e.namespace === 'team' || e.namespace === 'task') return 'rewriteDefault'
  if (getKeyWriteDiscipline(e) !== 'plain' || getSymlinkPolicy(e) === 'refuse')
    return 'atomic'
  return e.namespace === 'memory' ? 'refuseDefault' : 'followDefault'
}

/** densable leftover `Fa`/`zi` @207236200. */
export function getDefaultCreateMode(
  e: Record<string, unknown>,
  discipline?: string,
): number | undefined {
  if (discipline === 'atomic') return 384
  return getDefaultPublishDiscipline(e) === 'atomic' ? 384 : 438
}

export type ResolvedWriteOpts = {
  discipline: string
  symlinks: 'follow' | 'refuse'
  mode: number | undefined
  exactMode: number | undefined
  createMode: number | undefined
  keepMode: boolean
  flush: boolean
  makeParent: boolean
  parentMode: number | undefined
}

/** densable leftover `dt` @207413175. */
export function resolveWriteOpts(
  key: Record<string, unknown>,
  opts?: {
    parent?: string
    publishDiscipline?: string
    precondition?: { type?: string }
    mode?: number
    exactMode?: number
    keepExistingMode?: boolean
    flush?: boolean
  },
): ResolvedWriteOpts {
  const n = opts?.publishDiscipline ?? getDefaultPublishDiscipline(key)
  return {
    discipline: n,
    symlinks: n === 'refuseDefault' ? 'refuse' : getSymlinkPolicy(key),
    mode:
      opts?.mode ??
      (opts?.precondition?.type === 'ifAbsent'
        ? getDefaultCreateMode(key, opts.publishDiscipline)
        : undefined),
    exactMode: opts?.exactMode,
    createMode: undefined,
    keepMode: opts?.keepExistingMode === true,
    flush: opts?.flush ?? (n === 'followAtomic' || n === 'refuseDefault'),
    makeParent: opts?.parent !== 'mustExist',
    parentMode: undefined,
  }
}

/** densable leftover `Ua` @207414200 — mkdir-parent disciplines. */
export function isMkdirParentDiscipline(e: string): boolean {
  return (
    e === 'atomic' ||
    e === 'followDefault' ||
    e === 'refuseDefault' ||
    e === 'rewriteDefault'
  )
}

/** densable leftover `Fe` @207423503 leftover-used. */
export async function validateMarketplaceCacheSymlinks(
  roots: { configHome: string },
  key: Record<string, unknown>,
  n: string,
): Promise<WriteValidateErr | undefined> {
  if (key.namespace !== 'marketplaceCache') return
  const t =
    'relPath' in key && Array.isArray(key.relPath) ? key.relPath : undefined
  if (t === undefined) return
  let a = join(
    roots.configHome,
    'plugins',
    'marketplaces',
    String(key.marketplace),
  )
  for (const l of t) {
    if (typeof l !== 'string') continue
    a = join(a, l)
    try {
      const d = await lstat(a)
      if (!d.isSymbolicLink()) continue
      if (n === 'always') return { code: 'Failed' }
    } catch {
      return
    }
  }
}

export function validateWriteRequest(
  roots: { configHome: string; bridgeSpawnRoot?: string },
  key: Record<string, unknown>,
  data: unknown,
  opts?: {
    parent?: string
    publishDiscipline?: string
    precondition?: { type?: string }
    exactMode?: number
    keepExistingMode?: boolean
    flush?: boolean
  },
): WriteValidateErr | undefined {
  return (
    validateStorageKey(key) ??
    validateBridgeSpawnRoot(roots, key) ??
    validateMarketplaceCacheReadOnly(key) ??
    validateWriteData(data) ??
    validatePreconditionOpt(opts?.precondition) ??
    validatePreconditionDiscipline(key, opts?.precondition) ??
    validatePublishDisciplineOpt(key, opts) ??
    validateParentOpt(opts) ??
    validateWriteMiscOpts(opts)
  )
}

/**
 * densable leftover `Nr`/`qe` @207238282 — stream namespaces skip Ot expectEcho.
 */
export function isStreamNamespaceKey(key: Record<string, unknown>): boolean {
  switch (key.namespace) {
    case 'transcript':
    case 'history':
    case 'log':
    case 'jobTimeline':
    case 'recording':
    case 'sessionLog':
      return true
    default:
      return false
  }
}

/** densable leftover `Oi` framing @207334334. */
export function getStreamFraming(
  key: Record<string, unknown>,
): 'text' | 'jsonl' | undefined {
  switch (key.namespace) {
    case 'log':
      return key.channel === 'debug' ? 'text' : undefined
    case 'sessionLog':
    case 'recording':
      return 'text'
    case 'jobTimeline':
    case 'transcript':
    case 'history':
      return 'jsonl'
    default:
      return
  }
}

/** densable leftover `Oi.subscribe` @207334334. */
export function getStreamSubscribeMode(
  key: Record<string, unknown>,
): 'refuse' | 'serve' | undefined {
  switch (key.namespace) {
    case 'log':
      return key.channel === 'debug' ? 'refuse' : undefined
    case 'sessionLog':
    case 'recording':
    case 'jobTimeline':
      return 'refuse'
    case 'transcript':
    case 'history':
      return 'serve'
    default:
      return
  }
}

/** densable leftover `Ve` @207334334. */
export function isFramedStreamKey(e: Record<string, unknown>): boolean {
  return (
    e.namespace === 'history' ||
    e.namespace === 'transcript' ||
    getStreamFraming(e) !== undefined
  )
}

/** densable leftover `xt` @207399795. */
export function validateAppendEntries(
  e: Record<string, unknown>,
  r: Array<{ data: unknown; recordId?: string }>,
): WriteValidateErr | undefined {
  for (const [n, t] of r.entries()) {
    const i = validateWriteData(t.data)
    if (i !== undefined) {
      return { code: 'InvalidArgument', argument: `entries[${n}].data` }
    }
    const len =
      typeof t.data === 'string' ? t.data.length : (t.data as Uint8Array).length
    if (isFramedStreamKey(e) && len === 0) {
      return w(`entries[${n}].data`, 'must not be empty on this namespace')
    }
    if (t.recordId !== undefined && t.recordId.length === 0) {
      return w(`entries[${n}].recordId`, 'must not be empty')
    }
  }
}

function indexOfNewlineInData(e: string | Uint8Array): number {
  return typeof e === 'string' ? e.indexOf('\n') : e.indexOf(10)
}

function dataEndsWithNewline(e: string | Uint8Array): boolean {
  return typeof e === 'string'
    ? e.endsWith('\n')
    : e.byteLength > 0 && e[e.byteLength - 1] === 10
}

/** densable leftover `Rt` @207352589. */
export function validateJsonlStreamEntries(
  e: Array<{ data: string | Uint8Array; recordId?: string }>,
): WriteValidateErr | undefined {
  for (const [r, n] of e.entries()) {
    if (n.recordId !== undefined) {
      return w(
        `entries[${r}].recordId`,
        'must be omitted on this stream, which keeps no recordId registry',
      )
    }
    const t = typeof n.data === 'string' ? n.data.length : n.data.byteLength
    if (indexOfNewlineInData(n.data) !== t - 1) {
      return w(
        `entries[${r}].data`,
        'must be exactly one newline-terminated line on this stream',
      )
    }
  }
}

/** densable leftover `vu` @207352284. */
export function validateLineAppendStreamEntries(
  e: Array<{ data: string | Uint8Array; recordId?: string }>,
): WriteValidateErr | undefined {
  for (const [r, n] of e.entries()) {
    if (n.recordId !== undefined) {
      return w(
        `entries[${r}].recordId`,
        'must be omitted on a line-append stream, which keeps no recordId registry',
      )
    }
    if (!dataEndsWithNewline(n.data)) {
      return w(
        `entries[${r}].data`,
        'must be a newline-terminated block of text lines on a line-append stream',
      )
    }
  }
}

/** densable leftover `rl` @207400119. */
export function validateAppendOpts(
  e: { singleName?: boolean; precondition?: unknown } | undefined,
): WriteValidateErr | undefined {
  if (e?.singleName !== undefined && typeof e.singleName !== 'boolean') {
    return w('opts.singleName', 'must be a boolean')
  }
  const r = e?.precondition
  if (r === undefined) return
  if (
    typeof r === 'object' &&
    r !== null &&
    'type' in r &&
    (r as { type?: string }).type === 'ifExists' &&
    Object.keys(r).every(n => n === 'type' || n === 'nonEmpty') &&
    (!('nonEmpty' in r) ||
      (r as { nonEmpty?: boolean }).nonEmpty === undefined ||
      (r as { nonEmpty?: boolean }).nonEmpty === true)
  ) {
    return
  }
  return w(
    'opts.precondition',
    'must be { type: ifExists } with an optional nonEmpty: true',
  )
}

/** densable leftover `Qa`/`Yu` @207257590. `Rt=10485760`. */
export const DEBUG_LOG_MAX_BYTES = 10485760

export function getDebugLogRotationConfig(
  roots: { configHome: string },
  n: Record<string, unknown>,
  logPath: string,
  r = DEBUG_LOG_MAX_BYTES,
): { maxBytes: number; rotatedPath: string } | undefined {
  if (n.namespace !== 'log' || n.channel !== 'debug') return
  return { maxBytes: r, rotatedPath: `${logPath.slice(0, -4)}.1.txt` }
}
