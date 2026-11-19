import { describe, expect, test } from 'bun:test'
import {
  applyWorkerCredentialSwitchCleanup,
  buildDispatchProviderEnv,
} from '../../daemon/bgHostManagedEnv.js'
import {
  BG_ENV_LOGIN_SENTINEL,
  BG_OAUTH_TOKEN_BLOCKED_MESSAGE,
  BG_SESSION_CREDENTIAL_ENV,
  BG_SHELL_CREDENTIAL_MISMATCH_MESSAGE,
  checkBgSpawnCredentialCompatibility,
  getConflictingDaemonCredentialEnvKeys,
  verifyRuntimeBgCredentialAnchor,
} from '../../daemon/bgSessionCredential.js'
import {
  BRIDGE_EXIT_CODE_REGISTRATION_FAILED,
  BRIDGE_EXIT_CODE_SELF_STOP,
  resolveBridgeExitCode,
} from '../bridgeMain.js'
import {
  checkBridgeSessionShareVisibility,
  disconnectBridgeBeforeConversationSwitch,
} from '../replBridgeShareCheck.js'

describe('Wave 325 Group 4 — Bridge & Background Daemon', () => {
  test('#2290: background sessions started on claude.ai login strip daemon shell API key/token', () => {
    const dispatchEnv = buildDispatchProviderEnv({
      currentCwd: '/tmp',
      parentEnv: { PATH: '/usr/bin' },
    })
    expect(dispatchEnv[BG_SESSION_CREDENTIAL_ENV]).toBe(BG_ENV_LOGIN_SENTINEL)

    expect(
      getConflictingDaemonCredentialEnvKeys(BG_ENV_LOGIN_SENTINEL),
    ).toContain('ANTHROPIC_API_KEY')
    expect(
      getConflictingDaemonCredentialEnvKeys(BG_ENV_LOGIN_SENTINEL),
    ).toContain('ANTHROPIC_AUTH_TOKEN')

    const workerEnv: Record<string, string | undefined> = {
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'sk-ant-daemon-shell-key',
      ANTHROPIC_AUTH_TOKEN: 'daemon-shell-token',
      CLAUDE_CODE_OAUTH_TOKEN: 'daemon-oauth-token',
      [BG_SESSION_CREDENTIAL_ENV]: BG_ENV_LOGIN_SENTINEL,
    }
    applyWorkerCredentialSwitchCleanup(
      workerEnv,
      {
        ANTHROPIC_API_KEY: 'sk-ant-daemon-shell-key',
        ANTHROPIC_AUTH_TOKEN: 'daemon-shell-token',
      },
      dispatchEnv,
    )
    expect(workerEnv.ANTHROPIC_API_KEY).toBeUndefined()
    expect(workerEnv.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(workerEnv.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()

    // Runtime check catches leaked daemon API key if unstripped
    const runtimeErr = verifyRuntimeBgCredentialAnchor({
      [BG_SESSION_CREDENTIAL_ENV]: BG_ENV_LOGIN_SENTINEL,
      ANTHROPIC_API_KEY: 'sk-ant-leaked',
    })
    expect(runtimeErr).not.toBeNull()
    expect(
      verifyRuntimeBgCredentialAnchor({
        [BG_SESSION_CREDENTIAL_ENV]: BG_ENV_LOGIN_SENTINEL,
      }),
    ).toBeNull()
  })

  test('#2291 & #2351: refuses sign-in moves in background and never suggests adding key to settings', () => {
    expect(BG_SHELL_CREDENTIAL_MISMATCH_MESSAGE.toLowerCase()).not.toContain(
      'settings',
    )
    expect(BG_OAUTH_TOKEN_BLOCKED_MESSAGE.toLowerCase()).not.toContain(
      'settings',
    )

    // Caller on claude.ai login targeting older daemon with shell API key
    const conflictErr = checkBgSpawnCredentialCompatibility({
      callerEnv: {},
      daemonEnv: { ANTHROPIC_API_KEY: 'sk-ant-daemon' },
      daemonProfileAnchorCap: 0,
    })
    expect(conflictErr).not.toBeNull()
    expect(conflictErr!.toLowerCase()).not.toContain('settings')

    // Caller resuming a session anchored to another sign-in
    const driftErr = checkBgSpawnCredentialCompatibility({
      callerEnv: { ANTHROPIC_API_KEY: 'sk-ant-caller' },
      existingSessionAnchor: 'profile:work:0123456789abcdef',
    })
    expect(driftErr).not.toBeNull()
    expect(driftErr).toContain('claude --resume')
  })

  test('#2350: claude remote-control exits 4 on self-stop (0 on single-session/signal) and 69 on registration failure', () => {
    expect(BRIDGE_EXIT_CODE_SELF_STOP).toBe(4)
    expect(BRIDGE_EXIT_CODE_REGISTRATION_FAILED).toBe(69)

    expect(
      resolveBridgeExitCode({
        signalAborted: false,
        spawnMode: 'same-dir',
      }),
    ).toBe(4)
    expect(
      resolveBridgeExitCode({
        signalAborted: false,
        spawnMode: 'single-session',
      }),
    ).toBe(0)
    expect(
      resolveBridgeExitCode({
        signalAborted: true,
        spawnMode: 'same-dir',
      }),
    ).toBe(0)
    expect(
      resolveBridgeExitCode({
        signalAborted: false,
        spawnMode: 'same-dir',
        registrationFailed: true,
      }),
    ).toBe(69)
  })

  test('#2373: /resume and /teleport disconnect Remote Control when share link exists or cannot be checked', async () => {
    expect(
      await checkBridgeSessionShareVisibility('session_1', {
        fetcher: async () => ({
          status: 200,
          data: { effective_visibility: 'org_shared' },
        }),
      }),
    ).toBe('shared')

    expect(
      await checkBridgeSessionShareVisibility('session_1', {
        fetcher: async () => ({
          status: 200,
          data: { effective_visibility: 'private' },
        }),
      }),
    ).toBe('private')

    expect(
      await checkBridgeSessionShareVisibility('session_1', {
        fetcher: async () => ({ failure: 'network' }),
      }),
    ).toBe('unknown')

    let tornDown = false
    let notified = false
    const resShared = await disconnectBridgeBeforeConversationSwitch({
      outboundOnly: false,
      handle: {
        bridgeSessionId: 'session_1',
        teardown: async () => {
          tornDown = true
        },
      } as never,
      fetcher: async () => ({
        status: 200,
        data: { effective_visibility: 'sign_in_shared' },
      }),
      onDisconnected: () => {
        notified = true
      },
    })
    expect(resShared.disconnected).toBe(true)
    expect(resShared.visibility).toBe('shared')
    expect(resShared.notice).toContain('/remote-control')
    expect(tornDown).toBe(true)
    expect(notified).toBe(true)

    let tornDownPrivate = false
    const resPrivate = await disconnectBridgeBeforeConversationSwitch({
      outboundOnly: false,
      handle: {
        bridgeSessionId: 'session_2',
        teardown: async () => {
          tornDownPrivate = true
        },
      } as never,
      fetcher: async () => ({
        status: 200,
        data: { effective_visibility: 'private' },
      }),
    })
    expect(resPrivate.disconnected).toBe(false)
    expect(resPrivate.visibility).toBe('private')
    expect(tornDownPrivate).toBe(false)
  })
})
