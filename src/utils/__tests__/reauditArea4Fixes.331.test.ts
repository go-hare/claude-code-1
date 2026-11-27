import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID, type UUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setOriginalCwd, switchSession } from '../../bootstrap/state.js'
import { createEmbeddedHost } from '../../entrypoints/sdk/embeddedHost.js'
import { asAgentId, asSessionId } from '../../types/ids.js'
import { runCleanupFunctions } from '../cleanupRegistry.js'
import {
  type DisklessWriteSkippedEvent,
  subscribeDisklessWriteSkipped,
} from '../disklessGuards.js'
import { incrementPluginUsage } from '../plugins/pluginUsagePending.js'
import {
  getBootstrapSession,
  hasActiveSessionAls,
  runWithNewHostSession,
  runWithSession,
} from '../sessionHost.js'
import {
  deleteRemoteAgentMetadata,
  getProjectDir,
  getTranscriptPathForSession,
  writeAgentMetadata,
  writeMainSessionObserverPointer,
  writeRemoteAgentMetadata,
} from '../sessionPaths.js'
import {
  appendEntryToFile,
  renamePathWithCrossDeviceFallback,
} from '../sessionStorage/fsHelpers.js'
import {
  getProject,
  setInternalEventReader,
} from '../sessionStorage/project.js'
import { loadSameRepoMessageLogs } from '../sessionStorage/sessionIndex.js'
import { readCustomTitleSidecar } from '../sessionStorage/sidecars.js'
import { compactTranscriptFileAtomic } from '../sessionStorage/transcriptGc.js'
import {
  clearBridgeSession,
  hydrateFromCCRv2InternalEvents,
  hydrateRemoteSession,
  linkSessionToPR,
  markSessionEndedByModel,
  relocateSessionTranscript,
  saveAgentColor,
  saveAgentName,
  saveAiGeneratedTitle,
  saveBridgeSession,
  saveCustomTitle,
  saveTag,
  saveTaskSummary,
  saveWorktreeState,
  writeHistorySuppression,
} from '../sessionStorage/transcriptWriter.js'
import {
  ensureProjectWatchedForCurrentHost,
  getWatchedProjectCwdRefCountForTests,
  settingsChangeDetector,
} from '../settings/changeDetector.js'
import {
  drainSettingsWrites,
  persistSettingsForSource,
  runInSettingsWriteQueue,
} from '../settings/settings.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import {
  createHoverRestBackend,
  hoverRestUpdateLeaseTarget,
} from '../storageV5/createHoverRestBackend.js'
import {
  createLocalFsBackend,
  type StorageV5,
  type StorageV5LeaseHandle,
} from '../storageV5/createLocalFsBackend.js'
import { createMemoryStorageV5Backend } from '../storageV5/createMemoryBackend.js'

const tempDirs: string[] = []
const openServers: HttpServer[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function forceGc(): void {
  const bunRuntime = (globalThis as { Bun?: { gc?: (sync?: boolean) => void } })
    .Bun
  if (typeof bunRuntime?.gc === 'function') {
    bunRuntime.gc(true)
    return
  }
  const nodeGc = (globalThis as { gc?: () => void }).gc
  if (typeof nodeGc === 'function') {
    nodeGc()
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, ms))
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 3_000,
  stepMs = 20,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await delay(stepMs)
  }
  return predicate()
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text) as Record<string, unknown>)
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function writeJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function mapErrorStatus(code: string): number {
  switch (code) {
    case 'NotFound':
      return 404
    case 'PreconditionFailed':
      return 412
    case 'InvalidArgument':
      return 400
    case 'AlreadyHeld':
    case 'Held':
    case 'Busy':
      return 409
    case 'Unsupported':
      return 501
    default:
      return 500
  }
}

