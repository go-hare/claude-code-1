import { describe, expect, test } from 'bun:test'
import {
  buildGhShimScript,
  canAppendToolScopedGitConfig,
  canWriteGhShim,
  isAgentProxyGhShimEnabled,
  isAgentProxyGitConfigEnabled,
  shouldWriteGhShim,
} from '../ghShim.js'

describe('canWriteGhShim', () => {
  test('ok for plain paths + http proxy', () => {
    expect(
      canWriteGhShim({
        realGhPath: '/usr/bin/gh',
        shimPath: '/tmp/session/bin/gh',
        httpsProxy: 'http://127.0.0.1:8080',
      }),
    ).toEqual({ ok: true })
  })
  test('skips missing gh', () => {
    const r = canWriteGhShim({
      realGhPath: null,
      shimPath: '/tmp/bin/gh',
      httpsProxy: 'http://127.0.0.1:1',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('gh_not_found')
  })
  test('skips single quote in path', () => {
    const r = canWriteGhShim({
      realGhPath: "/tmp/o'brian/gh",
      shimPath: '/tmp/bin/gh',
      httpsProxy: 'http://127.0.0.1:1',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('path_contains_single_quote')
  })
  test('rejects https proxy url', () => {
    const r = canWriteGhShim({
      realGhPath: '/usr/bin/gh',
      shimPath: '/tmp/bin/gh',
      httpsProxy: 'https://127.0.0.1:1',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_proxy_url')
  })
})

describe('buildGhShimScript', () => {
  test('embeds proxy + real gh + placeholder tokens', () => {
    const body = buildGhShimScript({
      realGhPath: '/usr/local/bin/gh',
      shimPath: '/tmp/bin/gh',
      httpsProxy: 'http://127.0.0.1:9999',
      sslCertFile: '/tmp/ca.pem',
    })
    expect(body.startsWith('#!/usr/bin/env bash')).toBe(true)
    expect(body).toContain('exec \'/usr/local/bin/gh\' "$@"')
    expect(body).toContain("HTTPS_PROXY='http://127.0.0.1:9999'")
    expect(body).toContain("SSL_CERT_FILE='/tmp/ca.pem'")
    expect(body).toContain("GH_TOKEN='proxy-injected'")
    expect(body).toContain('claude agent-proxy governed-git gh shim')
  })
})

describe('canAppendToolScopedGitConfig', () => {
  test('true when GIT_CONFIG_COUNT unset', () => {
    expect(canAppendToolScopedGitConfig({})).toBe(true)
  })
  test('false when count already set', () => {
    expect(canAppendToolScopedGitConfig({ GIT_CONFIG_COUNT: '2' })).toBe(false)
  })
  test('false when CLAUDE_CODE_AGENT_PROXY_GIT_CONFIG disabled', () => {
    expect(
      canAppendToolScopedGitConfig({
        CLAUDE_CODE_AGENT_PROXY_GIT_CONFIG: '0',
      }),
    ).toBe(false)
  })
})

describe('agent-proxy env gates', () => {
  test('gh shim default on; 0 disables', () => {
    expect(isAgentProxyGhShimEnabled({})).toBe(true)
    expect(
      isAgentProxyGhShimEnabled({ CLAUDE_CODE_AGENT_PROXY_GH_SHIM: '0' }),
    ).toBe(false)
    expect(
      isAgentProxyGhShimEnabled({ CLAUDE_CODE_AGENT_PROXY_GH_SHIM: '1' }),
    ).toBe(true)
  })
  test('git config default on', () => {
    expect(isAgentProxyGitConfigEnabled({})).toBe(true)
    expect(
      isAgentProxyGitConfigEnabled({
        CLAUDE_CODE_AGENT_PROXY_GIT_CONFIG: 'no',
      }),
    ).toBe(false)
  })
  test('shouldWriteGhShim respects disable', () => {
    const r = shouldWriteGhShim(
      {
        realGhPath: '/usr/bin/gh',
        shimPath: '/tmp/bin/gh',
        httpsProxy: 'http://127.0.0.1:1',
      },
      { CLAUDE_CODE_AGENT_PROXY_GH_SHIM: 'false' },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('shim_disabled')
  })
})
