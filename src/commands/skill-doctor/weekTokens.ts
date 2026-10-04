/**
 * densable `DZr` / `ue` / `kn` / `vn` / `Dn` / `Nn` / `UP` / `oe` @194906452.
 *
 * Gold: `async function DZr(e){let n=Date.now()-oe,o=new Map;return await ue(n,(s)=>Nn(o,s),e),o}`
 * `oe=604800000`. `ue` prefers v5 `On(storageV5)` when `e` is passed, else
 * walks `Vu()` projects dir via `kn` (project jsonl + each dir's subagents jsonl).
 * `Nn` folds `cached+cacheCreate+uncached+output` onto `attributionSkill`.
 * `UP(e)` = prompt `unqualifiedName` else `name`.
 */

import { readdir, stat, open } from 'fs/promises'
import { extname, join } from 'path'
import { isENOENT } from '../../utils/errors.js'
import { getProjectsDir } from '../../utils/sessionPaths.js'
import type { StorageV5 } from '../../utils/storageV5/createLocalFsBackend.js'

/** densable `oe`. */
export const WEEK_TOKEN_WINDOW_MS = 604_800_000
/** densable `D`. */
const SCAN_BATCH = 4
/** densable `te` / `Ae`. */
const MAX_TRANSCRIPT_CHUNK = 4_194_304

const TYPE_ASSISTANT = Buffer.from('"type":"assistant"')
const USAGE = Buffer.from('"usage":{')
const TIMESTAMP = Buffer.from('"timestamp":"')
const ATTR_SKILL = Buffer.from('"attributionSkill":"')
const INPUT_TOKENS = Buffer.from('"input_tokens":')
const OUTPUT_TOKENS = Buffer.from('"output_tokens":')
const CACHE_CREATE = Buffer.from('"cache_creation_input_tokens":')
const CACHE_READ = Buffer.from('"cache_read_input_tokens":')

export type SkillWeekTokenRecord = {
  ts: number
  skill?: string
  cached: number
  cacheCreate: number
  uncached: number
  output: number
}

/** densable `UP`. */
export function skillWeekTokenKey(cmd: {
  type?: string
  name: string
  unqualifiedName?: string
}): string {
  return cmd.type === 'prompt' && cmd.unqualifiedName != null
    ? cmd.unqualifiedName
    : cmd.name
}

function indexOf(
  buf: Buffer,
  needle: Buffer,
  start: number,
  end: number,
): number {
  const r = buf.subarray(start, end).indexOf(needle)
  return r < 0 ? -1 : start + r
}

function readQuoted(
  buf: Buffer,
  needle: Buffer,
  start: number,
  end: number,
): string | undefined {
  const at = indexOf(buf, needle, start, end)
  if (at < 0) return
  const i = at + needle.length
  let c = i
  while (c < end && buf[c] !== 34) c++
  return buf.toString('utf8', i, c)
}

function readInt(
  buf: Buffer,
  needle: Buffer,
  start: number,
  end: number,
): number {
  const at = indexOf(buf, needle, start, end)
  if (at < 0) return 0
  let i = at + needle.length
  let n = 0
  while (i < end && buf[i]! >= 48 && buf[i]! <= 57) {
    n = n * 10 + (buf[i]! - 48)
    i++
  }
  return n
}

function hasNeedle(
  buf: Buffer,
  needle: Buffer,
  start: number,
  end: number,
): boolean {
  return indexOf(buf, needle, start, end) >= 0
}

function parseTimestampMs(raw: string | undefined): number {
  if (!raw) return 0
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : 0
}

/**
 * densable `Nn` — fold one assistant record onto the skill map.
 * Gold does not skip sidechain here.
 */
export function accumulateSkillWeekTokens(
  map: Map<string, number>,
  rec: SkillWeekTokenRecord,
): void {
  if (!rec.skill) return
  map.set(
    rec.skill,
    (map.get(rec.skill) ?? 0) +
      rec.cached +
      rec.cacheCreate +
      rec.uncached +
      rec.output,
  )
}

