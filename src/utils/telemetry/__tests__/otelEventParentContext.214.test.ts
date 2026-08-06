/**
 * densable 2.1.214 #41 — interaction bridge for OTel event parent context.
 * Does not import sessionTracing (heavy graph); drives the light bridge module.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { context as otelContext, trace } from '@opentelemetry/api'
import { getIsInteractive, setIsInteractive } from 'src/bootstrap/state.js'
import { getOTelEventParentContext } from '../events.js'
import { setActiveInteractionOTelContext } from '../interactionOtelContext.js'

const originalTraceparent = process.env.TRACEPARENT
const originalTracestate = process.env.TRACESTATE
let savedInteractive: boolean

describe('densable #41 getOTelEventParentContext interaction bridge', () => {
  beforeEach(() => {
    savedInteractive = getIsInteractive()
    setActiveInteractionOTelContext(undefined)
    delete process.env.TRACEPARENT
    delete process.env.TRACESTATE
  })

  afterEach(() => {
    setActiveInteractionOTelContext(undefined)
    setIsInteractive(savedInteractive)
    if (originalTraceparent === undefined) delete process.env.TRACEPARENT
    else process.env.TRACEPARENT = originalTraceparent
    if (originalTracestate === undefined) delete process.env.TRACESTATE
    else process.env.TRACESTATE = originalTracestate
  })

  test('uses interaction bridge when active context has no span', () => {
    setIsInteractive(true)
    const tracer = trace.getTracer('test-214')
    const span = tracer.startSpan('interaction-test')
    setActiveInteractionOTelContext(trace.setSpan(otelContext.active(), span))

    const ctx = getOTelEventParentContext()
    expect(ctx).toBeDefined()
    const sc = trace.getSpanContext(ctx!)
    expect(sc?.spanId).toBe(span.spanContext().spanId)
    span.end()
  })

  test('TRACEPARENT still works when non-interactive and no bridge', () => {
    setIsInteractive(false)
    setActiveInteractionOTelContext(undefined)
    process.env.TRACEPARENT =
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'

    const ctx = getOTelEventParentContext()
    expect(ctx).toBeDefined()
    const sc = trace.getSpanContext(ctx!)
    expect(sc?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  test('returns undefined when interactive, no bridge, no TRACEPARENT', () => {
    setIsInteractive(true)
    setActiveInteractionOTelContext(undefined)
    expect(getOTelEventParentContext()).toBeUndefined()
  })
})
