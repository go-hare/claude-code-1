import { afterEach, describe, expect, test } from 'bun:test'
import {
  applyExecEndpointStrip,
  applyHostManagedSpareEnv,
  applyHostManagedWorkerEnv,
  applySpareProviderStrips,
  applyWorkerProviderStrips,
  applyWorkerSessionStrips,
  buildDispatchProviderEnv,
  copyProviderGatewayEnv,
  inheritParentEndpointEnv,
  isExternallyManagedProviderEnv,
  snapshotProviderEnv,
  stripHostEntrypoint,
} from '../bgHostManagedEnv.js'
import { buildWorkerEnv, type DispatchRequest } from '../bgWorker.js'
import { buildSpareHostEnv } from '../bgSpare.js'

const TOUCHED = [
  'ANTHROPIC_UNIX_SOCKET',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CODE_HOST_AUTH_ENV_VAR',
  'CLAUDE_CODE_HOST_CREDS_FILE',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'DESKTOP_HOST_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'GOOGLE_CLOUD_PROJECT',
  'ANTHROPIC_MODEL',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXTRA_BODY',
  'VERTEX_REGION_CLAUDE_TEST',
] as const

const saved: Record<string, string | undefined> = {}

function snapshotEnv(): void {
  for (const key of TOUCHED) saved[key] = process.env[key]
}

function restoreEnv(): void {
  for (const key of TOUCHED) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
}

function clearTouched(): void {
  for (const key of TOUCHED) delete process.env[key]
}

function dispatch(
  env?: Record<string, string>,
  mode: DispatchRequest['launch']['mode'] = 'prompt',
): DispatchRequest {
  return {
    short: 'abcd',
    sessionId: 'sess',
    intent: 'test',
    cwd: process.cwd(),
    respawnFlags: [],
    source: 'test',
    createdAt: Date.now(),
    env,
    launch: { mode },
  }
}

snapshotEnv()

describe('isExternallyManagedProviderEnv (densable RO)', () => {
  test('is true for socket, managed-by-host, or a host-auth var name', () => {
    expect(isExternallyManagedProviderEnv({})).toBe(false)
    expect(
      isExternallyManagedProviderEnv({ ANTHROPIC_UNIX_SOCKET: '/tmp/s' }),
    ).toBe(true)
    expect(
      isExternallyManagedProviderEnv({
        CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
      }),
    ).toBe(true)
    expect(
      isExternallyManagedProviderEnv({
        CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '0',
      }),
    ).toBe(false)
    expect(
      isExternallyManagedProviderEnv({
        CLAUDE_CODE_HOST_AUTH_ENV_VAR: 'DESKTOP_HOST_TOKEN',
      }),
    ).toBe(true)
  })
})