function recordFromChunk(
  buf: Buffer,
  start: number,
  end: number,
): SkillWeekTokenRecord | null {
  if (!hasNeedle(buf, TYPE_ASSISTANT, start, end)) return null
  if (!hasNeedle(buf, USAGE, start, end)) return null
  const skill = readQuoted(buf, ATTR_SKILL, start, end)
  if (!skill) return null
  const uncached = readInt(buf, INPUT_TOKENS, start, end)
  const output = readInt(buf, OUTPUT_TOKENS, start, end)
  const cacheCreate = readInt(buf, CACHE_CREATE, start, end)
  const cached = readInt(buf, CACHE_READ, start, end)
  if (uncached + output + cacheCreate + cached === 0) return null
  return {
    ts: parseTimestampMs(readQuoted(buf, TIMESTAMP, start, end)),
    skill,
    cached,
    cacheCreate,
    uncached,
    output,
  }
}

function recordsFromJsonl(buf: Buffer): SkillWeekTokenRecord[] {
  const out: SkillWeekTokenRecord[] = []
  let i = 0
  while (i < buf.length) {
    let j = buf.indexOf(10, i)
    if (j < 0) j = buf.length
    if (j > i) {
      const rec = recordFromChunk(buf, i, j)
      if (rec) out.push(rec)
    }
    i = j + 1
  }
  return out
}

/** densable `kn`. */
async function listTranscriptFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isENOENT(error)) return []
    throw error
  }
  const files: string[] = []
  const subdirs: string[] = []
  for (const entry of entries) {
    if (entry.isFile() && extname(entry.name) === '.jsonl') {
      files.push(join(dir, entry.name))
    } else if (entry.isDirectory()) {
      subdirs.push(entry.name)
    }
  }
  const nested = await Promise.all(
    subdirs.map(async name => {
      const sub = join(dir, name, 'subagents')
      try {
        return (await readdir(sub, { recursive: true }))
          .filter(item => extname(item) === '.jsonl')
          .map(item => join(sub, item))
      } catch (error) {
        if (isENOENT(error)) return []
        throw error
      }
    }),
  )
  for (const group of nested) files.push(...group)
  return files
}

async function scanJsonlFile(
  path: string,
  cutoff: number,
  onRecord: (rec: SkillWeekTokenRecord) => void,
): Promise<void> {
  let st
  try {
    st = await stat(path)
  } catch (error) {
    if (isENOENT(error)) return
    throw error
  }
  if (!st.isFile() || st.mtimeMs < cutoff) return
  const fh = await open(path, 'r')
  try {
    const size = st.size
    if (size <= MAX_TRANSCRIPT_CHUNK) {
      const buf = Buffer.alloc(size)
      await fh.read(buf, 0, size, 0)
      for (const rec of recordsFromJsonl(buf)) {
        if (rec.ts >= cutoff) onRecord(rec)
      }
      return
    }
    let offset = 0
    let carry = Buffer.alloc(0)
    while (offset < size) {
      const len = Math.min(MAX_TRANSCRIPT_CHUNK, size - offset)
      const chunk = Buffer.alloc(len)
      await fh.read(chunk, 0, len, offset)
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk
      const lastNl = buf.lastIndexOf(10)
      const complete = lastNl >= 0 ? buf.subarray(0, lastNl + 1) : buf
      for (const rec of recordsFromJsonl(complete)) {
        if (rec.ts >= cutoff) onRecord(rec)
      }
      carry =
        lastNl >= 0 ? Buffer.from(buf.subarray(lastNl + 1)) : Buffer.alloc(0)
      offset += len
    }
    if (carry.length > 0) {
      for (const rec of recordsFromJsonl(carry)) {
        if (rec.ts >= cutoff) onRecord(rec)
      }
    }
  } finally {
    await fh.close()
  }
}

