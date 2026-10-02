import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { MOCK_AGENT_FAILED } from '../pluginEval/agentMock.js'
import {
  logEvalArtifactPublish,
  logEvalMocks,
} from '../pluginEval/evalAnalytics.js'

const src = readFileSync(
  join(import.meta.dir, '../pluginEval/evalAnalytics.ts'),
  'utf8',
)

describe('plugin eval ag/cg densable 2.1.283', () => {
  test('source-locks gold event names and skip arms', () => {
    expect(src).toContain("logNamed('cli_plugin_eval_artifact_publish')")
    expect(src).toContain(
      "logNamed('cli_plugin_eval_artifact_publish', 'run_errored')",
    )
    expect(src).toContain(
      "logNamed('cli_plugin_eval_artifact_publish', 'no_publish')",
    )
    expect(src).toContain(
      "logNamed('cli_plugin_eval_mocks', 'standin_registration')",
    )
    expect(src).toContain(
      "logNamed('cli_plugin_eval_mocks', 'standin_identity')",
    )
    expect(src).toContain(
      "logNamed('cli_plugin_eval_mocks', 'standin_tools_missing')",
    )
    expect(src).toContain(
      "logNamed('cli_plugin_eval_mocks', 'standin_integrity')",
    )
    expect(src).toContain(
      "logNamed('cli_plugin_eval_mocks', 'agent_relay_failed')",
    )
    expect(src).toContain(
      "logNamed('cli_plugin_eval_mocks', 'aborted_by_mock')",
    )
    expect(src).toContain("logNamed('cli_plugin_eval_mocks')")
    expect(src).toContain("if (!grant.granted || arm === 'without') return")
    expect(src).toContain('startsWith(MOCK_AGENT_FAILED)')
    expect(src).not.toContain('EVAL_ABORTED_BY_MOCK')
  })

  test('ag/cg skip and fire without throwing', () => {
    expect(() =>
      logEvalArtifactPublish({ granted: false }, 'with', {
        published: true,
        errored: false,
      }),
    ).not.toThrow()
    expect(() =>
      logEvalArtifactPublish({ granted: true }, 'without', {
        published: true,
        errored: false,
      }),
    ).not.toThrow()
    expect(() =>
      logEvalArtifactPublish({ granted: true }, 'with', {
        published: true,
        errored: false,
      }),
    ).not.toThrow()
    expect(() =>
      logEvalArtifactPublish({ granted: true }, undefined, {
        published: false,
        errored: true,
      }),
    ).not.toThrow()
    expect(() =>
      logEvalArtifactPublish({ granted: true }, 'with', {
        published: false,
        errored: false,
      }),
    ).not.toThrow()
    expect(() =>
      logEvalMocks({ mockSetupFailure: 'registration', aborted: null }),
    ).not.toThrow()
    expect(() =>
      logEvalMocks({ mockSetupFailure: 'identity', aborted: null }),
    ).not.toThrow()
    expect(() =>
      logEvalMocks({ mockSetupFailure: 'tools_missing', aborted: null }),
    ).not.toThrow()
    expect(() =>
      logEvalMocks({ mockSetupFailure: 'integrity', aborted: null }),
    ).not.toThrow()
    expect(() =>
      logEvalMocks({
        mockSetupFailure: null,
        aborted: { reason: `${MOCK_AGENT_FAILED} (relay_internal)` },
      }),
    ).not.toThrow()
    expect(() =>
      logEvalMocks({
        mockSetupFailure: null,
        aborted: { reason: 'eval aborted by mock nonce: echo/ping' },
      }),
    ).not.toThrow()
    expect(() =>
      logEvalMocks({ mockSetupFailure: null, aborted: null }),
    ).not.toThrow()
  })
})