describe('applyHostManagedWorkerEnv (densable ci)', () => {
  afterEach(restoreEnv)

  test('ssh socket drops tokens and endpoint keys, keeps AWS secrets', () => {
    const parent = {
      ANTHROPIC_UNIX_SOCKET: '/tmp/s',
      ANTHROPIC_API_KEY: 'sk-parent',
      ANTHROPIC_AUTH_TOKEN: 'tok',
      ANTHROPIC_BASE_URL: 'https://proxy.example',
      AWS_ACCESS_KEY_ID: 'AKIA',
    }
    const env = { ...parent, CLAUDE_CODE_SESSION_KIND: 'bg' }
    applyHostManagedWorkerEnv(env, parent)
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_UNIX_SOCKET).toBe('/tmp/s')
    expect(env.AWS_ACCESS_KEY_ID).toBe('AKIA')
  })

  test('managed-by-host also drops AWS/GCP creds unless dispatch sets them', () => {
    const parent = {
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
      AWS_ACCESS_KEY_ID: 'AKIA',
      AWS_PROFILE: 'work',
      GOOGLE_CLOUD_PROJECT: 'p',
    }
    const env = { ...parent, AWS_PROFILE: 'work' }
    applyHostManagedWorkerEnv(env, parent, { AWS_PROFILE: 'work' })
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined()
    expect(env.AWS_PROFILE).toBe('work')
    expect(env.GOOGLE_CLOUD_PROJECT).toBeUndefined()
  })

  test('dispatch managed flag forwards HOST_CREDS_FILE from the parent', () => {
    const parent = { CLAUDE_CODE_HOST_CREDS_FILE: '/host/creds.json' }
    const env: Record<string, string | undefined> = {}
    applyHostManagedWorkerEnv(env, parent, {
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
    })
    expect(env.CLAUDE_CODE_HOST_CREDS_FILE).toBe('/host/creds.json')
  })

  test('a dispatch BASE_URL override is discarded, not inherited', () => {
    const parent = {
      ANTHROPIC_AUTH_TOKEN: 'tok',
      ANTHROPIC_BASE_URL: 'https://a',
    }
    const env: Record<string, string | undefined> = {
      ANTHROPIC_AUTH_TOKEN: 'tok',
      ANTHROPIC_BASE_URL: 'https://evil',
      ANTHROPIC_CUSTOM_HEADERS: 'X: 1',
    }
    applyHostManagedWorkerEnv(env, parent, {
      ANTHROPIC_BASE_URL: 'https://evil',
    })
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
  })

  test('a denied HOST_AUTH_ENV_VAR name is not deleted', () => {
    const parent = {
      CLAUDE_CODE_HOST_AUTH_ENV_VAR: 'ANTHROPIC_UNIX_SOCKET',
      ANTHROPIC_UNIX_SOCKET: '/tmp/s',
      ANTHROPIC_API_KEY: 'sk',
    }
    const env = { ...parent }
    applyHostManagedWorkerEnv(env, parent)
    expect(env.ANTHROPIC_UNIX_SOCKET).toBe('/tmp/s')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })
})

describe('applyHostManagedSpareEnv (densable os)', () => {
  test('BASE_URL without RO drops only AUTH_TOKEN', () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_BASE_URL: 'https://proxy.example',
      ANTHROPIC_AUTH_TOKEN: 'tok',
      ANTHROPIC_API_KEY: 'sk',
    }
    applyHostManagedSpareEnv(env)
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBe('sk')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example')
  })

  test('socket RO drops tokens, not AWS secrets', () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_UNIX_SOCKET: '/tmp/s',
      ANTHROPIC_API_KEY: 'sk',
      AWS_ACCESS_KEY_ID: 'AKIA',
    }
    applyHostManagedSpareEnv(env)
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.AWS_ACCESS_KEY_ID).toBe('AKIA')
  })
})

describe('applyExecEndpointStrip', () => {
  test('drops ke and AUTH_TOKEN when BASE_URL is set', () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_BASE_URL: 'https://a',
      ANTHROPIC_AUTH_TOKEN: 'tok',
      ANTHROPIC_CUSTOM_HEADERS: 'X: 1',
    }
    applyExecEndpointStrip(env)
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
  })
})

describe('buildWorkerEnv / buildSpareHostEnv wire-up', () => {
  afterEach(restoreEnv)

  test('buildWorkerEnv strips parent tokens under a unix socket', () => {
    clearTouched()
    process.env.ANTHROPIC_UNIX_SOCKET = '/tmp/s'
    process.env.ANTHROPIC_API_KEY = 'sk-parent'
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example'
    const env = buildWorkerEnv(
      dispatch(),
      '/tmp/job-dir',
      undefined,
      '/tmp/rv.sock',
    )
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_UNIX_SOCKET).toBe('/tmp/s')
    expect(env.CLAUDE_JOB_DIR).toBe('/tmp/job-dir')
  })

  test('buildSpareHostEnv drops AUTH_TOKEN then wt drops BASE_URL', () => {
    clearTouched()
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example'
    process.env.ANTHROPIC_AUTH_TOKEN = 'tok'
    process.env.ANTHROPIC_API_KEY = 'sk'
    const env = buildSpareHostEnv()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBe('sk')
    // densable os() wt is unconditional and includes ANTHROPIC_BASE_URL
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
  })
})

