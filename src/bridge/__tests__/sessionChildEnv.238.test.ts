/**
 * densable 2.1.238 #21 — NDl session-child env (Vso/MDl/Eot/wot).
 * Does not apply mrn / ANTHROPIC_MODEL.
 */
import { describe, expect, test } from 'bun:test'
import { buildSessionChildEnv } from '../sessionChildEnv.js'

function parentEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/bin',
    HOME: '/home/user',
    ANTHROPIC_API_KEY: 'sk-parent',
    ANTHROPIC_MODEL: 'claude-opus-4-7',
    CLAUDECODE: '1',
    CLAUDE_CODE_CHILD_SESSION: 'keep-me',
    CLAUDE_CODE_SESSION_ACCESS_TOKEN: 'parent-session-token',
    CLAUDE_CODE_SESSION_ID: 'parent-session',
    CLAUDE_CODE_REMOTE_SESSION_ID: 'remote-sess',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth-parent',
    CLAUDE_CODE_ACCOUNT_UUID: 'acct',
    CLAUDE_CODE_USER_EMAIL: 'a@b.c',
    CLAUDE_CODE_COWORK_FRAME_ARTIFACTS: '1',
    CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES: '1',
    CLAUDE_CODE_ENTRYPOINT: 'claude-vscode',
    ...extra,
  }
}

describe('buildSessionChildEnv densable 2.1.238 NDl', () => {
  test('scrubs session/host keys and stamps bridge overrides', () => {
    const env = buildSessionChildEnv(parentEnv(), {
      accessToken: 'child-token',
      workerEpoch: 1,
    })
    expect(env.CLAUDE_CODE_SESSION_ACCESS_TOKEN).toBe('child-token')
    expect(env.CLAUDE_CODE_ENVIRONMENT_KIND).toBe('bridge')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined()
    expect(env.CLAUDE_CODE_REMOTE_SESSION_ID).toBeUndefined()
    expect(env.CLAUDE_CODE_ACCOUNT_UUID).toBeUndefined()
    expect(env.CLAUDE_CODE_USER_EMAIL).toBeUndefined()
    expect(env.CLAUDE_CODE_WORKER_EPOCH).toBe('1')
    expect(env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN).toBeUndefined()
  })

  test('keeps MDl parent keys and PATH', () => {
    const env = buildSessionChildEnv(parentEnv(), {
      accessToken: 't',
    })
    expect(env.CLAUDECODE).toBe('1')
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBe('keep-me')
    expect(env.PATH).toBe('/usr/bin')
  })

  test('does not delete ANTHROPIC_MODEL (mrn is not NDl)', () => {
    const env = buildSessionChildEnv(parentEnv(), {
      accessToken: 't',
    })
    expect(env.ANTHROPIC_MODEL).toBe('claude-opus-4-7')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-parent')
  })

  test('Eot deletes UKT keys regardless of case', () => {
    const env = buildSessionChildEnv(
      parentEnv({
        claude_code_cowork_frame_artifacts: 'lower',
      }),
      { accessToken: 't' },
    )
    expect(env.CLAUDE_CODE_COWORK_FRAME_ARTIFACTS).toBeUndefined()
    expect(env.CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES).toBeUndefined()
    expect(env.claude_code_cowork_frame_artifacts).toBeUndefined()
  })

  test('wot strips vscode/desktop ENTRYPOINT', () => {
    const vscode = buildSessionChildEnv(parentEnv(), { accessToken: 't' })
    expect(vscode.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
    const cli = buildSessionChildEnv(
      parentEnv({ CLAUDE_CODE_ENTRYPOINT: 'cli' }),
      { accessToken: 't' },
    )
    expect(cli.CLAUDE_CODE_ENTRYPOINT).toBe('cli')
  })

  test('workerEpoch > 1 sets resume interrupted turn', () => {
    const env = buildSessionChildEnv(parentEnv(), {
      accessToken: 't',
      workerEpoch: 2,
    })
    expect(env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN).toBe('1')
    expect(env.CLAUDE_CODE_WORKER_EPOCH).toBe('2')
  })

  test('sandbox stamps FORCE_SANDBOX', () => {
    const env = buildSessionChildEnv(parentEnv(), {
      accessToken: 't',
      sandbox: true,
    })
    expect(env.CLAUDE_CODE_FORCE_SANDBOX).toBe('1')
  })
})
