/**
 * densable 2.1.283 B9 OTEL / load_test_mode / mantle CLI source-lock.
 *
 * Gold:
 *   OpenTelemetry @80001850 — otelHeadersHelper H3n/$Nr, not a commander flag
 *   OTEL_ @72075592 — bgWorker inherit prefix startsWith("OTEL_"), not CLI apply
 *   load_test_mode @81459988 — Claude apps gateway STRING-ONLY
 *   CLAUDE_CODE_USE_MANTLE @72274120 — env gate already in getAPIProvider
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../../..')
const src = (rel: string) => readFileSync(join(root, rel), 'utf8')

describe('densable 2.1.283 B9 OTEL / load_test / mantle CLI source-lock', () => {
  test('CLI commander does not invent --otel / --load-test / --mantle flags', () => {
    const main = src('src/main.tsx')
    const host = src('src/cli/registerCliHostCommands.ts')
    for (const body of [main, host]) {
      expect(body).not.toContain("--otel")
      expect(body).not.toContain('--load-test')
      expect(body).not.toContain('--mantle')
      expect(body).not.toContain('load_test_mode')
    }
  })

  test('startup apply: initializeTelemetryAfterTrust + otelHeadersHelper $Nr prefetch', () => {
    const init = src('src/entrypoints/init.ts')
    expect(init).toContain('export function initializeTelemetryAfterTrust')
    expect(init).toContain('CLAUDE_CODE_ENABLE_TELEMETRY')

    const instrumentation = src('src/utils/telemetry/instrumentation.ts')
    expect(instrumentation).toContain('function bootstrapTelemetry')
    expect(instrumentation).toContain('prefetchOtelHeadersFromHelper')
    expect(instrumentation).toContain('getOtelHeadersFromHelperAsync')
    expect(instrumentation).toContain("protocol === 'http/json'")
    expect(instrumentation).toContain("protocol === 'http/protobuf'")
    expect(instrumentation).toContain('OTEL_EXPORTER_OTLP_HEADERS')

    const auth = src('src/utils/auth.ts')
    expect(auth).toContain('export function prefetchOtelHeadersFromHelper')
    expect(auth).toContain('export async function getOtelHeadersFromHelperAsync')
    expect(auth).toContain('tengu_otel_headers_helper_failed')
    expect(auth).toContain('otelHeadersHelper did not return a valid value')
    expect(auth).toContain('otelHeadersHelper did not return valid JSON')
    expect(auth).toContain(
      'otelHeadersHelper must return a JSON object with string key-value pairs',
    )
    expect(auth).toContain(
      'Error getting OpenTelemetry headers from otelHeadersHelper (in settings):',
    )
    expect(auth).toContain(
      'otelHeadersHelper failed (OpenTelemetry export headers unavailable):',
    )
    expect(auth).toContain('otelHeadersHelper failure listener threw:')
    expect(auth).toContain('empty_output')
    expect(auth).toContain('invalid_json')
    expect(auth).toContain('not_an_object')
    expect(auth).toContain('non_string_value')
    expect(auth).toContain('spawn_failed')
    expect(auth).toContain('const DEFAULT_OTEL_HEADERS_DEBOUNCE_MS = 1_740_000')
    expect(auth).toContain("getSettingsForSource('policySettings')?.otelHeadersHelper")
  })

  test('OTEL_ bg inherit strip and managed apply already land', () => {
    const bg = src('src/daemon/bgWorker.ts')
    expect(bg).toContain("key.startsWith('OTEL_')")

    const managed = src('src/utils/managedEnv.ts')
    expect(managed).toContain('export function applyManagedOtelEndpointSupremacy')
    expect(managed).toContain('otelHeadersHelper')
  })

  test('mantle is env-gated APIProvider, not a commander option', () => {
    const providers = src('src/utils/model/providers.ts')
    expect(providers).toContain("| 'mantle'")
    expect(providers).toContain('isMantleProviderEnabled()')

    const gates = src('src/utils/residualFinalEnvGates.ts')
    expect(gates).toContain('CLAUDE_CODE_USE_MANTLE')

    const main = src('src/main.tsx')
    expect(main).not.toContain('.option(--mantle')
    expect(main).not.toContain(".option('--mantle")
  })

  test('load_test_mode is not a local CLI gate (gateway STRING-ONLY)', () => {
    const auth = src('src/utils/auth.ts')
    const main = src('src/main.tsx')
    const init = src('src/entrypoints/init.ts')
    for (const body of [auth, main, init]) {
      expect(body).not.toContain('load_test_mode')
      expect(body).not.toContain('msg_loadtest')
    }
  })
})
