/// <reference path="../types.d.ts" />
import { describe, expect, test } from 'bun:test'
import worker from '../index'

type BucketOp =
  | { op: 'put'; key: string; bytes: number }
  | { op: 'delete'; key: string }
  | { op: 'get'; key: string }

class MemoryR2Object {
  readonly version = 'v'
  readonly etag = 'etag'
  readonly httpEtag = '"etag"'
  readonly checksums = {}
  readonly uploaded = new Date(0)
  readonly storageClass = 'Standard'
  readonly bodyUsed = false
  readonly httpMetadata: R2HTTPMetadata = {
    contentType: 'text/html; charset=utf-8',
  }

  constructor(
    readonly key: string,
    readonly buf: ArrayBuffer,
  ) {}

  get size(): number {
    return this.buf.byteLength
  }

  get body(): ReadableStream {
    return new Response(this.buf).body as ReadableStream
  }

  writeHttpMetadata(headers: Headers): void {
    headers.set('content-type', 'text/html; charset=utf-8')
  }
}

class MemoryBucket {
  readonly store = new Map<string, ArrayBuffer>()
  readonly ops: BucketOp[] = []
  putImpl: (key: string, value: ArrayBuffer) => Promise<void> = async (
    key,
    value,
  ) => {
    this.store.set(key, value)
  }

  seed(key: string, html: string): void {
    this.store.set(key, new TextEncoder().encode(html).buffer as ArrayBuffer)
  }

  asBucket(): R2Bucket {
    const self = this
    return {
      async head(key: string) {
        const buf = self.store.get(key)
        return buf ? new MemoryR2Object(key, buf) : null
      },
      async get(key: string) {
        self.ops.push({ op: 'get', key })
        const buf = self.store.get(key)
        return buf ? new MemoryR2Object(key, buf) : null
      },
      async put(
        key: string,
        value: ArrayBuffer | ArrayBufferView | string | null,
      ) {
        let bytes: ArrayBuffer
        if (value instanceof ArrayBuffer) {
          bytes = value
        } else if (ArrayBuffer.isView(value)) {
          bytes = value.buffer.slice(
            value.byteOffset,
            value.byteOffset + value.byteLength,
          ) as ArrayBuffer
        } else if (typeof value === 'string') {
          bytes = new TextEncoder().encode(value).buffer as ArrayBuffer
        } else {
          bytes = new ArrayBuffer(0)
        }
        self.ops.push({ op: 'put', key, bytes: bytes.byteLength })
        await self.putImpl(key, bytes)
        return new MemoryR2Object(key, bytes)
      },
      async delete(keys: string | string[]) {
        const list = Array.isArray(keys) ? keys : [keys]
        for (const key of list) {
          self.ops.push({ op: 'delete', key })
          self.store.delete(key)
        }
      },
    } as R2Bucket
  }
}

function makeEnv(bucket: R2Bucket, overrides: Partial<Env> = {}): Env {
  return {
    BUCKET: bucket,
    TOKEN: 'test-token',
    MAX_BYTES: '10485760',
    DEFAULT_TTL_DAYS: '7',
    PUBLIC_URL: 'https://artifacts.test',
    ...overrides,
  }
}

async function upload(
  env: Env,
  opts: {
    body?: BodyInit | null
    hash?: string
    ttl?: string
    token?: string
    contentType?: string
    path?: string
  } = {},
): Promise<Response> {
  const url = new URL(`https://artifacts.test${opts.path ?? '/upload'}`)
  if (opts.hash !== undefined) url.searchParams.set('hash', opts.hash)
  if (opts.ttl !== undefined) url.searchParams.set('ttl', opts.ttl)
  const headers = new Headers()
  if (opts.contentType !== undefined) {
    headers.set('content-type', opts.contentType)
  } else {
    headers.set('content-type', 'text/html')
  }
  const token = opts.token ?? 'test-token'
  if (token !== '') {
    headers.set('authorization', `Bearer ${token}`)
  }
  const req = new Request(url, {
    method: 'POST',
    headers,
    body: opts.body === undefined ? '<html>ok</html>' : opts.body,
  })
  const fetchFn = worker.fetch
  if (!fetchFn) {
    throw new Error('worker.fetch missing')
  }
  return fetchFn(req, env)
}

