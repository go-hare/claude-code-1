import { afterEach, describe, expect, test } from 'bun:test'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import {
  addLLMRequestAttemptEvent,
  endInteractionSpan,
  endLLMRequestSpan,
  endToolExecutionSpan,
  startInteractionSpan,
  startLLMRequestSpan,
  startToolExecutionSpan,
} from '../sessionTracing.js'

describe('sessionTracing 1:1 SEA alignment (#780)', () => {
  const prevEnv = {
    ENABLE_ENHANCED_TELEMETRY_BETA: process.env.ENABLE_ENHANCED_TELEMETRY_BETA,
    OTEL_TRACES_EXPORTER: process.env.OTEL_TRACES_EXPORTER,
  }

  afterEach(() => {
    endInteractionSpan()
    if (prevEnv.ENABLE_ENHANCED_TELEMETRY_BETA === undefined) {
      delete process.env.ENABLE_ENHANCED_TELEMETRY_BETA
    } else {
      process.env.ENABLE_ENHANCED_TELEMETRY_BETA =
        prevEnv.ENABLE_ENHANCED_TELEMETRY_BETA
    }
    if (prevEnv.OTEL_TRACES_EXPORTER === undefined) {
      delete process.env.OTEL_TRACES_EXPORTER
    } else {
      process.env.OTEL_TRACES_EXPORTER = prevEnv.OTEL_TRACES_EXPORTER
    }
  })

  test('interaction, LLM request, attempt event, and tool execution spans emit 1:1 attributes, links, and error status', () => {
    process.env.ENABLE_ENHANCED_TELEMETRY_BETA = '1'
    process.env.OTEL_TRACES_EXPORTER = 'console'

    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    trace.setGlobalTracerProvider(provider)

    const parentTp = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    const linkedTp = '00-11111111111111111111111111111111-2222222222222222-01'

    startInteractionSpan('hello', {
      parent: { traceparent: parentTp },
      linked: [{ traceparent: linkedTp }],
    })

    const llmSpan = startLLMRequestSpan('claude-sonnet-4-6')
    addLLMRequestAttemptEvent(llmSpan, {
      attempt: 1,
      clientRequestId: 'creq_123',
    })
    endLLMRequestSpan(llmSpan, {
      success: false,
      error: 'rate limited',
      errorClass: 'RateLimitError!',
      attempt: 1,
      clientRequestId: 'creq_123',
      firstContentMs: 42,
      effort: 'high',
      traceresponse: linkedTp,
    })

    startToolExecutionSpan()
    endToolExecutionSpan({
      success: false,
      error: 'boom',
      errorClass: 'ExecError',
    })

    endInteractionSpan()

    const spans = exporter.getFinishedSpans()
    const llm = spans.find(s => s.name === 'claude_code.llm_request')
    const toolExec = spans.find(s => s.name === 'claude_code.tool.execution')
    const interaction = spans.find(s => s.name === 'claude_code.interaction')

    expect(interaction?.attributes['gen_ai.operation.name']).toBe(
      'invoke_agent',
    )
    expect(interaction?.attributes['parent.source']).toBe('event')
    expect(interaction?.attributes['queued_sends']).toBe(1)
    expect(interaction?.links).toHaveLength(1)
    expect(interaction?.links[0]?.attributes?.['link.type']).toBe('queued_send')

    expect(llm?.events).toHaveLength(1)
    expect(llm?.events[0]?.name).toBe('gen_ai.request.attempt')
    expect(llm?.events[0]?.attributes?.['client_request_id']).toBe('creq_123')
    expect(llm?.attributes['error_class']).toBe('RateLimitError_')
    expect(llm?.attributes['first_content_ms']).toBe(42)
    expect(llm?.attributes['effort']).toBe('high')
    expect(llm?.status.code).toBe(SpanStatusCode.ERROR)
    expect(llm?.links).toHaveLength(1)
    expect(llm?.links[0]?.attributes?.['link.type']).toBe('parent_of')

    expect(toolExec?.attributes['error_class']).toBe('ExecError')
    expect(toolExec?.attributes['error.type']).toBe('tool_error')
    expect(toolExec?.status.code).toBe(SpanStatusCode.ERROR)

    trace.disable()
  })
})
