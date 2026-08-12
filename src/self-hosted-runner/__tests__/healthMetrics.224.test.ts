/**
 * densable 2.1.224 #1 — health HTTP (hFh) + Prometheus (tqv/rqv).
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { connect as netConnect } from 'node:net'
import {
  METRICS_PREFIX,
  POLL_ERROR_KINDS,
  SESSION_INIT_DURATION_BOUNDS,
  classifyPollError,
  createRunnerHealthState,
  emptyPollErrors,
  ingestChildOtlpMetrics,
  observeInitDuration,
  promEscapeLabel,
  renderPrometheusMetrics,
  sanitizeMetricName,
  startHealthServer,
} from '../healthMetrics.js'

/**
 * Direct TCP HTTP (bypasses Bun HTTP_PROXY injection on node:http).
 */
function localRequest(
  port: number,
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body ?? ''
    const headers = [
      `${method} ${path} HTTP/1.1`,
      'Host: 127.0.0.1',
      'Connection: close',
    ]
    if (body !== undefined) {
      headers.push('Content-Type: application/json')
      headers.push(`Content-Length: ${Buffer.byteLength(payload)}`)
    }
    const req = `${headers.join('\r\n')}\r\n\r\n${payload}`
    const sock = netConnect({ host: '127.0.0.1', port, family: 4 }, () => {
      sock.write(req)
    })
    let data = ''
    sock.setEncoding('utf8')
    sock.on('data', chunk => {
      data += chunk
    })
    sock.on('end', () => {
      const sep = data.indexOf('\r\n\r\n')
      const head = sep >= 0 ? data.slice(0, sep) : data
      const bodyText = sep >= 0 ? data.slice(sep + 4) : ''
      const statusLine = head.split('\r\n')[0] ?? ''
      const m = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/)
      resolve({ status: m ? Number(m[1]) : 0, body: bodyText })
    })
    sock.on('error', reject)
  })
}

describe('densable 2.1.224 #1 healthMetrics helpers', () => {
  test('constants (pFh/HUi/bKn)', () => {
    expect(METRICS_PREFIX).toBe('claude_code_self_hosted_runner')
    expect(POLL_ERROR_KINDS).toEqual([
      'transport',
      'timeout',
      '5xx',
      '429',
      '4xx',
    ])
    expect(SESSION_INIT_DURATION_BOUNDS).toContain(1)
    expect(SESSION_INIT_DURATION_BOUNDS).toContain(1280)
  })

  test('promEscapeLabel (wme) / sanitizeMetricName (aFh)', () => {
    expect(promEscapeLabel('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd')
    expect(sanitizeMetricName('foo.bar-baz')).toBe('foo_bar_baz')
    expect(sanitizeMetricName('9bad')).toBe('_9bad')
  })

  test('classifyPollError (yKn)', () => {
    expect(classifyPollError({ httpStatus: 429 })).toBe('429')
    expect(classifyPollError({ httpStatus: 503 })).toBe('5xx')
    expect(classifyPollError({ httpStatus: 400 })).toBe('4xx')
    expect(classifyPollError({ code: 'ETIMEDOUT' })).toBe('timeout')
    expect(classifyPollError(new Error('boom'))).toBe('transport')
  })

  test('observeInitDuration (dFh) histogram', () => {
    const state = createRunnerHealthState({
      runnerId: 'r1',
      version: '2.1.224',
      clientLabel: 'host',
      capacity: 2,
    })
    observeInitDuration(state.sessionInitDurations, 3)
    expect(state.sessionInitDurations.count).toBe(1)
    expect(state.sessionInitDurations.sum).toBe(3)
    // 3s falls into buckets with le>=5 (index of 5 is 2)
    const idx5 = SESSION_INIT_DURATION_BOUNDS.indexOf(5)
    expect(state.sessionInitDurations.buckets[idx5]).toBe(1)
    expect(state.sessionInitDurations.buckets[0]).toBe(0) // le=1
  })

  test('renderPrometheusMetrics (tqv) includes all poll error kinds', () => {
    const state = createRunnerHealthState({
      runnerId: 'r1',
      version: '2.1.224',
      clientLabel: 'host',
      capacity: 1,
    })
    state.lastPollAt = Date.now() - 1500
    state.sessionsStarted.set('web', 2)
    state.pollErrors['5xx'] = 3
    const text = renderPrometheusMetrics(state, Date.now())
    expect(text).toContain(`${METRICS_PREFIX}_info{`)
    expect(text).toContain(`${METRICS_PREFIX}_capacity 1`)
    expect(text).toContain(
      `${METRICS_PREFIX}_sessions_started_total{client_platform="web"} 2`,
    )
    for (const k of POLL_ERROR_KINDS) {
      expect(text).toContain(`error_kind="${k}"`)
    }
    expect(text).toContain(
      `${METRICS_PREFIX}_poll_errors_total{error_kind="5xx"} 3`,
    )
    expect(emptyPollErrors().transport).toBe(0)
  })

  test('ingestChildOtlpMetrics (rqv) counters', () => {
    const state = createRunnerHealthState({
      runnerId: 'r1',
      version: '1',
      clientLabel: 'h',
      capacity: 1,
    })
    ingestChildOtlpMetrics(state, {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              { key: 'session.id', value: { stringValue: 's1' } },
              { key: 'client.platform', value: { stringValue: 'cli' } },
            ],
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'turns_total',
                  description: 'turns',
                  sum: {
                    isMonotonic: true,
                    dataPoints: [
                      {
                        asDouble: 4,
                        attributes: [
                          { key: 'model', value: { stringValue: 'opus' } },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    })
    expect(state.childMetrics?.has('turns_total')).toBe(true)
    const series = state.childMetrics!.get('turns_total')!
    expect(series.type).toBe('counter')
    const vals = [...series.points.values()]
    expect(vals).toContain(4)
  })
})

describe('densable 2.1.224 #1 health HTTP server (hFh)', () => {
  const state = createRunnerHealthState({
    runnerId: 'runner-xyz',
    version: '2.1.224',
    clientLabel: 'test-host',
    capacity: 3,
  })
  state.lastPollAt = Date.now()
  state.activeSessions = 1
  const server = startHealthServer(0, state, () => {})
  const port = (): number => {
    const addr = server.address()
    if (typeof addr === 'object' && addr) return addr.port
    throw new Error('no port')
  }

  afterAll(() => {
    server.close()
  })

  test('GET /healthz', async () => {
    await new Promise<void>(r => {
      if (server.listening) r()
      else server.once('listening', () => r())
    })
    const res = await localRequest(port(), 'GET', '/healthz')
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body) as { status: string; runner_id: string }
    expect(body.status).toBe('ok')
    expect(body.runner_id).toBe('runner-xyz')
  })

  test('GET /metrics', async () => {
    await new Promise<void>(r => {
      if (server.listening) r()
      else server.once('listening', () => r())
    })
    const res = await localRequest(port(), 'GET', '/metrics')
    expect(res.status).toBe(200)
    expect(res.body).toContain('claude_code_self_hosted_runner_capacity 3')
  })

  test('POST /v1/metrics loopback only body', async () => {
    await new Promise<void>(r => {
      if (server.listening) r()
      else server.once('listening', () => r())
    })
    const res = await localRequest(
      port(),
      'POST',
      '/v1/metrics',
      JSON.stringify({ resourceMetrics: [] }),
    )
    expect(res.status).toBe(200)
  })
})
