/**
 * densable 2.1.212 #31 — YAo/Lvd Content-Length on OTLP HTTP agents.
 * Pure unit tests — no mock.module (avoid process-global pollution).
 */
import { describe, expect, test } from 'bun:test'
import http from 'http'
import {
  isLocalhostOtelEndpoint,
  toOtlpBodyChunk,
  wrapAgentWithContentLength,
} from '../otlpHttpAgent.js'

describe('densable #31 Lvd toOtlpBodyChunk', () => {
  test('Buffer passthrough', () => {
    const b = Buffer.from('abc')
    expect(toOtlpBodyChunk(b)).toBe(b)
  })
  test('string + encoding', () => {
    expect(toOtlpBodyChunk('hi', 'utf8').toString()).toBe('hi')
  })
  test('Uint8Array', () => {
    expect(toOtlpBodyChunk(new Uint8Array([1, 2, 3]))).toEqual(
      Buffer.from([1, 2, 3]),
    )
  })
  test('rejects other types', () => {
    expect(() => toOtlpBodyChunk(42)).toThrow(/OTLP request body chunk/)
  })
})

describe('densable #31 d1y isLocalhostOtelEndpoint', () => {
  test('localhost / 127 / ::1', () => {
    expect(isLocalhostOtelEndpoint('http://localhost:4318')).toBe(true)
    expect(isLocalhostOtelEndpoint('http://127.0.0.1:4318')).toBe(true)
    expect(isLocalhostOtelEndpoint('http://[::1]:4318')).toBe(true)
    expect(isLocalhostOtelEndpoint('https://otel.example.com')).toBe(false)
    expect(isLocalhostOtelEndpoint(undefined)).toBe(false)
  })
})

describe('densable #31 YAo wrapAgentWithContentLength', () => {
  test('buffers piped body and sets Content-Length before end', async () => {
    const agent = wrapAgentWithContentLength(
      new http.Agent({ keepAlive: false, maxSockets: 1 }),
    )

    const server = http.createServer((req, res) => {
      const cl = req.headers['content-length']
      const te = req.headers['transfer-encoding']
      const chunks: Buffer[] = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(
          JSON.stringify({
            contentLength: cl ?? null,
            transferEncoding: te ?? null,
            bodyLen: Buffer.concat(chunks).length,
          }),
        )
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }

    try {
      const body = Buffer.from('{"resourceSpans":[]}')
      const result = await new Promise<{
        contentLength: string | null
        transferEncoding: string | null
        bodyLen: number
      }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/v1/traces',
            method: 'POST',
            agent,
            headers: {
              'Content-Type': 'application/json',
            },
          },
          res => {
            const chunks: Buffer[] = []
            res.on('data', c => chunks.push(c))
            res.on('end', () => {
              resolve(JSON.parse(Buffer.concat(chunks).toString()))
            })
          },
        )
        req.on('error', reject)
        req.write(body)
        req.end()
      })

      expect(result.contentLength).toBe(String(body.byteLength))
      expect(result.transferEncoding).toBeNull()
      expect(result.bodyLen).toBe(body.byteLength)
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve())),
      )
      agent.destroy()
    }
  })
})
