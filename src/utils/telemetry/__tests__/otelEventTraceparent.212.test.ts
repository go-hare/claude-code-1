/**
 * densable 2.1.212 #32 — PKh TRACEPARENT → log record context.
 * Uses real setIsInteractive (no mock.module of bootstrap/state).
 *
 * Note: without a registered OTEL ContextManager, context.with() does not
 * propagate — the active-span branch is covered in densable by production
 * AsyncLocalStorage manager; here we assert the TRACEPARENT extract path
 * that fixes SDK/headless missing trace_id/span_id.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { trace } from '@opentelemetry/api'
import { getIsInteractive, setIsInteractive } from 'src/bootstrap/state.js'
import { getOTelEventParentContext } from '../events.js'

const originalTraceparent = process.env.TRACEPARENT
const originalTracestate = process.env.TRACESTATE
let savedInteractive: boolean

describe('densable #32 getOTelEventParentContext (PKh)', () => {
  beforeEach(() => {
    savedInteractive = getIsInteractive()
  })

  afterEach(() => {
    setIsInteractive(savedInteractive)
    if (originalTraceparent === undefined) delete process.env.TRACEPARENT
    else process.env.TRACEPARENT = originalTraceparent
    if (originalTracestate === undefined) delete process.env.TRACESTATE
    else process.env.TRACESTATE = originalTracestate
  })

  test('extracts TRACEPARENT when non-interactive and no active span', () => {
    setIsInteractive(false)
    process.env.TRACEPARENT =
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    process.env.TRACESTATE = 'rojo=00f067aa0ba902b7'

    const ctx = getOTelEventParentContext()
    expect(ctx).toBeDefined()
    const sc = trace.getSpanContext(ctx!)
    expect(sc?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(sc?.spanId).toBe('00f067aa0ba902b7')
  })

  test('returns undefined when interactive even if TRACEPARENT set', () => {
    setIsInteractive(true)
    process.env.TRACEPARENT =
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    const ctx = getOTelEventParentContext()
    // densable requires dn() (!isInteractive)
    expect(ctx).toBeUndefined()
  })

  test('returns undefined when TRACEPARENT unset', () => {
    setIsInteractive(false)
    delete process.env.TRACEPARENT
    delete process.env.TRACESTATE
    expect(getOTelEventParentContext()).toBeUndefined()
  })
})
