/**
 * densable 2.1.224 #1 — session child argv/env (sjv/Njv/fff/xWl).
 */
import { describe, expect, test } from 'bun:test'
import {
  BLOCKED_CLAUDE_CODE_ARGS,
  buildSessionChildArgs,
  buildSessionChildEnv,
  buildSessionSdkUrls,
  mergeClaudeCodeArgs,
  remoteSessionUuidFromId,
  sanitizeServerClaudeCodeArgs,
  serverToolsValueNamesSelfHostedRunnerTool,
  sessionIngressTokenPath,
  stripSelfHostedRunnerToolNames,
} from '../sessionChild.js'

describe('densable 2.1.224 #1 sessionChild Njv/tBh', () => {
  test('buildSessionSdkUrls (Njv) https non-local', () => {
    const u = buildSessionSdkUrls('https://api.anthropic.com/', 'cse_01abc')
    expect(u.sdkUrl).toBe(
      'https://api.anthropic.com/v1/code/sessions/cse_01abc',
    )
    expect(u.resumeUrl).toBe(u.sdkUrl)
  })

  test('buildSessionSdkUrls localhost → http', () => {
    const u = buildSessionSdkUrls('http://localhost:8080', 's1')
    expect(u.sdkUrl).toBe('http://localhost:8080/v1/code/sessions/s1')
  })

  test('sessionIngressTokenPath (tBh)', () => {
    expect(sessionIngressTokenPath('/cfg', 3)).toBe(
      '/cfg/.session_ingress_token.e3',
    )
  })
})

describe('densable 2.1.224 #1 sessionChild tools strip', () => {
  test('strip operator tools (kvh)', () => {
    expect(
      stripSelfHostedRunnerToolNames('Bash,self_hosted_runner_get_pool,Read'),
    ).toBe('Bash,Read')
  })

  test('AFi detects operator tools', () => {
    expect(
      serverToolsValueNamesSelfHostedRunnerTool(
        'Bash,self_hosted_runner_tail_log',
      ),
    ).toBe(true)
    expect(serverToolsValueNamesSelfHostedRunnerTool('Bash,Read')).toBe(false)
  })

  test('sanitizeServerClaudeCodeArgs (xWl)', () => {
    const out = sanitizeServerClaudeCodeArgs({
      tools: 'Bash,self_hosted_runner_get_pool',
      model: 'x',
    })
    expect(out.tools).toBe('Bash')
    expect(out.model).toBe('x')
  })

  test('mergeClaudeCodeArgs blocks densable ojv set', () => {
    const argv: string[] = []
    const added = mergeClaudeCodeArgs(
      argv,
      { print: '1', model: 'm', tools: 'Bash' },
      BLOCKED_CLAUDE_CODE_ARGS,
      () => {},
    )
    expect(added).toBe(2)
    expect(argv).toContain('--model')
    expect(argv).toContain('m')
    expect(argv).not.toContain('--print')
  })
})

describe('densable 2.1.224 #1 sessionChild argv', () => {
  test('buildSessionChildArgs core flags', () => {
    const args = buildSessionChildArgs({
      execArgs: ['cli.js'],
      apiBaseUrl: 'https://api.anthropic.com',
      sessionId: 'sess1',
      debugFile: '/tmp/d.txt',
    })
    expect(args[0]).toBe('cli.js')
    expect(args).toContain('--print')
    expect(args).toContain('--sdk-url')
    expect(args).toContain('https://api.anthropic.com/v1/code/sessions/sess1')
    expect(args).toContain('--input-format')
    expect(args).toContain('stream-json')
    expect(args).toContain('--output-format')
    expect(args).toContain('--replay-user-messages')
    expect(args).toContain(
      '--resume=https://api.anthropic.com/v1/code/sessions/sess1',
    )
    expect(args).toContain('--debug-file')
    expect(args).toContain('/tmp/d.txt')
  })

  test('buildSessionChildEnv BYOC markers + strip secrets', () => {
    process.env.SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET = 'host-secret'
    const env = buildSessionChildEnv({
      sessionId: 'cse_01x',
      sessionToken: 'tok',
      workerEpoch: 2,
      configDir: '/cfg',
      stageFileRoot: '/stage',
      apiBaseUrl: 'https://api.anthropic.com',
      inferenceAccessToken: 'oauth',
      environmentVariables: { FOO: 'bar' },
    })
    expect(env.CLAUDE_CODE_REMOTE).toBe('true')
    expect(env.CLAUDE_CODE_ENVIRONMENT_KIND).toBe('byoc')
    expect(env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE).toBe('self_hosted')
    expect(env.CLAUDE_CODE_SESSION_ACCESS_TOKEN).toBe('tok')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth')
    expect(env.CLAUDE_CODE_WORKER_EPOCH).toBe('2')
    expect(env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN).toBe('1')
    expect(env.SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET).toBeUndefined()
    expect(env.FOO).toBe('bar')
    expect(env.CLAUDE_RUNNER_ACTIVITY_FD).toBe('3')
    delete process.env.SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET
  })

  test('buildSessionChildEnv governed git flags (sjv pt/J)', () => {
    const env = buildSessionChildEnv({
      sessionId: 'sess',
      sessionToken: 'tok',
      workerEpoch: 1,
      configDir: '/cfg',
      stageFileRoot: '/stage',
      apiBaseUrl: 'https://api.anthropic.com',
      inferenceAccessToken: 'oauth',
      governedGitConfig: true,
      governedGhPathShim: true,
      governedGitConfigPath: '/sessions/sess.gitconfig',
    })
    expect(env.CLAUDE_CODE_AGENT_PROXY_GIT_CONFIG).toBe('1')
    expect(env.CLAUDE_CODE_AGENT_PROXY_GH_SHIM).toBe('1')
    expect(env.GIT_CONFIG_GLOBAL).toBe('/sessions/sess.gitconfig')
    expect(env.CCR_AGENT_PROXY_ENABLED).toBe('1')
  })

  test('remoteSessionUuidFromId rejects short payload', () => {
    expect(remoteSessionUuidFromId('cse_01ab')).toBeUndefined()
  })
})
