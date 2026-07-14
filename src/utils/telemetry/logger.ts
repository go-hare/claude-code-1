import type { DiagLogger } from '@opentelemetry/api'
import { logForDebugging } from '../debug.js'
import { logError } from '../log.js'
import { isOtelDiagStderrEnabled } from '../residualFinalEnvGates.js'

const OTEL_DIAG_PREFIX = '[3P telemetry] OTEL diag'

/**
 * Official lns — OTEL diag logger. Errors always go to logError + debug;
 * when CLAUDE_CODE_OTEL_DIAG_STDERR is set, also write errors to stderr
 * (enterprise OTEL diagnostics without full debug log).
 */
export class ClaudeCodeDiagLogger implements DiagLogger {
  error(message: string, ..._: unknown[]) {
    if (isOtelDiagStderrEnabled()) {
      process.stderr.write(`${OTEL_DIAG_PREFIX} error: ${message}.`)
    }
    logError(new Error(message))
    logForDebugging(`${OTEL_DIAG_PREFIX} error: ${message}`, {
      level: 'error',
    })
  }
  warn(message: string, ..._: unknown[]) {
    logError(new Error(message))
    logForDebugging(`${OTEL_DIAG_PREFIX} warn: ${message}`, {
      level: 'warn',
    })
  }
  info(_message: string, ..._args: unknown[]) {
    return
  }
  debug(_message: string, ..._args: unknown[]) {
    return
  }
  verbose(_message: string, ..._args: unknown[]) {
    return
  }
}