describe('tl() / Ht() / wt (densable dispatch.env + ci strips)', () => {
  afterEach(restoreEnv)

  test('inheritParentEndpointEnv is empty under RO or without BASE_URL', () => {
    expect(
      inheritParentEndpointEnv({
        ANTHROPIC_CUSTOM_HEADERS: 'X: 1',
      }),
    ).toEqual({})
    expect(
      inheritParentEndpointEnv({
        ANTHROPIC_UNIX_SOCKET: '/tmp/s',
        ANTHROPIC_BASE_URL: 'https://proxy.example',
      }),
    ).toEqual({})
  })

  test('inheritParentEndpointEnv copies the BASE_URL trio', () => {
    expect(
      inheritParentEndpointEnv({
        ANTHROPIC_BASE_URL: 'https://proxy.example',
        _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: '1',
        ANTHROPIC_CUSTOM_HEADERS: 'X: 1',
      }),
    ).toEqual({
      ANTHROPIC_BASE_URL: 'https://proxy.example',
      _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: '1',
      ANTHROPIC_CUSTOM_HEADERS: 'X: 1',
    })
  })

  test('Oo copies Vertex/Bedrock SKIP companions when selected', () => {
    const parent = {
      ANTHROPIC_VERTEX_BASE_URL: 'https://vertex.example',
      CLAUDE_CODE_SKIP_VERTEX_AUTH: '1',
      ANTHROPIC_CUSTOM_HEADERS: 'X: 1',
      ANTHROPIC_BEDROCK_BASE_URL: 'https://bedrock.example',
      CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      CLAUDE_CODE_USE_BEDROCK: '1',
    }
    expect(copyProviderGatewayEnv(parent, parent)).toEqual({
      ANTHROPIC_VERTEX_BASE_URL: 'https://vertex.example',
      CLAUDE_CODE_SKIP_VERTEX_AUTH: '1',
      ANTHROPIC_CUSTOM_HEADERS: 'X: 1',
      ANTHROPIC_BEDROCK_BASE_URL: 'https://bedrock.example',
      CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1',
    })
    expect(
      copyProviderGatewayEnv(
        { CLAUDE_CODE_USE_VERTEX: '1' },
        { ANTHROPIC_VERTEX_BASE_URL: 'https://vertex.example' },
      ),
    ).toEqual({ ANTHROPIC_VERTEX_BASE_URL: 'https://vertex.example' })
    expect(
      copyProviderGatewayEnv(
        {},
        {
          ANTHROPIC_VERTEX_BASE_URL: 'https://vertex.example',
          CLAUDE_CODE_SKIP_VERTEX_AUTH: '1',
        },
      ),
    ).toEqual({})
    expect(
      copyProviderGatewayEnv(
        { CLAUDE_CODE_USE_VERTEX: '1' },
        {
          ANTHROPIC_UNIX_SOCKET: '/tmp/s',
          ANTHROPIC_VERTEX_BASE_URL: 'https://vertex.example',
          CLAUDE_CODE_SKIP_VERTEX_AUTH: '1',
        },
      ),
    ).toEqual({})
  })

  test('So spreads Oo into non-exec dispatch env', () => {
    const parent = {
      ANTHROPIC_VERTEX_BASE_URL: 'https://vertex.example',
      CLAUDE_CODE_SKIP_VERTEX_AUTH: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
    }
    expect(
      buildDispatchProviderEnv({
        source: 'repl',
        currentCwd: '/a',
        parentEnv: parent,
      }).CLAUDE_CODE_SKIP_VERTEX_AUTH,
    ).toBe('1')
    expect(
      buildDispatchProviderEnv({
        exec: 'ls',
        source: 'repl',
        currentCwd: '/a',
        parentEnv: parent,
      }).CLAUDE_CODE_SKIP_VERTEX_AUTH,
    ).toBeUndefined()
  })

  test('snapshotProviderEnv skips empty values except securestorage', () => {
    expect(
      snapshotProviderEnv({
        ANTHROPIC_MODEL: '',
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_SECURESTORAGE_CONFIG_DIR: '',
      }),
    ).toEqual({
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_SECURESTORAGE_CONFIG_DIR: '',
    })
  })

  test('buildDispatchProviderEnv skips tl() for exec and foreign cwd', () => {
    const parent = {
      ANTHROPIC_BASE_URL: 'https://proxy.example',
      ANTHROPIC_MODEL: 'claude-opus',
    }
    expect(
      buildDispatchProviderEnv({
        exec: 'ls',
        source: 'repl',
        currentCwd: '/a',
        parentEnv: parent,
      }).ANTHROPIC_BASE_URL,
    ).toBeUndefined()
    expect(
      buildDispatchProviderEnv({
        source: 'fleet',
        cwd: '/other',
        currentCwd: '/a',
        parentEnv: parent,
      }).ANTHROPIC_BASE_URL,
    ).toBeUndefined()
    expect(
      buildDispatchProviderEnv({
        source: 'repl',
        cwd: '/other',
        currentCwd: '/a',
        parentEnv: parent,
      }).ANTHROPIC_BASE_URL,
    ).toBe('https://proxy.example')
    expect(
      buildDispatchProviderEnv({
        source: 'fleet',
        currentCwd: '/a',
        parentEnv: parent,
      }).ANTHROPIC_MODEL,
    ).toBe('claude-opus')
  })

  test('wt drops ANTHROPIC_MODEL unless dispatch.env keeps it', () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_MODEL: 'claude-opus',
      VERTEX_REGION_CLAUDE_TEST: 'us-east5',
    }
    applyWorkerProviderStrips(env)
    expect(env.ANTHROPIC_MODEL).toBeUndefined()
    expect(env.VERTEX_REGION_CLAUDE_TEST).toBeUndefined()
    const kept: Record<string, string | undefined> = {
      ANTHROPIC_MODEL: 'claude-opus',
    }
    applyWorkerProviderStrips(kept, { ANTHROPIC_MODEL: 'claude-opus' })
    expect(kept.ANTHROPIC_MODEL).toBe('claude-opus')
  })

  test('Ge strips vscode entrypoint unless dispatch sets it', () => {
    const env: Record<string, string | undefined> = {
      CLAUDE_CODE_ENTRYPOINT: 'claude-vscode',
    }
    applyWorkerSessionStrips(env)
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
    const kept: Record<string, string | undefined> = {
      CLAUDE_CODE_ENTRYPOINT: 'claude-vscode',
    }
    applyWorkerSessionStrips(kept, { CLAUDE_CODE_ENTRYPOINT: 'claude-vscode' })
    expect(kept.CLAUDE_CODE_ENTRYPOINT).toBe('claude-vscode')
    const cli: Record<string, string | undefined> = {
      CLAUDE_CODE_ENTRYPOINT: 'cli',
    }
    stripHostEntrypoint(cli)
    expect(cli.CLAUDE_CODE_ENTRYPOINT).toBe('cli')
  })

  test('buildWorkerEnv keeps BASE_URL when dispatch.env forwarded tl()', () => {
    clearTouched()
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example'
    process.env.ANTHROPIC_CUSTOM_HEADERS = 'X: 1'
    const forwarded = inheritParentEndpointEnv(process.env)
    const env = buildWorkerEnv(
      dispatch(forwarded),
      '/tmp/job-dir',
      undefined,
      '/tmp/rv.sock',
    )
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example')
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe('X: 1')
  })

  test('spare provider strip drops BASE_URL after the RO AUTH_TOKEN cut', () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_BASE_URL: 'https://proxy.example',
      ANTHROPIC_AUTH_TOKEN: 'tok',
    }
    applyHostManagedSpareEnv(env)
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example')
    applySpareProviderStrips(env)
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
  })
})
