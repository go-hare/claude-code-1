/**
 * densable 2.1.248 chunk-j2hdyj1b — fleet launcher composer draft (qd / AIt / BLn).
 */
import { createHash } from 'crypto'
import { realpathSync } from 'fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { z } from 'zod/v4'
import { getCwd } from '../../utils/cwd.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'
import { isHoverRestOn } from '../../utils/storageV5/hoverRestPin.js'
import type { StorageV5 } from '../../utils/storageV5/createLocalFsBackend.js'

/** densable `p` — draft TTL. */
export const FLEET_LAUNCHER_DRAFT_TTL_MS = 86_400_000

/** densable `u` — max draft bytes. */
export const FLEET_LAUNCHER_DRAFT_MAX_BYTES = 8_388_608

export type FleetLauncherDraftPayload = {
  q: string
  collapsed: string[]
  ts: number
}

export type FleetLauncherDraftBody = {
  q: string
  collapsed: string[]
}

const draftSchema = lazySchema(() =>
  z.object({
    q: z.string(),
    collapsed: z.array(z.string()).optional(),
    ts: z.number(),
  }),
)

/** densable `c(t)` — sha256 canonical launcher cwd → 8 hex draftKey. */
export function fleetLauncherDraftKey(canonicalLauncherCwd: string): string {
  return createHash('sha256')
    .update(canonicalLauncherCwd)
    .digest('hex')
    .slice(0, 8)
}

/** densable `Se.jobDraft(c(t))`. */
export function fleetLauncherDraftStorageKey(draftKey: string): {
  namespace: 'jobsRoot'
  draftKey: string
} {
  return { namespace: 'jobsRoot', draftKey }
}

/** densable editor `draftForDisk()` — bash → `!${q}`, else q. */
export function fleetComposerDraftForDisk(
  query: string,
  mode: 'prompt' | 'bash',
): string {
  return mode === 'bash' ? `!${query}` : query
}

export function parseFleetComposerDraftFromDisk(q: string): {
  query: string
  mode: 'prompt' | 'bash'
} {
  if (q.startsWith('!')) {
    return { mode: 'bash', query: q.slice(1) }
  }
  return { mode: 'prompt', query: q }
}

function jobsRootDir(): string {
  return join(getClaudeConfigHomeDir(), 'jobs')
}

/** densable `n(t)` — `.draft-${c(t)}` under jobs root. */
export function fleetLauncherDraftPath(canonicalLauncherCwd: string): string {
  return join(
    jobsRootDir(),
    `.draft-${fleetLauncherDraftKey(canonicalLauncherCwd)}`,
  )
}

/** densable `jl(te(), …)` leftover — realpath when possible. */
export function resolveFleetCanonicalLauncherCwd(
  cwd: string = getCwd(),
): string {
  try {
    return resolve(realpathSync(cwd))
  } catch {
    return resolve(cwd)
  }
}

function stampDraft(body: FleetLauncherDraftBody): FleetLauncherDraftPayload {
  return { ...body, ts: Date.now() }
}

function parseDraftRaw(raw: string): FleetLauncherDraftBody | undefined {
  let parsed: unknown
  try {
    parsed = jsonParse(raw)
  } catch {
    return
  }
  let result: z.infer<ReturnType<typeof draftSchema>>
  try {
    result = draftSchema().parse(parsed)
  } catch {
    return
  }
  if (Date.now() - result.ts > FLEET_LAUNCHER_DRAFT_TTL_MS) {
    return
  }
  return { q: result.q, collapsed: result.collapsed ?? [] }
}

async function readDraftFile(path: string): Promise<string | null> {
  try {
    const info = await stat(path)
    if (info.size > FLEET_LAUNCHER_DRAFT_MAX_BYTES) return null
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** densable `BLn` — load draft for canonical launcher cwd. */
export async function loadFleetLauncherDraft(
  canonicalLauncherCwd: string,
  storageV5?: StorageV5 | null,
): Promise<FleetLauncherDraftBody | undefined> {
  const draftKey = fleetLauncherDraftKey(canonicalLauncherCwd)
  if (isHoverRestOn() && storageV5) {
    const result = await storageV5.readText([
      fleetLauncherDraftStorageKey(draftKey),
    ])
    if (!result.ok) return
    const item = result.value.items[0]
    if (!item?.found) return
    const raw =
      typeof item.value === 'string'
        ? item.value
        : item.value != null
          ? Buffer.from(item.value).toString('utf8')
          : undefined
    if (raw === undefined) return
    return parseDraftRaw(raw)
  }
  const raw = await readDraftFile(fleetLauncherDraftPath(canonicalLauncherCwd))
  if (raw === null) return
  return parseDraftRaw(raw)
}

/** densable `AIt` — async persist (storageV5 or mkdir + write). */
export async function persistFleetLauncherDraftAsync(
  canonicalLauncherCwd: string,
  body: FleetLauncherDraftBody,
  storageV5?: StorageV5 | null,
): Promise<boolean> {
  const payload = stampDraft(body)
  const serialized = jsonStringify(payload)
  const draftKey = fleetLauncherDraftKey(canonicalLauncherCwd)
  if (isHoverRestOn() && storageV5) {
    const result = await storageV5
      .write(fleetLauncherDraftStorageKey(draftKey), serialized, {
        publishDiscipline: 'atomic',
        mode: 0o666 & ~process.umask(),
      })
      .catch(() => undefined)
    return result?.ok === true
  }
  try {
    await mkdir(jobsRootDir(), { recursive: true })
    await writeFile(fleetLauncherDraftPath(canonicalLauncherCwd), serialized, {
      mode: 0o666 & ~process.umask(),
    })
    return true
  } catch {
    return false
  }
}

/** densable `X2e` / `qJt` — sync-ish persist (debounced live path). */
export async function persistFleetLauncherDraft(
  canonicalLauncherCwd: string,
  body: FleetLauncherDraftBody,
  storageV5?: StorageV5 | null,
): Promise<void> {
  await persistFleetLauncherDraftAsync(canonicalLauncherCwd, body, storageV5)
}

/** densable `KJt` — delete draft file / storage key. */
export async function clearFleetLauncherDraft(
  canonicalLauncherCwd: string,
  storageV5?: StorageV5 | null,
): Promise<void> {
  const draftKey = fleetLauncherDraftKey(canonicalLauncherCwd)
  if (isHoverRestOn() && storageV5) {
    await storageV5
      .delete(fleetLauncherDraftStorageKey(draftKey))
      .catch(() => {})
    return
  }
  await rm(fleetLauncherDraftPath(canonicalLauncherCwd), {
    recursive: true,
    force: true,
  }).catch(() => {})
}

/** densable `Zrt` — sweep expired `.draft-*` under jobs root. */
export async function sweepExpiredFleetLauncherDrafts(): Promise<void> {
  let names: string[]
  try {
    names = await readdir(jobsRootDir())
  } catch {
    return
  }
  const now = Date.now()
  await Promise.all(
    names
      .filter(name => name.startsWith('.draft-'))
      .map(async name => {
        const path = join(jobsRootDir(), name)
        const raw = await readDraftFile(path)
        if (raw !== null) {
          try {
            const parsed = draftSchema().parse(jsonParse(raw))
            if (now - parsed.ts <= FLEET_LAUNCHER_DRAFT_TTL_MS) return
          } catch {
            // fall through to delete
          }
        }
        await rm(path, { recursive: true, force: true }).catch(() => {})
      }),
  )
}