async function startLocalFsHoverServer(backing: StorageV5): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> {
  const leases = new Map<string, StorageV5LeaseHandle>()
  let nextLeaseId = 1

  const server = createHttpServer((req, res) => {
    void (async () => {
      const body = await readJsonBody(req)
      const path = req.url ?? '/'

      if (path === '/v5/keys/read') {
        const result = await backing.read(
          body.reqs as Parameters<typeof backing.read>[0],
          body.opts as Parameters<typeof backing.read>[1],
        )
        if (!result.ok) {
          writeJson(res, mapErrorStatus(result.error.code), result)
          return
        }
        writeJson(res, 200, {
          items: result.value.items.map(item =>
            item.found && item.value !== undefined
              ? {
                  found: true,
                  totalBytes: item.totalBytes,
                  valueBase64: Buffer.from(item.value).toString('base64'),
                  version: item.version,
                  mtimeMs: item.mtimeMs,
                }
              : { found: false, totalBytes: 0 },
          ),
        })
        return
      }

      if (path === '/v5/keys/write') {
        const val =
          body.encoding === 'base64' && typeof body.value === 'string'
            ? new Uint8Array(Buffer.from(body.value, 'base64'))
            : String(body.value ?? '')
        const result = await backing.write(
          body.key,
          val,
          body.opts as Parameters<typeof backing.write>[2],
        )
        if (!result.ok) {
          writeJson(res, mapErrorStatus(result.error.code), result)
          return
        }
        writeJson(res, 200, result.value)
        return
      }

      if (path === '/v5/leases/acquire') {
        const result = await backing.acquireLease(
          body.target,
          Number(body.ttlMs),
          body.opts as Parameters<typeof backing.acquireLease>[2],
        )
        if (!result.ok) {
          writeJson(res, mapErrorStatus(result.error.code), result)
          return
        }
        const leaseId = `lease-${nextLeaseId++}`
        leases.set(leaseId, result.value)
        writeJson(res, 200, {
          leaseId,
          holder: result.value.holder,
          expiresAtMs: result.value.expiresAtMs,
        })
        return
      }

      if (path === '/v5/leases/release') {
        const leaseId = String(body.leaseId ?? '')
        const handle = leases.get(leaseId)
        if (!handle) {
          writeJson(res, 404, { error: { code: 'NotFound' } })
          return
        }
        const rel = await handle.release()
        leases.delete(leaseId)
        if (!rel.ok) {
          writeJson(res, mapErrorStatus(rel.error.code), rel)
          return
        }
        writeJson(res, 200, { released: true })
        return
      }

      writeJson(res, 404, { error: { code: 'NotFound' } })
    })()
  })

  openServers.push(server)
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const addr = server.address()
  if (!addr || typeof addr === 'string') {
    throw new Error('Expected TCP address')
  }
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

afterEach(async () => {
  await settingsChangeDetector.resetForTesting().catch(() => {})
  while (openServers.length > 0) {
    const srv = openServers.pop()
    if (srv) {
      await new Promise<void>(resolve => srv.close(() => resolve()))
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('Re-Audit Area 4 Fixes (StorageV5, SessionStorage Diskless, Settings & Multi-Host ALS)', () => {
  // ── Findings 1 (P0-8 + P0-9 + P1-D1) ─────────────────────────────────────
  test('P0-8 + P0-9 + P1-D1: createHoverRestBackend().update() checks closed, rejects caller precondition, uses canonical named lease & decoupled TTL, and computes discipline-aware preconditions', async () => {
    let fetchCount = 0
    const recorded: Array<{ pathname: string; body: Record<string, unknown> }> =
      []
    let nextReadItem: Record<string, unknown> = {
      found: false,
      totalBytes: 0,
    }

    const hover = createHoverRestBackend({
      baseUrl: 'http://127.0.0.1:8080',
      defaultTimeoutMs: 20_000,
      fetchImpl: async (url, init) => {
        fetchCount++
        const pathname = new URL(String(url)).pathname
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<
          string,
          unknown
        >
        recorded.push({ pathname, body })
        if (pathname === '/v5/leases/acquire') {
          return new Response(
            JSON.stringify({
              leaseId: `l-${fetchCount}`,
              holder: String(
                (body.opts as { holder?: string } | undefined)?.holder ?? 'h',
              ),
              expiresAtMs: Date.now() + 60_000,
            }),
            { status: 200 },
          )
        }
        if (pathname === '/v5/leases/release') {
          return new Response(JSON.stringify({ released: true }), {
            status: 200,
          })
        }
        if (pathname === '/v5/keys/read') {
          return new Response(JSON.stringify({ items: [nextReadItem] }), {
            status: 200,
          })
        }
        return new Response(JSON.stringify({ version: 'v-next' }), {
          status: 200,
        })
      },
    })

    const plainKey = { namespace: 'plan', name: 'p1' }
    const versionedKey = { namespace: 'globalConfig' }

    // (b) Caller-supplied precondition rejected upfront with zero HTTP traffic
    const preRes = await hover.update(plainKey, () => ({ write: 'x' }), {
      precondition: { type: 'none' },
    })
    expect(preRes).toEqual({
      ok: false,
      error: { code: 'InvalidArgument', argument: 'opts.precondition' },
    })
    expect(fetchCount).toBe(0)

    // (c) Canonical lease target is property-order invariant
    expect(
      hoverRestUpdateLeaseTarget({ namespace: 'state', id: 'abc' }),
    ).toEqual(hoverRestUpdateLeaseTarget({ id: 'abc', namespace: 'state' }))
    expect(hoverRestUpdateLeaseTarget(plainKey).lease).toMatch(
      /^update-[0-9a-f]{64}$/,
    )

    // (d) Lease TTL is decoupled from acquireTimeoutMs: max(30_000, ceil(defaultTimeoutMs * 2))
    nextReadItem = { found: false, totalBytes: 0 }
    const r1 = await hover.update(plainKey, () => ({ write: 'a' }), {
      acquireTimeoutMs: 50,
    })
    expect(r1.ok).toBe(true)
    const leaseAcquire1 = recorded.find(
      c => c.pathname === '/v5/leases/acquire',
    )
    expect(leaseAcquire1?.body.target).toEqual(
      hoverRestUpdateLeaseTarget(plainKey),
    )
    expect(leaseAcquire1?.body.ttlMs).toBe(40_000)

    // Check minimum 30_000 TTL floor when defaultTimeoutMs is small
    const smallTimeoutRecorded: Array<Record<string, unknown>> = []
    const smallTimeoutHover = createHoverRestBackend({
      baseUrl: 'http://127.0.0.1:8080',
      defaultTimeoutMs: 5_000,
      fetchImpl: async (url, init) => {
        const pathname = new URL(String(url)).pathname
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<
          string,
          unknown
        >
        if (pathname === '/v5/leases/acquire') {
          smallTimeoutRecorded.push(body)
          return new Response(
            JSON.stringify({
              leaseId: 'l-small',
              holder: 'h',
              expiresAtMs: Date.now() + 30_000,
            }),
            { status: 200 },
          )
        }
        if (pathname === '/v5/leases/release') {
          return new Response(JSON.stringify({ released: true }), {
            status: 200,
          })
        }
        if (pathname === '/v5/keys/read') {
          return new Response(
            JSON.stringify({ items: [{ found: false, totalBytes: 0 }] }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ version: 'v1' }), { status: 200 })
      },
    })
    expect(
      (
        await smallTimeoutHover.update(plainKey, () => ({ write: 'x' }), {
          acquireTimeoutMs: 10,
        })
      ).ok,
    ).toBe(true)
    expect(smallTimeoutRecorded[0]?.ttlMs).toBe(30_000)

    // (e) Write precondition matrix:
    // 1) plain + absent -> { type: 'ifAbsent' }
    const write1 = recorded.find(c => c.pathname === '/v5/keys/write')
    expect(
      (write1?.body.opts as { precondition?: unknown })?.precondition,
    ).toEqual({ type: 'ifAbsent' })

    // 2) plain + found WITH version -> omitted (NEVER ifMatch, NEVER exists)
    recorded.length = 0
    nextReadItem = {
      found: true,
      value: 'old',
      encoding: 'utf8',
      version: 'v-plain-1',
    }
    expect((await hover.update(plainKey, () => ({ write: 'b' }))).ok).toBe(true)
    const writePlainFound = recorded.find(c => c.pathname === '/v5/keys/write')
    expect(
      (writePlainFound?.body.opts as { precondition?: unknown })?.precondition,
    ).toBeUndefined()

    // 3) versioned + absent -> { type: 'ifAbsent' }
    recorded.length = 0
    nextReadItem = { found: false, totalBytes: 0 }
    expect((await hover.update(versionedKey, () => ({ write: '{}' }))).ok).toBe(
      true,
    )
    const writeVerAbsent = recorded.find(c => c.pathname === '/v5/keys/write')
    expect(
      (writeVerAbsent?.body.opts as { precondition?: unknown })?.precondition,
    ).toEqual({ type: 'ifAbsent' })

    // 4) versioned + found WITH version -> { type: 'ifMatch', version }
    recorded.length = 0
    nextReadItem = {
      found: true,
      value: '{}',
      encoding: 'utf8',
      version: 'v-ver-1',
    }
    expect(
      (await hover.update(versionedKey, () => ({ write: '{"a":1}' }))).ok,
    ).toBe(true)
    const writeVerMatch = recorded.find(c => c.pathname === '/v5/keys/write')
    expect(
      (writeVerMatch?.body.opts as { precondition?: unknown })?.precondition,
    ).toEqual({ type: 'ifMatch', version: 'v-ver-1' })

    // 5) versioned + found WITHOUT version -> { type: 'none' }
    recorded.length = 0
    nextReadItem = { found: true, value: '{}', encoding: 'utf8' }
    expect(
      (await hover.update(versionedKey, () => ({ write: '{"a":2}' }))).ok,
    ).toBe(true)
    const writeVerNoVersion = recorded.find(
      c => c.pathname === '/v5/keys/write',
    )
    expect(
      (writeVerNoVersion?.body.opts as { precondition?: unknown })
        ?.precondition,
    ).toEqual({ type: 'none' })

    // 6) publishDiscipline === 'inPlace' or 'followAtomic' -> omit precondition
    for (const publishDiscipline of ['inPlace', 'followAtomic'] as const) {
      recorded.length = 0
      nextReadItem = { found: false, totalBytes: 0 }
      expect(
        (
          await hover.update(plainKey, () => ({ write: 'raw' }), {
            publishDiscipline,
          })
        ).ok,
      ).toBe(true)
      const writeDisc = recorded.find(c => c.pathname === '/v5/keys/write')
      expect(
        (writeDisc?.body.opts as { precondition?: unknown })?.precondition,
      ).toBeUndefined()
    }

    // (a) close() causes update() to immediately fail with Closed without hitting network or edit()
    await hover.close()
    const beforeCloseFetches = fetchCount
    let editCalled = false
    const closedRes = await hover.update(plainKey, () => {
      editCalled = true
      return { write: 'nope' }
    })
    expect(closedRes).toEqual({ ok: false, error: { code: 'Closed' } })
    expect(editCalled).toBe(false)
    expect(fetchCount).toBe(beforeCloseFetches)
  })

  test('P0-8 + P0-9 end-to-end: Hover REST update() works against real LocalFsBackend lease validator & writeValidate without self-deadlocking caller-owned key lease', async () => {
    const dir = makeTempDir('reaudit-hover-localfs-')
    const localFs = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
    })
    const srv = await startLocalFsHoverServer(localFs)
    const hover = createHoverRestBackend({ baseUrl: srv.baseUrl })

    try {
      const plainKey = { namespace: 'state', id: 'counter' }
      const versionedKey = { namespace: 'globalConfig' }

      // Caller holds a real key lease on plainKey -> update() uses named update-* lease so NO self-deadlock!
      const callerLease = await hover.acquireLease(plainKey, 30_000, {
        holder: 'caller-task',
      })
      expect(callerLease.ok).toBe(true)

      const p1 = await hover.updateText(plainKey, () => ({ write: '1' }))
      expect(p1.ok).toBe(true)
      const p2 = await hover.updateText(plainKey, cur => ({
        write: String(Number(cur?.value ?? '0') + 1),
      }))
      expect(p2.ok).toBe(true)

      // Named update lease must NOT appear under key-scoped listLeases() for state scope
      // even while actively held!
      if (callerLease.ok) {
        await callerLease.value.release()
      }
      const activeUpdateLease = await localFs.acquireLease(
        hoverRestUpdateLeaseTarget(plainKey),
        30_000,
        { holder: 'check-exclusion' },
      )
      expect(activeUpdateLease.ok).toBe(true)
      try {
        const listed = await localFs.listLeases({ namespace: 'state' })
        expect(listed.ok).toBe(true)
        if (listed.ok) {
          expect(listed.value.items).toHaveLength(0)
        }
      } finally {
        if (activeUpdateLease.ok) {
          await activeUpdateLease.value.release()
        }
      }

      // Versioned key (globalConfig) succeeds for create + subsequent CAS update
      const v1 = await hover.updateText(versionedKey, () => ({
        write: JSON.stringify({ n: 1 }),
      }))
      expect(v1.ok).toBe(true)
      const v2 = await hover.updateText(versionedKey, cur => {
        const prev = JSON.parse(cur?.value ?? '{"n":0}') as { n: number }
        return { write: JSON.stringify({ n: prev.n + 1 }) }
      })
      expect(v2.ok).toBe(true)
      const readBack = await hover.readText([versionedKey])
      expect(readBack.ok).toBe(true)
      if (readBack.ok) {
        expect(JSON.parse(readBack.value.items[0]?.value ?? '{}')).toEqual({
          n: 2,
        })
      }
    } finally {
      await hover.close()
      await srv.close()
      await localFs.close()
    }
  })

  // ── Finding 2 (P1-D2) ────────────────────────────────────────────────────
  test('P1-D2: createLocalFsBackend().update()/updateText() succeeds on all 5 versioned key namespaces and serializes concurrent updates under publish lock', async () => {
    const dir = makeTempDir('reaudit-localfs-upd-')
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: join(dir, '.claude.json'),
      lockUnconditionalPublishes: true,
    })

    try {
      const versionedKeys = [
        { namespace: 'globalConfig' },
        { namespace: 'task', listId: 'list-1', taskId: 'task-1' },
        { namespace: 'team', team: 'alpha' },
        { namespace: 'mailbox', team: 'alpha', teammate: 'alice' },
        { namespace: 'identity' },
      ]

      for (const key of versionedKeys) {
        const created = await backend.updateText(key, cur => {
          expect(cur).toBeUndefined()
          return { write: JSON.stringify({ count: 1 }) }
        })
        expect(created.ok).toBe(true)
        if (created.ok) {
          expect(created.value.written).toBe(true)
          expect(created.value.found).toBe(false)
          expect(typeof created.value.version).toBe('string')
        }

        const updated = await backend.updateText(key, cur => {
          expect(cur).toBeDefined()
          expect(typeof cur?.version).toBe('string')
          const parsed = JSON.parse(cur?.value ?? '{}') as { count: number }
          return { write: JSON.stringify({ count: parsed.count + 1 }) }
        })
        expect(updated.ok).toBe(true)
        if (updated.ok) {
          expect(updated.value.written).toBe(true)
          expect(updated.value.found).toBe(true)
        }

        const read = await backend.readText([key])
        expect(read.ok).toBe(true)
        if (read.ok) {
          expect(JSON.parse(read.value.items[0]?.value ?? '{}')).toEqual({
            count: 2,
          })
        }
      }

      // Concurrent read-modify-write on versioned key (task) and plain key (state)
      // even with lockUnconditionalPublishes: true (no re-entrant lock deadlock & zero lost updates!)
      const taskKey = { namespace: 'task', listId: 'conc', taskId: 'counter' }
      const stateKey = { namespace: 'state', id: 'conc-counter' }
      const N = 10

      const taskResults = await Promise.all(
        Array.from({ length: N }, () =>
          backend.updateText(taskKey, cur => {
            const prev = cur ? Number(cur.value) : 0
            return { write: String(prev + 1) }
          }),
        ),
      )
      expect(taskResults.every(r => r.ok)).toBe(true)
      const taskFinal = await backend.readText([taskKey])
      expect(taskFinal.ok).toBe(true)
      if (taskFinal.ok) {
        expect(taskFinal.value.items[0]?.value).toBe(String(N))
      }

      const stateResults = await Promise.all(
        Array.from({ length: N }, () =>
          backend.updateText(stateKey, cur => {
            const prev = cur ? Number(cur.value) : 0
            return { write: String(prev + 1) }
          }),
        ),
      )
      expect(stateResults.every(r => r.ok)).toBe(true)
      const stateFinal = await backend.readText([stateKey])
      expect(stateFinal.ok).toBe(true)
      if (stateFinal.ok) {
        expect(stateFinal.value.items[0]?.value).toBe(String(N))
      }
    } finally {
      await backend.close()
    }
  })

  // ── Finding 3 (P2-11) ────────────────────────────────────────────────────
  test('P2-11: createMemoryStorageV5Backend() deduplicates subagent transcript keys across overlapping scope dirs in listRecursive, scopeKeys, and deleteScope', async () => {
    let nowMs = 1_000_000
    const mem = createMemoryStorageV5Backend({ clock: () => nowMs })
    const sessionId = randomUUID()
    const scope = {
      namespace: 'transcript',
      projectKey: 'proj-dedup',
      sessionId,
    }
    const sub1 = { ...scope, agentId: 'agent1' }
    const sub2 = { ...scope, agentId: 'agent2' }

    expect(
      (await mem.append(sub1, [{ data: '{"type":"user","msg":1}\n' }])).ok,
    ).toBe(true)
    expect(
      (await mem.append(sub2, [{ data: '{"type":"user","msg":2}\n' }])).ok,
    ).toBe(true)

    const listed = await mem.listRecursive(scope)
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      expect(listed.value.items).toHaveLength(2)
    }

    const keys = await mem.scopeKeys(scope)
    expect(keys.ok).toBe(true)
    if (keys.ok) {
      expect(keys.value).toHaveLength(2)
    }

    // Both subagent files are fresh (mtimeMs = 1_000_000 >= cutoff = 1_000_000 - 60_000)
    // deleteScope must report skipped === 2, NOT double-counted as 4!
    nowMs = 1_001_000
    const delRes = await mem.deleteScope(scope, { olderThanMs: 60_000 })
    expect(delRes.ok).toBe(true)
    if (delRes.ok) {
      expect(delRes.value.deleted).toBe(0)
      expect(delRes.value.skipped).toBe(2)
    }
  })

  // ── Finding 4 (P1-D3) ────────────────────────────────────────────────────
  test('P1-D3: diskless guards prevent real-disk writes/scans across sessionStorage split & sessionPaths while preserving StorageV5 custom-title sidecars', async () => {
    const sentinelConfigDir = makeTempDir('reaudit-diskless-cfg-')
    const sentinelWorktree1 = makeTempDir('reaudit-diskless-wt1-')
    const sentinelWorktree2 = makeTempDir('reaudit-diskless-wt2-')
    const existingCompactFile = join(
      makeTempDir('reaudit-diskless-gc-'),
      'existing.jsonl',
    )
    const originalCompactContent =
      '{"type":"progress","uuid":"p1"}\n{"type":"user","uuid":"u1"}\n'
    writeFileSync(existingCompactFile, originalCompactContent, 'utf8')

    // Populate a non-diskless worktree log directory to prove getStatOnlyLogsForWorktrees
    // returns [] under diskless mode without reading/returning disk logs.
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    const prevEnablePersist = process.env.TEST_ENABLE_SESSION_PERSISTENCE
    process.env.CLAUDE_CONFIG_DIR = sentinelConfigDir
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
    try {
      const populatedDir1 = getProjectDir(sentinelWorktree1)
      const populatedDir2 = getProjectDir(sentinelWorktree2)
      mkdirSync(populatedDir1, { recursive: true })
      mkdirSync(populatedDir2, { recursive: true })
      const populatedSid = randomUUID()
      writeFileSync(
        join(populatedDir1, `${populatedSid}.jsonl`),
        `${JSON.stringify({ type: 'user', uuid: randomUUID(), sessionId: populatedSid, message: { role: 'user', content: 'hi' }, timestamp: new Date().toISOString() })}\n`,
        'utf8',
      )

      const freshDisklessConfigDir = makeTempDir('reaudit-diskless-clean-')
      const skippedEvents: DisklessWriteSkippedEvent[] = []
      const unsubSkipped = subscribeDisklessWriteSkipped(ev => {
        skippedEvents.push(ev)
      })

      const memStorage = createMemoryStorageV5Backend({
        configHome: freshDisklessConfigDir,
        globalConfigFile: join(freshDisklessConfigDir, '.claude.json'),
      })

      const host = createEmbeddedHost({
        tenantId: 'diskless-d3-tenant',
        diskless: true,
        storageV5: memStorage,
      })

      try {
        // First verify getStatOnlyLogsForWorktrees (via loadSameRepoMessageLogs) returns [] when diskless
        const disklessLogs = await host.run(() =>
          loadSameRepoMessageLogs([sentinelWorktree1, sentinelWorktree2]),
        )
        expect(disklessLogs).toEqual([])

        // Now point CLAUDE_CONFIG_DIR at an empty sentinel dir and assert ZERO FS mutations
        process.env.CLAUDE_CONFIG_DIR = freshDisklessConfigDir

        await host.run(async () => {
          const sid = randomUUID() as UUID
          switchSession(asSessionId(sid), null)
          const targetTranscript = join(
            freshDisklessConfigDir,
            'projects',
            'proj-d3',
            `${sid}.jsonl`,
          )

          // fsHelpers: appendEntryToFile & renamePathWithCrossDeviceFallback
          appendEntryToFile(targetTranscript, { type: 'user', sessionId: sid })
          await renamePathWithCrossDeviceFallback(
            existingCompactFile,
            join(freshDisklessConfigDir, 'moved.jsonl'),
          )
          expect(existsSync(existingCompactFile)).toBe(true)

          // transcriptGc: compactTranscriptFileAtomic
          const compactRes = await compactTranscriptFileAtomic(
            existingCompactFile,
            line => !line.includes('"progress"'),
          )
          expect(compactRes.compacted).toBe(false)
          expect(readFileSync(existingCompactFile, 'utf8')).toBe(
            originalCompactContent,
          )

          // transcriptWriter: relocateSessionTranscript
          const project = getProject()
          project.setSessionFile(targetTranscript)
          setOriginalCwd(sentinelWorktree2)
          await relocateSessionTranscript()

          // transcriptWriter: hydrateRemoteSession (via unreachable/mocked logs — mkdir must not run)
          await hydrateRemoteSession(sid, 'http://127.0.0.1:1/unused')

          // transcriptWriter: hydrateFromCCRv2InternalEvents (foreground + subagent mkdirs must not run)
          setInternalEventReader(
            async () => ({
              events: [
                {
                  event_id: 'ev-1',
                  payload: { type: 'user', uuid: randomUUID(), sessionId: sid },
                },
              ],
            }),
            async () => ({
              events: [
                {
                  session_agent_id: 'sub-1',
                  payload: { type: 'user', uuid: randomUUID(), sessionId: sid },
                },
              ],
            }),
          )
          await hydrateFromCCRv2InternalEvents(sid)

          // All 12 metadata writers in transcriptWriter.ts
          await saveCustomTitle(
            sid,
            'My Diskless Title',
            targetTranscript,
            'user',
            memStorage,
          )
          // StorageV5 custom-title sidecar MUST still have been written!
          const sidecarTitle = await readCustomTitleSidecar(
            getTranscriptPathForSession(sid),
            sid,
            memStorage,
          )
          expect(sidecarTitle).toBe('My Diskless Title')

          saveAiGeneratedTitle(sid, 'AI Diskless Title')
          saveTaskSummary(sid, 'Working on D3')
          await markSessionEndedByModel(sid)
          await saveTag(sid, 'diskless-tag', targetTranscript)
          await linkSessionToPR(
            sid,
            42,
            'https://example.com/pr/42',
            'org/repo',
            targetTranscript,
          )
          saveBridgeSession(sid, 'bridge-1', 1, targetTranscript)
          writeHistorySuppression(sid, targetTranscript)
          clearBridgeSession(sid, targetTranscript, { targetExists: true })
          await saveAgentName(sid, 'agent-d3', targetTranscript)
          await saveAgentColor(sid, 'blue', targetTranscript)
          saveWorktreeState({
            originalCwd: sentinelWorktree1,
            worktreePath: sentinelWorktree2,
            worktreeName: 'wt2',
            sessionId: sid,
          })

          // sessionPaths: all 4 metadata mutators
          await writeAgentMetadata(asAgentId('a-d3'), {
            agentType: 'Explore',
          })
          await writeMainSessionObserverPointer(
            { observerTaskId: 'obs-1' },
            sid,
          )
          await writeRemoteAgentMetadata('rt-1', {
            taskId: 'rt-1',
            remoteTaskType: 'review',
            sessionId: sid,
            title: 'Review',
            command: 'review',
            spawnedAt: Date.now(),
          })
          await deleteRemoteAgentMetadata('rt-1')
        })

        // Real sentinel config dir must remain COMPLETELY EMPTY — zero files or directories created!
        expect(readdirSync(freshDisklessConfigDir)).toEqual([])
        expect(skippedEvents.length).toBeGreaterThanOrEqual(15)
      } finally {
        unsubSkipped()
        await host.dispose()
      }
    } finally {
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
      if (prevEnablePersist === undefined) {
        delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
      } else {
        process.env.TEST_ENABLE_SESSION_PERSISTENCE = prevEnablePersist
      }
    }
  })

  // ── Finding 5 (P1-D4) ────────────────────────────────────────────────────
  test('P1-D4: pluginUsagePending drops exit flush when isolated/diskless Session was GCd instead of writing to default ~/.claude.json', async () => {
    const defaultCfgDir = makeTempDir('reaudit-usage-default-')
    const defaultGlobalCfg = join(defaultCfgDir, '.claude.json')
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = defaultCfgDir

    try {
      const deadPluginKey = `dead-tenant-plugin-${randomUUID()}@test`
      let sessionRef: WeakRef<object> | undefined

      const recordInEphemeralDisklessHost = () => {
        runWithNewHostSession(
          { id: 'reaudit-d4-ephemeral', diskless: true },
          session => {
            sessionRef = new WeakRef(session)
            incrementPluginUsage(deadPluginKey)
          },
        )
      }
      recordInEphemeralDisklessHost()

      for (let i = 0; i < 20 && sessionRef?.deref() !== undefined; i++) {
        forceGc()
        await delay(5)
      }
      expect(sessionRef?.deref()).toBeUndefined()

      // Simulate process 'exit' listener firing after isolated Session has been collected.
      // Invoke only the pluginUsagePending listener (or emit exit safely without breaking runner).
      const exitListeners = process.listeners('exit')
      for (const listener of exitListeners) {
        if (listener.name === 'sko') {
          listener(0)
        }
      }

      // Default ~/.claude.json MUST NOT contain the GC'd isolated/diskless tenant's plugin usage!
      if (existsSync(defaultGlobalCfg)) {
        const raw = readFileSync(defaultGlobalCfg, 'utf8')
        expect(raw).not.toContain(deadPluginKey)
      } else {
        expect(existsSync(defaultGlobalCfg)).toBe(false)
      }
    } finally {
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
    }
  })

  // ── Finding 6 (P1-D5) ────────────────────────────────────────────────────
  test('P1-D5: settingsWriteQueues is per-host and host.dispose() drains in-flight diskless StorageV5 userSettings writes before closing storageV5', async () => {
    const configDir = makeTempDir('reaudit-settings-d5-')
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = configDir
    resetSettingsCache()

    try {
      // 1. Two isolated hosts' runInSettingsWriteQueue do NOT block each other on the same key
      let releaseHostA!: () => void
      const hostAGate = new Promise<void>(resolve => {
        releaseHostA = resolve
      })
      let hostBCompleted = false

      const hostA = createEmbeddedHost({
        tenantId: 'd5-host-a',
        diskless: true,
      })
      const hostB = createEmbeddedHost({
        tenantId: 'd5-host-b',
        diskless: true,
      })

      const hostAWrite = hostA.run(() =>
        runInSettingsWriteQueue('shared-key', async () => {
          await hostAGate
          return 'a-done'
        }),
      )
      await hostB.run(async () => {
        const res = await runInSettingsWriteQueue('shared-key', async () => {
          hostBCompleted = true
          return 'b-done'
        })
        expect(res).toBe('b-done')
        // drainSettingsWrites on Host B must NOT wait on Host A's stuck queue!
        await drainSettingsWrites()
      })
      expect(hostBCompleted).toBe(true)
      releaseHostA()
      expect(await hostAWrite).toBe('a-done')
      await hostA.dispose()
      await hostB.dispose()

      // 2. EmbeddedHost.dispose() flushes an in-flight delayed StorageV5 userSettings write
      //    BEFORE closing auto-owned storageV5!
      const tenantHost = createEmbeddedHost({
        tenantId: 'd5-dispose-drain',
        diskless: true,
        autoMemoryStorage: true,
      })
      const ownedStorage = tenantHost.storageV5
      expect(ownedStorage).toBeDefined()
      if (!ownedStorage) throw new Error('expected auto-owned storageV5')

      let writeFinishedBeforeClose = false
      let storageClosed = false
      const origWrite = ownedStorage.write.bind(ownedStorage)
      const origClose = ownedStorage.close.bind(ownedStorage)
      ownedStorage.write = async (key, value, opts) => {
        await delay(40)
        if (storageClosed) {
          return { ok: false, error: { code: 'Closed' } }
        }
        const res = await origWrite(key, value, opts)
        if (res.ok) {
          writeFinishedBeforeClose = true
        }
        return res
      }
      ownedStorage.close = async () => {
        storageClosed = true
        return await origClose()
      }

      let pendingPersist!: Promise<{ error: Error | null }>
      await tenantHost.run(async () => {
        // Fire-and-forget settings persist right before host.dispose()
        pendingPersist = persistSettingsForSource('userSettings', {
          model: 'claude-sonnet-4-5',
        })
      })

      // Immediately dispose host — registerPreExitFlush/registerCleanup MUST drain pendingPersist
      // BEFORE ownedStorage.close() runs!
      await tenantHost.dispose()
      const persistRes = await pendingPersist
      expect(persistRes.error).toBeNull()
      expect(writeFinishedBeforeClose).toBe(true)
      expect(storageClosed).toBe(true)
    } finally {
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
      resetSettingsCache()
    }
  })

  // ── Finding 7 (P1-D6) ────────────────────────────────────────────────────
  test('P1-D6: changeDetector.initialize() inside isolated ALS runs MDM/chokidar outside ALS, preserves cross-host policySettings fan-out, releases cwd refcount on cleanup, and does not pin Session', async () => {
    const configDir = makeTempDir('reaudit-cd-cfg-')
    const wsA = makeTempDir('reaudit-cd-wsa-')
    const wsB = makeTempDir('reaudit-cd-wsb-')
    mkdirSync(join(wsA, '.claude'), { recursive: true })
    mkdirSync(join(wsB, '.claude'), { recursive: true })
    writeFileSync(
      join(wsA, '.claude', 'settings.json'),
      JSON.stringify({ model: 'a-init' }),
    )
    writeFileSync(
      join(wsB, '.claude', 'settings.json'),
      JSON.stringify({ model: 'b-init' }),
    )

    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = configDir
    resetSettingsCache()

    await settingsChangeDetector.resetForTesting({
      stabilityThreshold: 40,
      pollInterval: 20,
      watchPollInterval: 100,
      mdmPollInterval: 60_000,
      fsWatchProbe: async () => 'delivers',
    })

    const origSetInterval = globalThis.setInterval
    const capturedIntervalAlsStates: boolean[] = []
    const capturedIntervalCallbacks: Array<() => void> = []
    globalThis.setInterval = ((
      cb: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      capturedIntervalAlsStates.push(hasActiveSessionAls())
      capturedIntervalCallbacks.push(() => cb(...args))
      return origSetInterval(cb, ms, ...args)
    }) as typeof globalThis.setInterval

    try {
      // 1. Initialize inside an ephemeral isolated ALS Host A:
      //    - timers/watchers must be created outside ALS (capturedIntervalAlsStates all false)
      //    - wsA is tracked via per-host ref-count and released to 0 on Host A cleanup
      //    - Host A Session is NOT pinned in memory after cleanup
      let sessionARef: WeakRef<object> | undefined
      const runHostA = async () => {
        await runWithNewHostSession(
          { id: 'd6-host-a', cwd: wsA, originalCwd: wsA },
          async sessionA => {
            sessionARef = new WeakRef(sessionA)
            await settingsChangeDetector.initialize()
            expect(getWatchedProjectCwdRefCountForTests(wsA)).toBe(1)
            await runCleanupFunctions()
            expect(getWatchedProjectCwdRefCountForTests(wsA)).toBe(0)
          },
        )
      }
      await runHostA()

      // Every interval scheduled by initialize() (startMdmPolling / watchForDirectory)
      // must have been registered outside ALS!
      expect(capturedIntervalAlsStates.length).toBeGreaterThanOrEqual(1)
      expect(capturedIntervalAlsStates.every(inAls => inAls === false)).toBe(
        true,
      )

      // Host A's Session must be GC-able (not pinned by mdmTimer or chokidar)
      for (let i = 0; i < 20 && sessionARef?.deref() !== undefined; i++) {
        forceGc()
        await delay(5)
      }
      expect(sessionARef?.deref()).toBeUndefined()

      // 2. Cross-host watcher delivery: Host B joins after Host A disposed and receives
      //    chokidar projectSettings changes inside its own ALS context.
      const hostBEvents: Array<{ source: string; inHostB: boolean }> = []
      const defaultEvents: string[] = []
      const unsubDefault = settingsChangeDetector.subscribe(source => {
        defaultEvents.push(source)
      })
      try {
        await runWithNewHostSession(
          { id: 'd6-host-b', cwd: wsB, originalCwd: wsB },
          async sessionB => {
            await ensureProjectWatchedForCurrentHost()
            expect(getWatchedProjectCwdRefCountForTests(wsB)).toBe(1)
            const unsubB = settingsChangeDetector.subscribe(source => {
              hostBEvents.push({
                source,
                inHostB:
                  hasActiveSessionAls() && getBootstrapSession() === sessionB,
              })
            })
            try {
              await delay(150)
              writeFileSync(
                join(wsB, '.claude', 'settings.json'),
                JSON.stringify({ model: 'b-updated' }),
              )
              const sawB = await waitUntil(
                () =>
                  hostBEvents.some(
                    e => e.source === 'projectSettings' && e.inHostB,
                  ),
                4_000,
              )
              expect(sawB).toBe(true)

              // Outside-ALS policySettings notification fans out to BOTH Host B and default host
              hostBEvents.length = 0
              defaultEvents.length = 0
            } finally {
              // Keep Host B subscribed briefly while we trigger an outside-ALS policySettings fan-out
              // (matching MDM poll / chokidar callback context)
              const unsubBRef = unsubB
              void unsubBRef
            }
            // Wait until outside sessionB ALS to verify outside-ALS policySettings fan-out reaches BOTH
            // Host B and default host!
            return { sessionB, unsubB }
          },
        ).then(async ({ sessionB, unsubB }) => {
          try {
            // Outside ALS (just like mdmTimer / chokidar callbacks created in exitSessionContext)
            expect(hasActiveSessionAls()).toBe(false)
            settingsChangeDetector.notifyChange('policySettings')
            expect(
              hostBEvents.some(e => e.source === 'policySettings' && e.inHostB),
            ).toBe(true)
            expect(defaultEvents).toContain('policySettings')
            // Also verify captured mdmTimer callback itself runs outside ALS without throwing
            expect(capturedIntervalCallbacks.length).toBeGreaterThanOrEqual(1)
            for (const cb of capturedIntervalCallbacks) {
              cb()
            }
          } finally {
            unsubB()
            await runWithSession(sessionB, () => runCleanupFunctions())
          }
        })
        expect(getWatchedProjectCwdRefCountForTests(wsB)).toBe(0)
      } finally {
        unsubDefault()
      }
    } finally {
      globalThis.setInterval = origSetInterval
      await settingsChangeDetector.resetForTesting()
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
      resetSettingsCache()
    }
  })
})
