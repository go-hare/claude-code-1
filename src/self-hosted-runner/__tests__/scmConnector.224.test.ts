/**
 * densable 2.1.224 #1 residual — kFh pure helpers (Sqv/yqv/bqv) + constants.
 */
import { describe, expect, test } from 'bun:test'
import {
  SCM_STANDBY_CLOSE_CODE,
  SCM_TUNNEL_PATH_TEMPLATE,
  buildScmDialUrl,
  buildScmTunnelWsUrl,
  validateScmHttpPath,
} from '../scmConnector.js'

describe('densable 2.1.224 #1 scmConnector pure (Sqv/yqv/bqv)', () => {
  test('buildScmTunnelWsUrl (Sqv)', () => {
    expect(SCM_TUNNEL_PATH_TEMPLATE).toContain('scm-connectors')
    expect(SCM_STANDBY_CLOSE_CODE).toBe(4003)
    expect(
      buildScmTunnelWsUrl('https://api.anthropic.com/', {
        provider: 'github',
        connectorId: '42',
      }),
    ).toBe('wss://api.anthropic.com/v1/code/scm-connectors/github/42/tunnel')
    expect(
      buildScmTunnelWsUrl('http://localhost:8080', {
        provider: 'ghe',
        connectorId: 7,
      }),
    ).toBe('ws://localhost:8080/v1/code/scm-connectors/ghe/7/tunnel')
  })

  test('validateScmHttpPath (yqv)', () => {
    expect(validateScmHttpPath('/api/v3/repos')).toBeNull()
    expect(validateScmHttpPath('')).toBe('path must be a non-empty string')
    expect(validateScmHttpPath(null)).toBe('path must be a non-empty string')
    expect(validateScmHttpPath('api')).toBe('path must start with /')
    expect(validateScmHttpPath('//evil')).toBe(
      'path must not start with // (scheme-relative)',
    )
    expect(validateScmHttpPath('/@evil')).toBe('path must not start with /@')
    expect(validateScmHttpPath('/a\\b')).toBe('path must not contain backslash')
  })

  test('buildScmDialUrl (bqv) keeps origin + query', () => {
    const u = buildScmDialUrl('ghe.example.com', 443, '/api/v3?x=1')
    expect(u.hostname).toBe('ghe.example.com')
    expect(u.port).toBe('')
    expect(u.pathname).toBe('/api/v3')
    expect(u.search).toBe('?x=1')
    expect(() => buildScmDialUrl('bad host', 443, '/x')).toThrow()
  })
})
