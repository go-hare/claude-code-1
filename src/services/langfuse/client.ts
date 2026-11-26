import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import type { MaskFunction } from '@langfuse/otel'
import { setLangfuseTracerProvider } from '@langfuse/tracing'
import { sanitizeGlobal } from './sanitize.js'
import { logForDebugging } from 'src/utils/debug.js'
import { getActiveSessionFromAls } from 'src/utils/sessionRoot.js'

declare const MACRO: { VERSION: string }

// Process-global singleton matching @langfuse/tracing's single global
// setLangfuseTracerProvider(), so boot initLangfuse() is visible to all
// isolated hosts (flushLangfuse() works everywhere) and sibling hosts cannot
// clobber the global tracer provider with a shut-down dead provider.
const langfuseGlobalState: {
  processor: LangfuseSpanProcessor | null
  provider: BasicTracerProvider | null
} = {
  processor: null,
  provider: null,
}

export function isLangfuseEnabled(): boolean {
  return !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY)
}

export function getLangfuseProcessor(): LangfuseSpanProcessor | null {
  return langfuseGlobalState.processor
}

export function initLangfuse(): boolean {
  if (langfuseGlobalState.processor !== null) return true
  if (!isLangfuseEnabled()) {
    logForDebugging('[langfuse] No keys configured, running in no-op mode')
    return false
  }

  try {
    const maskFn: MaskFunction = ({ data }) => sanitizeGlobal(data)

    langfuseGlobalState.processor = new LangfuseSpanProcessor({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
      flushAt: parseInt(process.env.LANGFUSE_FLUSH_AT ?? '20', 10),
      flushInterval: parseInt(process.env.LANGFUSE_FLUSH_INTERVAL ?? '10', 10),
      mask: maskFn,
      environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? 'development',
      release: typeof MACRO !== 'undefined' ? MACRO.VERSION : undefined,
      exportMode:
        (process.env.LANGFUSE_EXPORT_MODE as
          | 'batched'
          | 'immediate'
          | undefined) ?? 'batched',
      timeout: parseInt(process.env.LANGFUSE_TIMEOUT ?? '5', 10),
    })

    langfuseGlobalState.provider = new BasicTracerProvider({
      spanProcessors: [langfuseGlobalState.processor],
    })

    setLangfuseTracerProvider(langfuseGlobalState.provider)

    logForDebugging('[langfuse] Initialized with LangfuseSpanProcessor')
    return true
  } catch (e) {
    logForDebugging(`[langfuse] Init failed: ${e}`, { level: 'error' })
    langfuseGlobalState.processor = null
    langfuseGlobalState.provider = null
    return false
  }
}

export async function flushLangfuse(): Promise<void> {
  try {
    if (langfuseGlobalState.processor) {
      await langfuseGlobalState.processor.forceFlush()
    }
  } catch (e) {
    logForDebugging(`[langfuse] Flush error: ${e}`, { level: 'error' })
  }
}

export async function shutdownLangfuse(): Promise<void> {
  try {
    if (getActiveSessionFromAls() !== undefined) {
      // Isolated host teardown: flush pending spans without tearing down the
      // process-global tracer provider shared with sibling hosts.
      if (langfuseGlobalState.processor) {
        await langfuseGlobalState.processor.forceFlush()
      }
      return
    }
    if (langfuseGlobalState.processor) {
      await langfuseGlobalState.processor.forceFlush()
      await langfuseGlobalState.processor.shutdown()
    }
    langfuseGlobalState.processor = null
    langfuseGlobalState.provider = null
    logForDebugging('[langfuse] Shutdown complete')
  } catch (e) {
    logForDebugging(`[langfuse] Shutdown error: ${e}`, { level: 'error' })
  }
}