async function getHtml(env: Env, path: string): Promise<Response> {
  const fetchFn = worker.fetch
  if (!fetchFn) {
    throw new Error('worker.fetch missing')
  }
  return fetchFn(new Request(`https://artifacts.test${path}`), env)
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

describe('handleUpload overwrite (delete-after-put)', () => {
  test('empty body with ?hash= returns empty_body and does not delete existing object', async () => {
    const mem = new MemoryBucket()
    mem.seed('30d/stable.html', '<html>v1</html>')
    const env = makeEnv(mem.asBucket())

    const res = await upload(env, {
      hash: 'stable',
      ttl: '30',
      body: new ArrayBuffer(0),
    })

    expect(res.status).toBe(400)
    expect(await jsonBody(res)).toEqual({ error: 'empty_body' })
    expect(mem.ops.some(op => op.op === 'delete')).toBe(false)
    expect(mem.ops.some(op => op.op === 'put')).toBe(false)
    const existing = mem.store.get('30d/stable.html')
    expect(existing).toBeDefined()
    expect(new TextDecoder().decode(existing)).toBe('<html>v1</html>')
  })

  test('empty body without hash returns empty_body and does not put', async () => {
    const mem = new MemoryBucket()
    const env = makeEnv(mem.asBucket())

    const res = await upload(env, { body: '' })

    expect(res.status).toBe(400)
    expect(await jsonBody(res)).toEqual({ error: 'empty_body' })
    expect(mem.ops).toEqual([])
    expect(mem.store.size).toBe(0)
  })

  test('cross-TTL overwrite puts new key then deletes the other prefix only', async () => {
    const mem = new MemoryBucket()
    mem.seed('7d/stable.html', '<html>v1-7d</html>')
    const env = makeEnv(mem.asBucket())

    const res = await upload(env, {
      hash: 'stable',
      ttl: '30',
      body: '<html>v2-30d</html>',
    })

    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.id).toBe('stable')
    expect(body.url).toBe('https://artifacts.test/30d/stable.html')

    const kinds = mem.ops.map(op => `${op.op}:${op.key}`)
    expect(kinds[0]).toBe('put:30d/stable.html')
    expect(kinds).toContain('delete:7d/stable.html')
    expect(kinds).not.toContain('delete:30d/stable.html')
    expect(kinds.indexOf('put:30d/stable.html')).toBeLessThan(
      kinds.indexOf('delete:7d/stable.html'),
    )
    expect(new TextDecoder().decode(mem.store.get('30d/stable.html'))).toBe(
      '<html>v2-30d</html>',
    )
    expect(mem.store.has('7d/stable.html')).toBe(false)
  })

  test('same-TTL overwrite is in-place PUT (no self-delete; other prefix cleaned)', async () => {
    const mem = new MemoryBucket()
    mem.seed('30d/stable.html', '<html>v1</html>')
    const env = makeEnv(mem.asBucket())

    const res = await upload(env, {
      hash: 'stable',
      ttl: '30',
      body: '<html>v2</html>',
    })

    expect(res.status).toBe(200)
    const kinds = mem.ops.map(op => `${op.op}:${op.key}`)
    expect(kinds[0]).toBe('put:30d/stable.html')
    expect(kinds).toContain('delete:7d/stable.html')
    expect(kinds).not.toContain('delete:30d/stable.html')
    expect(new TextDecoder().decode(mem.store.get('30d/stable.html'))).toBe(
      '<html>v2</html>',
    )
  })

  test('put failure does not delete the other TTL object', async () => {
    const mem = new MemoryBucket()
    mem.seed('7d/stable.html', '<html>v1</html>')
    mem.putImpl = async () => {
      throw new Error('r2 put failed')
    }
    const env = makeEnv(mem.asBucket())

    await expect(
      upload(env, {
        hash: 'stable',
        ttl: '30',
        body: '<html>v2</html>',
      }),
    ).rejects.toThrow('r2 put failed')

    expect(mem.ops.some(op => op.op === 'delete')).toBe(false)
    expect(mem.store.has('7d/stable.html')).toBe(true)
    expect(new TextDecoder().decode(mem.store.get('7d/stable.html'))).toBe(
      '<html>v1</html>',
    )
  })

  test('GET still serves prior object after rejected empty overwrite', async () => {
    const mem = new MemoryBucket()
    mem.seed('30d/stable.html', '<html>v1</html>')
    const env = makeEnv(mem.asBucket())

    const rejected = await upload(env, {
      hash: 'stable',
      ttl: '30',
      body: new ArrayBuffer(0),
    })
    expect(rejected.status).toBe(400)

    const got = await getHtml(env, '/30d/stable.html')
    expect(got.status).toBe(200)
    expect(await got.text()).toBe('<html>v1</html>')
  })
})

describe('handleUpload validation still holds', () => {
  test('invalid hash is 400 before any R2 op', async () => {
    const mem = new MemoryBucket()
    const env = makeEnv(mem.asBucket())
    const res = await upload(env, { hash: 'bad/slash', body: '<html>x</html>' })
    expect(res.status).toBe(400)
    expect(await jsonBody(res)).toEqual({ error: 'invalid_hash' })
    expect(mem.ops).toEqual([])
  })

  test('unauthorized is 401 with no R2 op', async () => {
    const mem = new MemoryBucket()
    const env = makeEnv(mem.asBucket())
    const res = await upload(env, { token: 'nope' })
    expect(res.status).toBe(401)
    expect(await jsonBody(res)).toEqual({ error: 'unauthorized' })
    expect(mem.ops).toEqual([])
  })
})