function isStorageV5(e: unknown): e is StorageV5 {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as StorageV5).listEntries === 'function' &&
    typeof (e as StorageV5).read === 'function'
  )
}

async function listV5Pages(
  storage: StorageV5,
  scope: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = []
  let cursor: unknown
  for (;;) {
    const page = await storage.listEntries(scope, {
      skipScopeStats: true,
      ...(cursor !== undefined ? { cursor } : {}),
    })
    if (!page.ok) break
    for (const it of page.value.items) items.push(it as Record<string, unknown>)
    if (page.value.cursor === undefined) break
    cursor = page.value.cursor
  }
  return items
}

/** densable `On` subset — v5 transcript listing then read. */
async function scanStorageV5(
  storage: StorageV5,
  cutoff: number,
  onRecord: (rec: SkillWeekTokenRecord) => void,
): Promise<void> {
  const projects = await listV5Pages(storage, { namespace: 'transcript' })
  const files: Array<{ key: unknown; mtimeMs: number; size: number }> = []
  for (const p of projects) {
    const projectKey =
      (p.scope as { projectKey?: string } | undefined)?.projectKey ??
      (typeof (p as { key?: { projectKey?: string } }).key?.projectKey ===
      'string'
        ? (p as { key?: { projectKey?: string } }).key?.projectKey
        : undefined)
    if (typeof projectKey !== 'string') continue
    const sessions = await listV5Pages(storage, {
      namespace: 'transcript',
      projectKey,
    })
    for (const s of sessions) {
      if ((s as { kind?: string }).kind !== 'key') continue
      const key = (s as { key?: unknown }).key
      const mtimeMs = (s as { mtimeMs?: number }).mtimeMs
      const size = (s as { size?: number }).size
      if (key === undefined || mtimeMs === undefined || size === undefined) {
        continue
      }
      if (mtimeMs < cutoff) continue
      files.push({ key, mtimeMs, size })
    }
  }
  for (let i = 0; i < files.length; i += SCAN_BATCH) {
    const batch = files.slice(i, i + SCAN_BATCH)
    await Promise.all(
      batch.map(async f => {
        const whole = f.size <= MAX_TRANSCRIPT_CHUNK
        const req = whole
          ? f.key
          : { key: f.key, offset: 0, length: MAX_TRANSCRIPT_CHUNK }
        const read = await storage.read([req as never])
        if (!read.ok) return
        const item = read.value.items[0]
        if (!item?.found || !item.value) return
        const buf = Buffer.from(item.value)
        for (const rec of recordsFromJsonl(buf)) {
          if (rec.ts >= cutoff) onRecord(rec)
        }
      }),
    )
  }
}

/** densable `ue`. */
export async function walkSkillTranscripts(
  cutoff: number,
  onRecord: (rec: SkillWeekTokenRecord) => void,
  storage?: unknown,
): Promise<void> {
  if (storage && isStorageV5(storage)) {
    await scanStorageV5(storage, cutoff, onRecord)
    return
  }
  let projects: string[]
  try {
    projects = await readdir(getProjectsDir())
  } catch (error) {
    if (isENOENT(error)) return
    throw error
  }
  const files = (
    await Promise.all(
      projects.map(name => listTranscriptFiles(join(getProjectsDir(), name))),
    )
  ).flat()
  for (let i = 0; i < files.length; i += SCAN_BATCH) {
    const batch = files.slice(i, i + SCAN_BATCH)
    await Promise.all(batch.map(p => scanJsonlFile(p, cutoff, onRecord)))
  }
}

/** densable `DZr(e)`. */
export async function scanSkillWeekTokens(
  storage?: unknown,
): Promise<Map<string, number>> {
  const cutoff = Date.now() - WEEK_TOKEN_WINDOW_MS
  const map = new Map<string, number>()
  await walkSkillTranscripts(
    cutoff,
    rec => accumulateSkillWeekTokens(map, rec),
    storage,
  )
  return map
}
