import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmHandler } from '../../cli/bg.js'
import {
  _resetBgNeedsInputBridgeForTests,
  clearBgNeedsInputOnReply,
  emitBgNeedsInput,
  getBgNeedsInputSnapshot,
  shouldSuppressTurnEndNeedsInput,
} from '../../utils/bgNeedsInputBridge.js'
import {
  applyWorkerCredentialSwitchCleanup,
  buildDispatchProviderEnv,
  snapshotProviderEnv,
} from '../bgHostManagedEnv.js'
import {
  BG_OAUTH_TOKEN_BLOCKED_MESSAGE,
  BG_OLD_DAEMON_PROFILE_MESSAGE,
  BG_PROFILE_MIN_DAEMON_CAP,
  BG_SESSION_CREDENTIAL_ENV,
  BG_SHELL_CREDENTIAL_MISMATCH_MESSAGE,
  BG_SIGNIN_DRIFT_MESSAGE,
  checkBgSpawnCredentialCompatibility,
  clearPreviousAccountCredentialsFromEnv,
  computeBgSessionCredentialAnchor,
  readBgJobCredentialAnchor,
  reconcileBgJobCredentialAnchor,
  verifyRuntimeBgCredentialAnchor,
} from '../bgSessionCredential.js'
import {
  CTRL_B_DETACH_WINDOW_MS,
  createAttachDetachStateMachine,
} from '../clientAttach.js'

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  _resetBgNeedsInputBridgeForTests()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe('Wave 323 Group 5A: daemon credential anchoring / Ctrl+B detach / bgNeedsInput / rm', () => {
  test('#1993/#1994/#1995/#1998/#1999/#2000 profile anchoring, old daemon, oauth block, drift & cleanup', async () => {
    const baseDir = await makeTempDir('w323-anchors-')

    // #1995: CLAUDE_CODE_OAUTH_TOKEN blocks bg handoff
    expect(
      checkBgSpawnCredentialCompatibility({
        callerEnv: { CLAUDE_CODE_OAUTH_TOKEN: 'tok-secret' },
        daemonProfileAnchorCap: BG_PROFILE_MIN_DAEMON_CAP,
      }),
    ).toBe(BG_OAUTH_TOKEN_BLOCKED_MESSAGE)

    // #1998: named profile on older daemon (< cap 1) fails with exact guidance
    expect(
      checkBgSpawnCredentialCompatibility({
        callerEnv: { ANTHROPIC_PROFILE: 'work' },
        daemonProfileAnchorCap: 0,
      }),
    ).toBe(BG_OLD_DAEMON_PROFILE_MESSAGE)

    // #1995: mismatched shell API key vs daemon env
    expect(
      checkBgSpawnCredentialCompatibility({
        callerEnv: { ANTHROPIC_API_KEY: 'sk-ant-caller' },
        daemonEnv: { ANTHROPIC_API_KEY: 'sk-ant-other' },
        daemonProfileAnchorCap: BG_PROFILE_MIN_DAEMON_CAP,
      }),
    ).toBe(BG_SHELL_CREDENTIAL_MISMATCH_MESSAGE)

    // #1993: buildDispatchProviderEnv stamps profile & credential anchor
    const dispatchEnv = buildDispatchProviderEnv({
      source: 'repl',
      currentCwd: '/tmp',
      parentEnv: {
        ANTHROPIC_PROFILE: 'work',
        ANTHROPIC_CONFIG_DIR: '/tmp/cfg-work',
      },
    })
    expect(dispatchEnv.ANTHROPIC_PROFILE).toBe('work')
    expect(dispatchEnv.ANTHROPIC_CONFIG_DIR).toBe('/tmp/cfg-work')
    expect(dispatchEnv[BG_SESSION_CREDENTIAL_ENV]).toMatch(/^profile:work:/)

    // #1994/#2000: reconcile persists anchor and refuses drift on respawn
    const establish = {
      short: 'abcd1234',
      source: 'repl',
      launch: { mode: 'prompt' },
      env: { ...dispatchEnv },
    }
    const r1 = await reconcileBgJobCredentialAnchor(establish, false, baseDir)
    expect(r1.refusal).toBeUndefined()
    expect(r1.changed).toBe(true)

    const persisted = await readBgJobCredentialAnchor('abcd1234', baseDir)
    expect(persisted?.ANTHROPIC_PROFILE).toBe('work')

    // Respawn without profile env restores persisted profile anchor
    const wake = {
      short: 'abcd1234',
      source: 'respawn',
      launch: { mode: 'resume' },
      env: {} as Record<string, string>,
    }
    const r2 = await reconcileBgJobCredentialAnchor(wake, true, baseDir)
    expect(r2.refusal).toBeUndefined()
    expect(wake.env.ANTHROPIC_PROFILE).toBe('work')

    // Respawn with conflicting sign-in refuses with drift message
    const drift = {
      short: 'abcd1234',
      source: 'respawn',
      launch: { mode: 'resume' },
      env: { [BG_SESSION_CREDENTIAL_ENV]: 'none' },
    }
    const r3 = await reconcileBgJobCredentialAnchor(drift, false, baseDir)
    expect(r3.refusal).toBe(BG_SIGNIN_DRIFT_MESSAGE)

    // #1994: runtime anchor verification detects missing profile
    const anchor = computeBgSessionCredentialAnchor({
      ANTHROPIC_PROFILE: 'work',
    })
    expect(
      verifyRuntimeBgCredentialAnchor({
        [BG_SESSION_CREDENTIAL_ENV]: anchor.credential,
      }),
    ).toContain('Nothing was sent')

    // #1999: clearPreviousAccountCredentialsFromEnv & switch cleanup
    const workerEnv: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: 'sk-old',
      ANTHROPIC_PROFILE: 'work',
      [BG_SESSION_CREDENTIAL_ENV]: anchor.credential,
    }
    applyWorkerCredentialSwitchCleanup(
      workerEnv,
      { ANTHROPIC_API_KEY: 'sk-old' },
      {
        ANTHROPIC_PROFILE: 'work',
        [BG_SESSION_CREDENTIAL_ENV]: anchor.credential,
      },
    )
    expect(workerEnv.ANTHROPIC_API_KEY).toBeUndefined()
    expect(workerEnv.ANTHROPIC_PROFILE).toBe('work')

    clearPreviousAccountCredentialsFromEnv(workerEnv)
    expect(workerEnv.ANTHROPIC_PROFILE).toBeUndefined()
  })

  test('#2130 Ctrl+B 800ms detach state machine detaches on d and forwards on other key or timeout', async () => {
    expect(CTRL_B_DETACH_WINDOW_MS).toBe(800)

    let detached = 0
    const writes: Buffer[] = []
    const sm1 = createAttachDetachStateMachine({
      onDetach: () => {
        detached++
      },
      onWrite: chunk => writes.push(Buffer.from(chunk)),
      windowMs: 40,
    })
    sm1.feed(Buffer.from([0x02]))
    expect(writes.length).toBe(0)
    sm1.feed(Buffer.from('d'))
    expect(detached).toBe(1)
    expect(writes.length).toBe(0)

    // Non-'d' key forwards held Ctrl+B + key immediately
    const writes2: Buffer[] = []
    let detached2 = 0
    const sm2 = createAttachDetachStateMachine({
      onDetach: () => {
        detached2++
      },
      onWrite: chunk => writes2.push(Buffer.from(chunk)),
      windowMs: 200,
    })
    sm2.feed(Buffer.from([0x02, 0x78])) // Ctrl+B then 'x'
    expect(detached2).toBe(0)
    expect(Buffer.concat(writes2)).toEqual(Buffer.from([0x02, 0x78]))
    sm2.dispose()

    // Timeout expires -> forwards held Ctrl+B
    const writes3: Buffer[] = []
    const sm3 = createAttachDetachStateMachine({
      onDetach: () => {},
      onWrite: chunk => writes3.push(Buffer.from(chunk)),
      windowMs: 25,
    })
    sm3.feed(Buffer.from([0x02]))
    expect(writes3.length).toBe(0)
    await new Promise(r => setTimeout(r, 50))
    expect(Buffer.concat(writes3)).toEqual(Buffer.from([0x02]))
    sm3.dispose()
  })

  test('#2131 snapshotProviderEnv forwards DISABLE_ERROR_REPORTING when truthy', () => {
    const snap = snapshotProviderEnv({
      DISABLE_ERROR_REPORTING: '1',
      CLAUDE_CODE_DISABLE_MCP_TASKS: 'true',
    })
    expect(snap.DISABLE_ERROR_REPORTING).toBe('1')
    expect(snap.CLAUDE_CODE_DISABLE_MCP_TASKS).toBe('1')
    expect(snapshotProviderEnv({}).DISABLE_ERROR_REPORTING).toBeUndefined()
  })

  test('#2132 bgNeedsInput clears on reply and suppresses no-text basic-tools turn end', async () => {
    emitBgNeedsInput('approve Bash: ls', 'permission')
    expect(getBgNeedsInputSnapshot()?.text).toBe('approve Bash: ls')
    await clearBgNeedsInputOnReply()
    expect(getBgNeedsInputSnapshot()).toBeNull()

    expect(
      shouldSuppressTurnEndNeedsInput({
        assistantText: '   ',
        toolNames: ['Bash', 'Read', 'Edit'],
      }),
    ).toBe(true)
    expect(
      shouldSuppressTurnEndNeedsInput({
        assistantText: 'Need clarification?',
        toolNames: ['Bash'],
      }),
    ).toBe(false)
    expect(
      shouldSuppressTurnEndNeedsInput({
        assistantText: '',
        toolNames: ['AskUserQuestion'],
      }),
    ).toBe(false)
  })

  test('#2191 claude rm --help clarifies conversation is kept for claude --resume', async () => {
    const chunks: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(),
      )
      return true
    }) as typeof process.stdout.write
    try {
      await rmHandler('--help')
    } finally {
      process.stdout.write = origWrite
    }
    const out = chunks.join('')
    expect(out).toContain('remove a background session from the list')
    expect(out).toContain(
      'Its conversation is kept: `claude --resume` lists it.',
    )
  })
})
