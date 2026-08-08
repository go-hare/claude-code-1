import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { expandEnvVarsInString } from '../envExpansion.js'
import {
  clearFrozenStartupEnvForTests,
  getFrozenStartupEnv,
  getMcpPolicyPrimaryEnv,
} from '../../../utils/managedEnv.js'

const ENV_OPEN = '$' + '{'
const ENV_CLOSE = '}'
const envExpr = (value: string): string => `${ENV_OPEN}${value}${ENV_CLOSE}`

/**
 * densable 2.1.219 #19 — managed MCP allow/deny `${VAR}` from startup freeze +
 * managed-settings env (Y6u/Hyy/S7), not settings-file env alone.
 *
 * Integration of isMcpServerDenied/Allowed is covered via pure S7/Y6u/VQr here;
 * config.ts wires expandMcpPolicyPredicate against these helpers.
 */
describe('densable 2.1.219 #19 MCP policy env expansion', () => {
  const key = 'CC_219_MCP_POLICY_PROBE'
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env[key]
    clearFrozenStartupEnvForTests()
  })

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = saved
    }
    clearFrozenStartupEnvForTests()
  })

  test('VQr freeze captures pre-settings process.env', () => {
    process.env[key] = 'startup-value'
    const frozen = getFrozenStartupEnv()
    expect(frozen[key]).toBe('startup-value')

    // Mutating process.env after freeze must not change the snapshot
    process.env[key] = 'mutated-later'
    expect(getFrozenStartupEnv()[key]).toBe('startup-value')
  })

  test('Y6u primary env includes frozen startup keys', () => {
    process.env[key] = 'from-startup'
    clearFrozenStartupEnvForTests()
    getFrozenStartupEnv()
    const primary = getMcpPolicyPrimaryEnv()
    expect(primary[key]).toBe('from-startup')
  })

  test('policy predicate expands from primary env map (not only process.env)', () => {
    // Simulate allow path: command entry uses ${CC_219_MCP_POLICY_PROBE}
    delete process.env[key]
    const primary = {
      ...getFrozenStartupEnv(),
      [key]: '/opt/managed/bin/mcp',
    }
    const { expanded, missingVars } = expandEnvVarsInString(
      envExpr(key),
      primary,
    )
    expect(missingVars).toEqual([])
    expect(expanded).toBe('/opt/managed/bin/mcp')
  })

  test('deny fallbackEnv fills vars absent from primary', () => {
    const primary = { ...getFrozenStartupEnv() }
    delete (primary as Record<string, string | undefined>)[key]
    const fallback = { [key]: 'user-settings-path' }
    const { expanded } = expandEnvVarsInString(envExpr(key), primary, fallback)
    expect(expanded).toBe('user-settings-path')
  })

  test('command array match after independent expansion (densable K6u)', () => {
    const policyCmd = [envExpr(key), '--stdio']
    const serverCmd = ['/opt/managed/bin/mcp', '--stdio']
    const env = { [key]: '/opt/managed/bin/mcp' }
    const expandedPolicy = policyCmd.map(
      p => expandEnvVarsInString(p, env).expanded,
    )
    expect(expandedPolicy).toEqual(serverCmd)
    expect(
      expandedPolicy.length === serverCmd.length &&
        expandedPolicy.every((v, i) => v === serverCmd[i]),
    ).toBe(true)
  })

  test('URL pattern expands host from managed env', () => {
    const pattern = `https://${envExpr(key)}/*`
    const env = { [key]: 'mcp.corp.example' }
    const { expanded } = expandEnvVarsInString(pattern, env)
    expect(expanded).toBe('https://mcp.corp.example/*')
  })

  test('settings-file-only env is not required when primary has value', () => {
    // Regression of pre-219: policy used unexpanded ${VAR} and never matched
    // servers that only existed after settings.env applied process.env.
    // Now primary = startup + managed; match works without settings-file env.
    const policy = envExpr('HOME_BIN') + '/mcp-server'
    const primary = { HOME_BIN: '/usr/local' }
    // settings-file env intentionally empty / not used
    const { expanded } = expandEnvVarsInString(policy, primary)
    expect(expanded).toBe('/usr/local/mcp-server')
  })
})
