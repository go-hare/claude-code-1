import { type ExportResult, ExportResultCode } from '@opentelemetry/core'
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from '@opentelemetry/sdk-logs'
import { logForDebugging } from '../../utils/debug.js'

/** densable 2.1.248 xP */
export const ANTHROPIC_TELEMETRY_LOG_PREFIX = '[Anthropic telemetry]'

/**
 * densable 2.1.248 Oht — first 1P/Anthropic export failure at debug; later
 * failures are counted and summarised on forceFlush/shutdown.
 */
export class AnthropicTelemetryExportCounter {
  pipeline: string
  count = 0
  reportedCount = 0
  last: string | undefined

  constructor(pipeline: string) {
    this.pipeline = pipeline
  }

  record(error: string): void {
    this.count++
    this.last = error
    if (this.count === 1) {
      logForDebugging(
        `${ANTHROPIC_TELEMETRY_LOG_PREFIX} ${this.pipeline} export failed (${error}). This is Anthropic's own telemetry pipeline, not your OTel collector; further failures are counted and summarised at shutdown.`,
      )
    }
  }

  logSummary(): void {
    if (this.count === this.reportedCount) {
      return
    }
    this.reportedCount = this.count
    logForDebugging(
      `${ANTHROPIC_TELEMETRY_LOG_PREFIX} ${this.pipeline} export: ${this.count} failure(s) this session (last: ${this.last})`,
    )
  }
}

/**
 * densable 2.1.248 QO — wrap exporter: on export fail record then callback
 * SUCCESS so OTEL diag does not report Anthropic's pipeline as [3P telemetry].
 */
export function wrapAnthropicTelemetryExporter(
  exporter: LogRecordExporter,
  counter: AnthropicTelemetryExportCounter,
): LogRecordExporter {
  const originalExport = exporter.export.bind(exporter)
  const originalForceFlush = exporter.forceFlush?.bind(exporter)
  const originalShutdown = exporter.shutdown.bind(exporter)

  exporter.export = (
    logs: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void,
  ): void => {
    originalExport(logs, result => {
      if (result.code !== ExportResultCode.SUCCESS) {
        counter.record(result.error?.message ?? 'unknown error')
      }
      resultCallback({ code: ExportResultCode.SUCCESS })
    })
  }

  if (originalForceFlush) {
    exporter.forceFlush = async (): Promise<void> => {
      await originalForceFlush()
      counter.logSummary()
    }
  }

  exporter.shutdown = async (): Promise<void> => {
    await originalShutdown()
    counter.logSummary()
  }

  return exporter
}
