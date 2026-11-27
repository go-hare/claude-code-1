import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHoverRestBackend } from '../createHoverRestBackend.js'
import { createLocalFsBackend } from '../createLocalFsBackend.js'
import { createMemoryStorageV5Backend } from '../createMemoryBackend.js'
import { runSerializedByPath, withStorageLock } from '../storageLock.js'
import { StorageWatchBus } from '../storageWatchBus.js'
import {
  exitSessionContext,
  getActiveSubconversationFromAls,
  getBootstrapSession,
  runWithNewHostSession,
} from '../../sessionHost.js'
import { runWithSubconversationContext } from '../../sessionContextAls.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('StorageV5 Hardening Pass (R1 P0/P1/P2)', () => {
  describe('R1-P0-1: createMemoryBackend scope validation & containment', () => {
    test('rejects traversal and malformed scopes across all scope operations without touching valid files', async () => {
      const mem = createMemoryStorageV5Backend({ configHome: '/mem-home' })
      await mem.write({ namespace: 'plan', name: 'keep-me' }, 'precious')
      await mem.write(
        { namespace: 'memory', projectKey: 'proj-a', relPath: ['note.md'] },
        'note',
      )

      const invalidScopes: unknown[] = [
        { namespace: 'memory', projectKey: '../..' },
        { namespace: 'memory', projectKey: '../../..' },
        { namespace: 'memory', projectKey: 'proj-a', relPath: ['..', '..'] },
        { namespace: 'memory' }, // missing required projectKey
        { namespace: 'transcript', sessionId: 'sess-1' }, // sessionId without projectKey
        { namespace: 'unknownNamespace' },
        null,
        'not-an-object',
      ]

      for (const badScope of invalidScopes) {
        const del = await mem.deleteScope(badScope)
        expect(del.ok).toBe(false)
        if (!del.ok) expect(del.error.code).toBe('InvalidArgument')

        const entries = await mem.listEntries(badScope)
        expect(entries.ok).toBe(false)
        if (!entries.ok) expect(entries.error.code).toBe('InvalidArgument')

        const rec = await mem.listRecursive(badScope)
        expect(rec.ok).toBe(false)
        if (!rec.ok) expect(rec.error.code).toBe('InvalidArgument')

        const keys = await mem.scopeKeys(badScope)
        expect(keys.ok).toBe(false)
        if (!keys.ok) expect(keys.error.code).toBe('InvalidArgument')

        const resolved = await mem.resolveKey(
          { namespace: 'memory', projectKey: 'proj-a', relPath: ['note.md'] },
          {
            within: badScope as Record<string, unknown>,
            anchor: 'literal',
          },
        )
        expect(resolved.ok).toBe(false)
        if (!resolved.ok) expect(resolved.error.code).toBe('InvalidArgument')

        const sub = await mem.subscribe(
          { target: 'scope', scope: badScope },
          () => {},
        )
        expect(sub.ok).toBe(false)
        if (!sub.ok) expect(sub.error.code).toBe('InvalidArgument')
      }

      // Existing data must be completely untouched
      const snap = mem.snapshot()
      expect(snap['/mem-home/plans/keep-me.md']).toBe('precious')
      expect(snap['/mem-home/projects/proj-a/memory/note.md']).toBe('note')
    })
  })

  describe('R1-P0-2: stagingScopeBeside / stagingScopeWithin official delegation', () => {
    test('delegates to official stagingScopeBesidePf / stagingScopeWithinLf without aliasing live path', async () => {
      const mem = createMemoryStorageV5Backend({ configHome: '/mem-stage' })
      const hover = createHoverRestBackend({
        baseUrl: 'http://127.0.0.1:19999',
        fetchImpl: async () => new Response('{}', { status: 200 }),
      })

      const liveScope = {
        namespace: 'pluginCache',
        marketplace: 'mp1',
        plugin: 'plug1',
        version: '1.0.0',
      }
      const parentScope = {
        namespace: 'pluginCache',
        marketplace: 'mp1',
        plugin: 'plug1',
      }

      for (const backend of [mem, hover]) {
        const beside = backend.stagingScopeBeside(liveScope)
        expect(beside.namespace).toBe('pluginCache')
        expect(beside.marketplace).toBe('mp1')
        expect(beside.plugin).toBe('plug1')
        expect(typeof beside.version).toBe('string')
        expect(String(beside.version)).toMatch(/^1\.0\.0\.tmp~[0-9a-f]{8}$/)
        expect(beside.version).not.toBe(liveScope.version)
        expect('staging' in beside).toBe(false)

        const within = backend.stagingScopeWithin(parentScope)
        expect(within.namespace).toBe('pluginCache')
        expect(typeof within.version).toBe('string')
        expect(String(within.version)).toMatch(/^install\.tmp~[0-9a-f]{8}$/)
        expect('staging' in within).toBe(false)

        // Unsupported scope classes must throw (never silently alias live path)
        expect(() =>
          backend.stagingScopeBeside({
            namespace: 'memory',
            projectKey: 'proj',
          }),
        ).toThrow()
        expect(() =>
          backend.stagingScopeWithin({ namespace: 'plan' }),
        ).toThrow()
      }

      // Verify in MemoryStorageV5 that writing to staging scope never overwrites live scope
      const liveKey = { ...liveScope, relPath: ['manifest.json'] }
      await mem.write(liveKey, '{"v":"live"}')
      const stagedScope = mem.stagingScopeBeside(liveScope)
      const stagedKey = { ...stagedScope, relPath: ['manifest.json'] }
      await mem.write(stagedKey, '{"v":"staged"}')

      const liveRead = await mem.readText([liveKey])
      expect(liveRead.ok).toBe(true)
      if (liveRead.ok) {
        expect(liveRead.value.items[0]?.value).toBe('{"v":"live"}')
      }
    })
  })

  describe('R1-P1-5: createMemoryBackend readRecords pagination', () => {
    test('forward pagination with limit and maxBytes does not skip unread records', async () => {
      const mem = createMemoryStorageV5Backend({ configHome: '/mem-page' })
      const key = {
        namespace: 'transcript',
        projectKey: 'p1',
        sessionId: 's1',
      }
      await mem.append(key, [
        { data: '{"i":1}', recordId: 'r1' },
        { data: '{"i":2}', recordId: 'r2' },
        { data: '{"i":3}', recordId: 'r3' },
        { data: '{"i":4}', recordId: 'r4' },
        { data: '{"i":5}', recordId: 'r5' },
      ])

      // Forward pagination with limit: 2
      const collectedIds: string[] = []
      let cursor: number | undefined = 1
      for (let page = 0; page < 5; page++) {
        const res = await mem.readRecords(key, {
          order: 'forward',
          fromSeq: cursor,
          limit: 2,
        })
        expect(res.ok).toBe(true)
        if (!res.ok) throw new Error('expected ok')
        if (res.value.items.length === 0) break
        for (const item of res.value.items) {
          collectedIds.push(item.recordId ?? '')
        }
        cursor = res.value.nextSeq
      }
      expect(collectedIds).toEqual(['r1', 'r2', 'r3', 'r4', 'r5'])

      // Forward pagination with maxBytes cap
      const firstBytesPage = await mem.readRecords(key, {
        order: 'forward',
        fromSeq: 1,
        maxBytes: 15, // fits two 7-byte records (14 bytes), stops before 3rd
      })
      expect(firstBytesPage.ok).toBe(true)
      if (firstBytesPage.ok) {
        expect(firstBytesPage.value.items.map(i => i.recordId)).toEqual([
          'r1',
          'r2',
        ])
        expect(firstBytesPage.value.nextSeq).toBe(3)
      }

      // Backward pagination walks all records in reverse without skipping
      const backwardIds: string[] = []
      let bwdCursor: number | undefined
      for (let page = 0; page < 5; page++) {
        const res = await mem.readRecords(key, {
          order: 'backward',
          fromSeq: bwdCursor,
          limit: 2,
        })
        expect(res.ok).toBe(true)
        if (!res.ok) throw new Error('expected ok')
        for (const item of res.value.items) {
          backwardIds.push(item.recordId ?? '')
        }
        if (res.value.nextSeq === undefined) break
        bwdCursor = res.value.nextSeq
      }
      expect(backwardIds).toEqual(['r5', 'r4', 'r3', 'r2', 'r1'])
    })
  })

  describe('R1-P1-6: createMemoryBackend writeFromStream validation, error mapping, & re-checks', () => {
    test('rejects invalid maxBytes, maps iterator errors to IoError, and re-checks closed/precondition', async () => {
      const mem = createMemoryStorageV5Backend({ configHome: '/mem-stream' })
      const key = { namespace: 'paste', id: 's1' }

      async function* emptyStream() {
        yield 'ok'
      }

      for (const badMax of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const res = await mem.writeFromStream(key, emptyStream(), {
          maxBytes: badMax,
        })
        expect(res.ok).toBe(false)
        if (!res.ok) {
          expect(res.error.code).toBe('InvalidArgument')
          expect(res.error.argument).toBe('opts.maxBytes')
        }
      }

      async function* throwingStream() {
        yield 'part1'
        throw new Error('upstream stream exploded')
      }
      const errRes = await mem.writeFromStream(key, throwingStream(), {
        maxBytes: 1024,
      })
      expect(errRes.ok).toBe(false)
      if (!errRes.ok) expect(errRes.error.code).toBe('IoError')

      // Precondition race: concurrent writer creates the key while stream is yielding
      async function* racingStream() {
        yield 'part1'
        await mem.write(key, 'concurrent-winner')
        yield 'part2'
      }
      const raceRes = await mem.writeFromStream(key, racingStream(), {
        maxBytes: 1024,
        precondition: { type: 'ifAbsent' },
      })
      expect(raceRes.ok).toBe(false)
      if (!raceRes.ok) expect(raceRes.error.code).toBe('PreconditionFailed')
      expect(mem.snapshot()['/mem-stream/paste-cache/s1.txt']).toBe(
        'concurrent-winner',
      )

      // Closed race: backend closes while stream is yielding
      const key2 = { namespace: 'paste', id: 's2' }
      async function* closingStream() {
        yield 'part1'
        await mem.close()
        yield 'part2'
      }
      const closeRace = await mem.writeFromStream(key2, closingStream(), {
        maxBytes: 1024,
      })
      expect(closeRace.ok).toBe(false)
      if (!closeRace.ok) expect(closeRace.error.code).toBe('Closed')
    })
  })

  describe('R1-P1-7 & R1-P2-5: createMemoryBackend moveScope, writeFromFile, digest, listLeases', () => {
    test('moveScope rejects overlapping dirs, enforces AlreadyExists without replace, and notifies changes', async () => {
      const mem = createMemoryStorageV5Backend({ configHome: '/mem-move' })
      const parent = { namespace: 'memory', projectKey: 'p1' }
      const child = { namespace: 'memory', projectKey: 'p1', relPath: ['sub'] }
      await mem.write(
        { namespace: 'memory', projectKey: 'p1', relPath: ['a.md'] },
        'a',
      )

      // Overlapping parent -> child and child -> parent must fail
      const overlap1 = await mem.moveScope(parent, child)
      expect(overlap1.ok).toBe(false)
      if (!overlap1.ok) {
        expect(overlap1.error.code).toBe('InvalidArgument')
        expect(overlap1.error.argument).toBe('to')
      }
      const overlap2 = await mem.moveScope(child, parent)
      expect(overlap2.ok).toBe(false)
      if (!overlap2.ok) {
        expect(overlap2.error.code).toBe('InvalidArgument')
        expect(overlap2.error.argument).toBe('to')
      }

      // AlreadyExists when destination exists and replace is not true
      const srcScope = {
        namespace: 'pluginCache',
        marketplace: 'mp',
        plugin: 'plug',
        version: 'v1.tmp~12345678',
      }
      const dstScope = {
        namespace: 'pluginCache',
        marketplace: 'mp',
        plugin: 'plug',
        version: 'v1',
      }
      await mem.write({ ...srcScope, relPath: ['new.txt'] }, 'new-data')
      await mem.write({ ...dstScope, relPath: ['old.txt'] }, 'old-data')

      const conflict = await mem.moveScope(srcScope, dstScope)
      expect(conflict.ok).toBe(false)
      if (!conflict.ok) expect(conflict.error.code).toBe('AlreadyExists')

      // Subscribe and verify notifications on moveScope(..., { replace: true })
      const events: Array<{ type: string; path: string }> = []
      const sub = await mem.subscribe(
        {
          target: 'scope',
          scope: { namespace: 'pluginCache', marketplace: 'mp' },
        },
        ev => events.push(ev as { type: string; path: string }),
      )
      expect(sub.ok).toBe(true)

      const replaced = await mem.moveScope(srcScope, dstScope, {
        replace: true,
      })
      expect(replaced.ok).toBe(true)
      expect(
        events.some(e => e.type === 'delete' && e.path.endsWith('/v1/old.txt')),
      ).toBe(true)
      expect(
        events.some(e => e.type === 'write' && e.path.endsWith('/v1/new.txt')),
      ).toBe(true)
      expect(
        events.some(
          e =>
            e.type === 'delete' && e.path.endsWith('/v1.tmp~12345678/new.txt'),
        ),
      ).toBe(true)
    })

    test('writeFromFile clears cached stream, digest rejects unknown algorithm, listLeases filters by scope', async () => {
      const mem = createMemoryStorageV5Backend({ configHome: '/mem-p25' })
      const streamKey = {
        namespace: 'transcript',
        projectKey: 'p1',
        sessionId: 's1',
      }
      await mem.append(streamKey, [{ data: '{"old":1}', recordId: 'old-1' }])
      await mem.write({ namespace: 'plan', name: 'src' }, '{"fresh":2}\n')

      const wf = await mem.writeFromFile(streamKey, '/mem-p25/plans/src.md')
      expect(wf.ok).toBe(true)
      const records = await mem.readRecords(streamKey)
      expect(records.ok).toBe(true)
      if (records.ok) {
        expect(records.value.items).toHaveLength(1)
        expect(new TextDecoder().decode(records.value.items[0]!.data)).toBe(
          '{"fresh":2}',
        )
      }

      // Invalid digest algorithm returns InvalidArgument instead of throwing
      const badDigest = await mem.digest(
        { namespace: 'plan', name: 'src' },
        { algorithm: 'not-a-real-hash-algo' },
      )
      expect(badDigest.ok).toBe(false)
      if (!badDigest.ok) {
        expect(badDigest.error.code).toBe('InvalidArgument')
        expect(badDigest.error.argument).toBe('opts.algorithm')
      }

      // listLeases filters by scope
      await mem.acquireLease(
        { namespace: 'task', listId: 'list-a', taskId: '1' },
        10_000,
        { holder: 'h1' },
      )
      await mem.acquireLease(
        { namespace: 'task', listId: 'list-b', taskId: '2' },
        10_000,
        { holder: 'h2' },
      )

      const onlyA = await mem.listLeases({
        namespace: 'task',
        listId: 'list-a',
      })
      expect(onlyA.ok).toBe(true)
      if (onlyA.ok) {
        expect(onlyA.value.items).toHaveLength(1)
        expect(onlyA.value.items[0]?.holder).toBe('h1')
      }

      const allTasks = await mem.listLeases({ namespace: 'task' })
      expect(allTasks.ok).toBe(true)
      if (allTasks.ok) {
        expect(allTasks.value.items).toHaveLength(2)
      }
    })
  })

  describe('R1-P0-3, R1-P1-8, R1-P2-6: createHoverRestBackend hardening', () => {
    test('constructor validates defaultTimeoutMs and maxResponseBodyBytes', () => {
      for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() =>
          createHoverRestBackend({
            baseUrl: 'http://127.0.0.1:8080',
            defaultTimeoutMs: bad,
          }),
        ).toThrow(/defaultTimeoutMs/)
        expect(() =>
          createHoverRestBackend({
            baseUrl: 'http://127.0.0.1:8080',
            maxResponseBodyBytes: bad,
          }),
        ).toThrow(/maxResponseBodyBytes/)
      }
    })

    test('maps body read errors, enforces maxResponseBodyBytes, and rejects empty/non-object 2xx responses', async () => {
      // 1. Timeout/Abort during body read -> Unavailable / TIMEOUT
      const abortHover = createHoverRestBackend({
        baseUrl: 'http://127.0.0.1:8080',
        fetchImpl: async () => {
          const stream = new ReadableStream({
            start(controller) {
              const err = new Error('timed out')
              err.name = 'TimeoutError'
              controller.error(err)
            },
          })
          return new Response(stream, { status: 200 })
        },
      })
      const timeoutRes = await abortHover.stat({
        namespace: 'plan',
        name: 'a',
      })
      expect(timeoutRes.ok).toBe(false)
      if (!timeoutRes.ok) {
        expect(timeoutRes.error.code).toBe('Unavailable')
        expect(timeoutRes.error.telemetryCode).toBe('TIMEOUT')
      }

      // 2. Generic body read error -> IoError / BODY_READ_ERROR
      const errHover = createHoverRestBackend({
        baseUrl: 'http://127.0.0.1:8080',
        fetchImpl: async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.error(new Error('socket reset'))
            },
          })
          return new Response(stream, { status: 200 })
        },
      })
      const bodyErrRes = await errHover.stat({ namespace: 'plan', name: 'a' })
      expect(bodyErrRes.ok).toBe(false)
      if (!bodyErrRes.ok) {
        expect(bodyErrRes.error.code).toBe('IoError')
        expect(bodyErrRes.error.telemetryCode).toBe('BODY_READ_ERROR')
      }

      // 3. Response exceeding maxResponseBodyBytes -> TooLarge / RESPONSE_TOO_LARGE
      const cappedHover = createHoverRestBackend({
        baseUrl: 'http://127.0.0.1:8080',
        maxResponseBodyBytes: 16,
        fetchImpl: async () =>
          new Response(JSON.stringify({ huge: '01234567890123456789' }), {
            status: 200,
          }),
      })
      const tooLargeRes = await cappedHover.stat({
        namespace: 'plan',
        name: 'a',
      })
      expect(tooLargeRes.ok).toBe(false)
      if (!tooLargeRes.ok) {
        expect(tooLargeRes.error.code).toBe('TooLarge')
        expect(tooLargeRes.error.telemetryCode).toBe('RESPONSE_TOO_LARGE')
      }

      // 4. Empty 2xx or non-object 2xx on non-void endpoint -> IoError / EMPTY_RESPONSE
      const emptyHover = createHoverRestBackend({
        baseUrl: 'http://127.0.0.1:8080',
        fetchImpl: async () => new Response('', { status: 200 }),
      })
      const emptyRes = await emptyHover.stat({ namespace: 'plan', name: 'a' })
      expect(emptyRes.ok).toBe(false)
      if (!emptyRes.ok) {
        expect(emptyRes.error.code).toBe('IoError')
        expect(emptyRes.error.telemetryCode).toBe('EMPTY_RESPONSE')
      }

      const nullPayloadHover = createHoverRestBackend({
        baseUrl: 'http://127.0.0.1:8080',
        fetchImpl: async () =>
          new Response(JSON.stringify({ ok: true, value: null }), {
            status: 200,
          }),
      })
      const nullRes = await nullPayloadHover.acquireLease({ lock: 'x' }, 5_000)
      expect(nullRes.ok).toBe(false)
      if (!nullRes.ok) {
        expect(nullRes.error.code).toBe('IoError')
      }

      // 5. Void endpoints (/v5/leases/release, /v5/host-files/rename) allow empty 200
      const voidHover = createHoverRestBackend({
        baseUrl: 'http://127.0.0.1:8080',
        fetchImpl: async url => {
          if (String(url).endsWith('/v5/leases/acquire')) {
            return new Response(
              JSON.stringify({ holder: 'h1', expiresAtMs: Date.now() + 5000 }),
              { status: 200 },
            )
          }
          return new Response('', { status: 200 })
        },
      })
      const lease = await voidHover.acquireLease({ lock: 'x' }, 5_000)
      expect(lease.ok).toBe(true)
      if (lease.ok) {
        const rel = await lease.value.release()
        expect(rel.ok).toBe(true)
      }
      const renameRes = await voidHover.hostFiles.rename('/a', '/b')
      expect(renameRes.ok).toBe(true)
    })

    test('update catches edit throw, validates decision, and uses exists (not ifAbsent) when found without version', async () => {
      const sentBodies: Array<{ url: string; body: Record<string, unknown> }> =
        []
      const hover = createHoverRestBackend({
        baseUrl: 'http://127.0.0.1:8080',
        fetchImpl: async (url, init) => {
          const parsed = JSON.parse(String(init?.body ?? '{}')) as Record<
            string,
            unknown
          >
          sentBodies.push({ url: String(url), body: parsed })
          if (String(url).endsWith('/v5/leases/acquire')) {
            return new Response(
              JSON.stringify({
                leaseId: 'lease-1',
                holder: String(
                  (parsed.opts as { holder?: string } | undefined)?.holder ??
                    'h1',
                ),
                expiresAtMs: Date.now() + 10_000,
              }),
              { status: 200 },
            )
          }
          if (String(url).endsWith('/v5/leases/release')) {
            return new Response(JSON.stringify({ released: true }), {
              status: 200,
            })
          }
          if (String(url).endsWith('/v5/keys/read')) {
            return new Response(
              JSON.stringify({
                items: [{ found: true, value: 'existing', encoding: 'utf8' }],
              }),
              { status: 200 },
            )
          }
          return new Response(JSON.stringify({ version: 'v2' }), {
            status: 200,
          })
        },
      })

      const key = { namespace: 'plan', name: 'u1' }

      // edit throws -> fail('Failed', { argument: 'edit' })
      const threw = await hover.update(key, () => {
        throw new Error('edit boom')
      })
      expect(threw.ok).toBe(false)
      if (!threw.ok) {
        expect(threw.error.code).toBe('Failed')
        expect(threw.error.argument).toBe('edit')
      }

      // invalid decision -> fail('InvalidArgument', { argument: 'edit' })
      const badDecision = await hover.update(
        key,
        () => ({ invalid: true }) as unknown as { skip: true },
      )
      expect(badDecision.ok).toBe(false)
      if (!badDecision.ok) {
        expect(badDecision.error.code).toBe('InvalidArgument')
        expect(badDecision.error.argument).toBe('edit')
      }

      // plain key + found without version -> omit precondition (NEVER non-spec { type: 'exists' } or ifAbsent)
      const okUpd = await hover.update(key, () => ({ write: 'updated' }))
      expect(okUpd.ok).toBe(true)
      const writeCall = sentBodies.find(c => c.url.endsWith('/v5/keys/write'))
      expect(writeCall).toBeDefined()
      expect(
        (writeCall?.body.opts as { precondition?: unknown })?.precondition,
      ).toBeUndefined()
    })

    test('writeFromStream validates maxBytes & catches iterator error, listRecursive decodes includeValue, hostFiles honors servesHostFiles', async () => {
      const hover = createHoverRestBackend({
        baseUrl: 'http://127.0.0.1:8080',
        servesHostFiles: space => space === 'workspace',
        fetchImpl: async url => {
          if (String(url).endsWith('/v5/scopes/list-recursive')) {
            return new Response(
              JSON.stringify({
                items: [
                  {
                    kind: 'key',
                    key: { namespace: 'plan', name: 'a' },
                    valueBase64: Buffer.from('hello-bytes').toString('base64'),
                  },
                ],
              }),
              { status: 200 },
            )
          }
          return new Response(JSON.stringify({ version: 'v1' }), {
            status: 200,
          })
        },
      })

      expect(hover.hostFiles.serves('workspace')).toBe(true)
      expect(hover.hostFiles.serving('workspace')).toBe('host')
      expect(hover.hostFiles.serves('home')).toBe(false)
      expect(hover.hostFiles.serving('home')).toBe('absent')

      const badMax = await hover.writeFromStream(
        { namespace: 'paste', id: 'p1' },
        (async function* () {
          yield 'a'
        })(),
        { maxBytes: Number.NaN },
      )
      expect(badMax.ok).toBe(false)
      if (!badMax.ok) expect(badMax.error.code).toBe('InvalidArgument')

      const iterErr = await hover.writeFromStream(
        { namespace: 'paste', id: 'p1' },
        (async function* () {
          yield 'a'
          throw new Error('stream failed')
        })(),
        { maxBytes: 100 },
      )
      expect(iterErr.ok).toBe(false)
      if (!iterErr.ok) expect(iterErr.error.code).toBe('IoError')

      const rec = await hover.listRecursive(
        { namespace: 'plan' },
        { includeValue: true },
      )
      expect(rec.ok).toBe(true)
      if (rec.ok) {
        const entry = rec.value.items[0] as unknown as {
          value?: Uint8Array
        }
        expect(entry.value).toBeInstanceOf(Uint8Array)
        expect(new TextDecoder().decode(entry.value)).toBe('hello-bytes')
      }
    })
  })

  describe('R1-P2-1: digestLog hashContentVersion cross-runtime determinism', () => {
    test('produces exact sha256-prefix version hash matching Node crypto deterministically', async () => {
      const root = mkdtempSync(join(tmpdir(), 'storagev5-hash-'))
      tempDirs.push(root)
      const backend = createLocalFsBackend({
        configHome: root,
        globalConfigFile: join(root, '.claude.json'),
      })
      try {
        const content = 'deterministic-cross-runtime-payload-2.1.331'
        const expectedVersion = createHash('sha256')
          .update(content)
          .digest()
          .subarray(0, 8)
          .toString('hex')
        const writeRes = await backend.write(
          { namespace: 'plan', name: 'hash-check' },
          content,
        )
        expect(writeRes.ok).toBe(true)
        if (writeRes.ok) {
          expect(writeRes.value.version).toBe(expectedVersion)
        }
      } finally {
        await backend.close()
      }
    })
  })

  describe('E4-P0-2: StorageV5 path traversal & validateStorageKey across LocalFs and Memory', () => {
    test('rejects traversal in settings projectKey/consentRootKey, globalConfig kind/stamp, and invalid keys across stat/statMeta/touch/setMode/digest/readValue', async () => {
      const root = mkdtempSync(join(tmpdir(), 'storagev5-e4-p02-'))
      tempDirs.push(root)
      const localFs = createLocalFsBackend({
        configHome: root,
        globalConfigFile: join(root, '.claude.json'),
      })
      const mem = createMemoryStorageV5Backend({ configHome: '/mem-e4-p02' })
      try {
        const badKeys: unknown[] = [
          {
            namespace: 'settings',
            layer: 'project',
            projectKey: '../../etc',
          },
          {
            namespace: 'settings',
            layer: 'consent',
            consentRootKey: '../escape',
          },
          {
            namespace: 'globalConfig',
            kind: '../pwn',
            stamp: '2026',
          },
          {
            namespace: 'globalConfig',
            kind: 'corrupted',
            stamp: '../../evil',
          },
          {
            namespace: 'sidecar',
            projectKey: 'proj-a',
            sessionId: 'sess-1',
            relPath: ['bad.jsonl'],
          },
          {
            namespace: 'plan',
            name: '../escape-plan',
          },
        ]

        for (const backend of [localFs, mem]) {
          for (const badKey of badKeys) {
            const w = await backend.write(badKey, 'nope')
            expect(w.ok).toBe(false)
            if (!w.ok) expect(w.error.code).toBe('InvalidArgument')

            const st = await backend.stat(badKey)
            expect(st.ok).toBe(false)
            if (!st.ok) expect(st.error.code).toBe('InvalidArgument')

            const sm = await backend.statMeta(badKey)
            expect(sm.ok).toBe(false)
            if (!sm.ok) expect(sm.error.code).toBe('InvalidArgument')

            const tc = await backend.touch(badKey)
            expect(tc.ok).toBe(false)
            if (!tc.ok) expect(tc.error.code).toBe('InvalidArgument')

            const md = await backend.setMode(badKey, 0o600)
            expect(md.ok).toBe(false)
            if (!md.ok) expect(md.error.code).toBe('InvalidArgument')

            const dg = await backend.digest(badKey)
            expect(dg.ok).toBe(false)
            if (!dg.ok) expect(dg.error.code).toBe('InvalidArgument')

            const rv = await backend.readValue(badKey)
            expect(rv).toBeUndefined()
          }
        }
      } finally {
        await localFs.close()
        await mem.close()
      }
    })
  })

  describe('E4-P1-6: LocalFs forward pagination fix & cross-backend parity', () => {
    test('LocalFs readRecords forward pagination with limit/maxBytes advances monotonically without looping', async () => {
      const root = mkdtempSync(join(tmpdir(), 'storagev5-e4-page-'))
      tempDirs.push(root)
      const localFs = createLocalFsBackend({
        configHome: root,
        globalConfigFile: join(root, '.claude.json'),
      })
      try {
        const key = {
          namespace: 'transcript',
          projectKey: 'proj-page',
          sessionId: 'sess-page',
        }
        const app = await localFs.append(key, [
          { data: '{"i":1}\n' },
          { data: '{"i":2}\n' },
          { data: '{"i":3}\n' },
          { data: '{"i":4}\n' },
          { data: '{"i":5}\n' },
        ])
        expect(app.ok).toBe(true)

        const collected: string[] = []
        let cursor: number | undefined
        let pages = 0
        while (pages < 10) {
          pages++
          const res = await localFs.readRecords(key, {
            order: 'forward',
            fromSeq: cursor,
            limit: 2,
          })
          expect(res.ok).toBe(true)
          if (!res.ok) throw new Error('readRecords failed')
          for (const item of res.value.items) {
            collected.push(new TextDecoder().decode(item.data).trim())
          }
          if (res.value.nextSeq === undefined) break
          if (cursor !== undefined) {
            expect(res.value.nextSeq).toBeGreaterThan(cursor)
          }
          cursor = res.value.nextSeq
        }
        expect(pages).toBeLessThanOrEqual(4)
        expect(collected).toEqual([
          '{"i":1}',
          '{"i":2}',
          '{"i":3}',
          '{"i":4}',
          '{"i":5}',
        ])
      } finally {
        await localFs.close()
      }
    })

    test('Memory touch missing -> NotFound, update sync throw & thenable -> Failed/edit, replaceRecords keepBefore/preserveFrom, deleteScope fences', async () => {
      const mem = createMemoryStorageV5Backend({ configHome: '/mem-parity' })
      try {
        // 1. touch on missing key -> NotFound
        const tMissing = await mem.touch({ namespace: 'plan', name: 'absent' })
        expect(tMissing.ok).toBe(false)
        if (!tMissing.ok) expect(tMissing.error.code).toBe('NotFound')

        // 2. update catching sync throw and rejecting thenable
        const updKey = { namespace: 'plan', name: 'upd-err' }
        const syncThrow = await mem.update(updKey, () => {
          throw new Error('sync edit boom')
        })
        expect(syncThrow.ok).toBe(false)
        if (!syncThrow.ok) {
          expect(syncThrow.error.code).toBe('Failed')
          expect(syncThrow.error.argument).toBe('edit')
        }

        const thenableEdit = await mem.update(updKey, (() =>
          Promise.resolve({ write: 'async' })) as unknown as () => {
          write: string
        })
        expect(thenableEdit.ok).toBe(false)
        if (!thenableEdit.ok) {
          expect(thenableEdit.error.code).toBe('Failed')
          expect(thenableEdit.error.argument).toBe('edit')
        }

        // 3. replaceRecords honoring keepBefore & preserveFrom
        const streamKey = {
          namespace: 'transcript',
          projectKey: 'p-rep',
          sessionId: 's-rep',
        }
        await mem.append(streamKey, [
          { data: '{"i":1}' },
          { data: '{"i":2}' },
          { data: '{"i":3}' },
          { data: '{"i":4}' },
          { data: '{"i":5}' },
        ])
        const replaced = await mem.replaceRecords(
          streamKey,
          [{ data: '{"mid":"X"}' }],
          { keepBefore: 2, preserveFrom: 5 },
        )
        expect(replaced.ok).toBe(true)
        const afterReplace = await mem.readRecords(streamKey)
        expect(afterReplace.ok).toBe(true)
        if (afterReplace.ok) {
          expect(
            afterReplace.value.items.map(it =>
              new TextDecoder().decode(it.data),
            ),
          ).toEqual(['{"i":1}', '{"mid":"X"}', '{"i":5}'])
          expect(afterReplace.value.items.map(it => it.seq)).toEqual([1, 2, 3])
        }

        // 4. deleteScope honors DELETE_SCOPE_FENCED_SY fences
        for (const fenced of [
          { namespace: 'globalConfig' },
          { namespace: 'credentials' },
          { namespace: 'bridgeSpawn' },
          { namespace: 'pluginCache', marketplace: 'mp', plugin: 'pl' },
        ]) {
          const del = await mem.deleteScope(fenced)
          expect(del.ok).toBe(false)
          if (!del.ok) expect(del.error.code).toBe('InvalidArgument')
        }
      } finally {
        await mem.close()
      }
    })

    test('HoverRest extractErrorDetails preserves holder, expiresAtMs, and meta on HTTP 409 lease conflict', async () => {
      const expiresAtMs = Date.now() + 30_000
      const hover = createHoverRestBackend({
        baseUrl: 'http://127.0.0.1:8080',
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'AlreadyHeld',
                message: 'lease already held',
                holder: 'other-worker-7',
                expiresAtMs,
                meta: { pid: 4242 },
              },
            }),
            { status: 409 },
          ),
      })
      const res = await hover.acquireLease({ lock: 'shared-lock' }, 10_000)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('AlreadyHeld')
        expect(res.error.holder).toBe('other-worker-7')
        expect(res.error.expiresAtMs).toBe(expiresAtMs)
        expect(res.error.meta).toEqual({ pid: 4242 })
      }
    })
  })

  describe('E4-P1-7 & E4-P2-13: storageLock & storageWatchBus preserve subconversation ALS overlay', () => {
    test('withStorageLock, runSerializedByPath, and StorageWatchBus preserve full session + subconversation ALS', async () => {
      const lockDir = mkdtempSync(join(tmpdir(), 'storagev5-als-lock-'))
      tempDirs.push(lockDir)
      const lockFile = join(lockDir, 'target.json')

      await runWithNewHostSession(
        { id: 'als-lock-sess', cwd: lockDir, originalCwd: lockDir },
        async rootSession => {
          const subOverlay = { sessionId: 'sub-overlay-123' }
          await runWithSubconversationContext(subOverlay, async () => {
            const seenInSerialized = await runSerializedByPath(
              lockFile,
              async () => {
                await new Promise(resolve => setTimeout(resolve, 5))
                return {
                  session: getBootstrapSession(),
                  sub: getActiveSubconversationFromAls(),
                }
              },
            )
            expect(seenInSerialized.session).toBe(rootSession)
            expect(seenInSerialized.sub).toBe(subOverlay)

            const seenInLock = await withStorageLock(
              lockFile,
              async () => {
                await new Promise(resolve => setTimeout(resolve, 5))
                return {
                  ok: true as const,
                  value: {
                    session: getBootstrapSession(),
                    sub: getActiveSubconversationFromAls(),
                  },
                }
              },
              {
                ifReentrant: () => ({ ok: false, error: { code: 'Busy' } }),
                ifContended: () => ({ ok: false, error: { code: 'Busy' } }),
              },
            )
            expect(seenInLock.ok).toBe(true)
            if (seenInLock.ok) {
              expect(seenInLock.value.session).toBe(rootSession)
              expect(seenInLock.value.sub).toBe(subOverlay)
            }

            // StorageWatchBus preserves subconversation overlay when event fires outside ALS
            const bus = new StorageWatchBus({ configHome: lockDir })
            const observed: Array<{ session: unknown; sub: unknown }> = []
            const unsub = bus.addListener(() => {
              observed.push({
                session: getBootstrapSession(),
                sub: getActiveSubconversationFromAls(),
              })
            })
            exitSessionContext(() => {
              bus.emit({ kind: 'updated' }, 'external-instance')
            })
            expect(observed).toHaveLength(1)
            expect(observed[0]?.session).toBe(rootSession)
            expect(observed[0]?.sub).toBe(subOverlay)
            unsub()
          })
        },
      )
    })
  })
})
