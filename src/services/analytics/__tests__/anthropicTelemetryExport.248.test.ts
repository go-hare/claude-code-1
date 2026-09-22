/**
 * densable 2.1.248 #47 — Oht/QO Anthropic telemetry export failures at debug.
 * Gold: gold-248-na-47-Oht.txt / gold-248-na-47-QO.txt sha=d5637050d60c2311
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { type ExportResult, ExportResultCode } from '@opentelemetry/core'
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from '@opentelemetry/sdk-logs'
import { debugMock } from '../../../../tests/mocks/debug.js'

const logForDebugging = mock((_message: string) => {})

mock.module('src/utils/debug.ts', () => ({
  ...debugMock(),
  logForDebugging,
}))

import {
  ANTHROPIC_TELEMETRY_LOG_PREFIX,
  AnthropicTelemetryExportCounter,
  wrapAnthropicTelemetryExporter,
} from '../anthropicTelemetryExport.js'

const FIRST_FAIL = `${ANTHROPIC_TELEMETRY_LOG_PREFIX} 1P event logging export failed (boom). This is Anthropic's own telemetry pipeline, not your OTel collector; further failures are counted and summarised at shutdown.`

function messages(): string[] {
  return logForDebugging.mock.calls.map(call => String(call[0]))
}

function fakeExporter(options?: {
  result?: ExportResult
  forceFlush?: boolean
}): LogRecordExporter & {
  exportCalls: number
  flushCalls: number
  shutdownCalls: number
} {
  const exporter = {
    exportCalls: 0,
    flushCalls: 0,
    shutdownCalls: 0,
    export(
      _logs: ReadableLogRecord[],
      resultCallback: (result: ExportResult) => void,
    ): void {
      exporter.exportCalls++
      resultCallback(options?.result ?? { code: ExportResultCode.SUCCESS })
    },
    async shutdown(): Promise<void> {
      exporter.shutdownCalls++
    },
  } as LogRecordExporter & {
    exportCalls: number
    flushCalls: number
    shutdownCalls: number
  }
  // Match official QO: only wrap forceFlush when the inner exporter has one.
  if (options?.forceFlush !== false) {
    exporter.forceFlush = async (): Promise<void> => {
      exporter.flushCalls++
    }
  }
  return exporter
}

afterEach(() => {
  logForDebugging.mockClear()
})

describe('densable 2.1.248 #47 Oht AnthropicTelemetryExportCounter', () => {
  test('first record logs debug prefix; later records are counted only', () => {
    const counter = new AnthropicTelemetryExportCounter('1P event logging')
    counter.record('boom')
    counter.record('later')
    expect(counter.count).toBe(2)
    expect(counter.last).toBe('later')
    expect(messages()).toEqual([FIRST_FAIL])
  })

  test('logSummary reports new failures then no-ops until count changes', () => {
    const counter = new AnthropicTelemetryExportCounter('1P event logging')
    counter.logSummary()
    expect(messages()).toEqual([])
    counter.record('a')
    counter.logSummary()
    expect(messages()).toEqual([
      `${ANTHROPIC_TELEMETRY_LOG_PREFIX} 1P event logging export failed (a). This is Anthropic's own telemetry pipeline, not your OTel collector; further failures are counted and summarised at shutdown.`,
      `${ANTHROPIC_TELEMETRY_LOG_PREFIX} 1P event logging export: 1 failure(s) this session (last: a)`,
    ])
    logForDebugging.mockClear()
    counter.logSummary()
    expect(messages()).toEqual([])
    counter.record('b')
    counter.logSummary()
    expect(messages()[0]).toContain('2 failure(s) this session')
  })
})

describe('densable 2.1.248 #47 QO wrapAnthropicTelemetryExporter', () => {
  test('export fail records then callbacks SUCCESS', () => {
    const counter = new AnthropicTelemetryExportCounter('1P event logging')
    const wrapped = wrapAnthropicTelemetryExporter(
      fakeExporter({
        result: {
          code: ExportResultCode.FAILED,
          error: new Error('boom'),
        },
      }),
      counter,
    )
    let cb: ExportResult | undefined
    wrapped.export([], result => {
      cb = result
    })
    expect(cb).toEqual({ code: ExportResultCode.SUCCESS })
    expect(counter.count).toBe(1)
    expect(counter.last).toBe('boom')
  })

  test('export fail without error records unknown error', () => {
    const counter = new AnthropicTelemetryExportCounter('1P event logging')
    const wrapped = wrapAnthropicTelemetryExporter(
      fakeExporter({ result: { code: ExportResultCode.FAILED } }),
      counter,
    )
    wrapped.export([], () => {})
    expect(counter.last).toBe('unknown error')
  })

  test('export SUCCESS does not record', () => {
    const counter = new AnthropicTelemetryExportCounter('1P event logging')
    const wrapped = wrapAnthropicTelemetryExporter(fakeExporter(), counter)
    wrapped.export([], () => {})
    expect(counter.count).toBe(0)
  })

  test('forceFlush and shutdown call logSummary', async () => {
    const counter = new AnthropicTelemetryExportCounter('1P event logging')
    counter.record('x')
    logForDebugging.mockClear()
    const inner = fakeExporter()
    const wrapped = wrapAnthropicTelemetryExporter(inner, counter)
    await wrapped.forceFlush?.()
    expect(inner.flushCalls).toBe(1)
    expect(messages().some(m => m.includes('1 failure(s) this session'))).toBe(
      true,
    )
    logForDebugging.mockClear()
    counter.record('y')
    await wrapped.shutdown()
    expect(inner.shutdownCalls).toBe(1)
    expect(messages().some(m => m.includes('2 failure(s) this session'))).toBe(
      true,
    )
  })

  test('does not invent forceFlush when the exporter has none', async () => {
    const counter = new AnthropicTelemetryExportCounter('1P event logging')
    const wrapped = wrapAnthropicTelemetryExporter(
      fakeExporter({ forceFlush: false }),
      counter,
    )
    expect(wrapped.forceFlush).toBeUndefined()
    await wrapped.shutdown()
  })
})

describe('densable 2.1.248 #47 landing wiring', () => {
  test('1P logger wraps exporter with Oht("1P event logging")', () => {
    const src = readFileSync(
      join(import.meta.dir, '../firstPartyEventLogger.ts'),
      'utf8',
    )
    expect(src).toContain('wrapAnthropicTelemetryExporter')
    expect(src).toContain('new AnthropicTelemetryExportCounter')
    expect(src).toContain('1P event logging')
  })

  test('3P OTEL diag prefix is unchanged', () => {
    expect(ANTHROPIC_TELEMETRY_LOG_PREFIX).toContain('Anthropic')
  })
})
