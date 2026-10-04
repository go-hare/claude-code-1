/**
 * densable 2.1.283 handleClaimSessionRequest (`ne`) @210326103
 * + parked ly/uy/cy @198972656 + unclaimed user O6 @199187468.
 *
 * GOLD SEA /tmp/official-283/package/claude
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFileSync } from 'fs'
import {
  claimSessionRequestSchema,
  CLAIM_ENV_ALLOWLIST,
  checkClaimProjectSettings,
  handleClaimSessionRequest,
  screenClaimPath,
  type ClaimSessionHost,
} from '../claimSession.js'
import {
  getBootstrapSessionHost,
  subscribeProcessEnvChange,
  wasWarmSpareClaimed,
} from '../../utils/sessionHost.js'
import {
  buildNotClaimedExecutionResult,
  isParkedControlSubtypeAllowed,
  isSpareParked,
  isSpareUnclaimed,
  markSpareParked,
  NOT_CLAIMED_BEFORE_FIRST_MESSAGE,
  NOT_CLAIMED_CONTROL_FAILED,
  NOT_CLAIMED_CONTROL_PARKED,
  NOT_CLAIMED_FAILED,
  PARKED_CONTROL_SUBTYPE_ALLOWLIST,
  parkedControlRefusalMessage,
  unclaimedUserRefusalMessage,
} from '../spareClaim.js'
import type { ToolPermissionContext } from '../../Tool.js'

const GOLD = '/tmp/official-283/package/claude'
const gold = (): Buffer => readFileSync(GOLD)

function goldHas(s: string): boolean {
  return gold().includes(Buffer.from(s))
}

const emptyCtx = {
  mode: 'default',
  additionalWorkingDirectories: new Map(),
  alwaysAllowRules: {},
  alwaysDenyRules: {},
  alwaysAskRules: {},
  isBypassPermissionsModeAvailable: false,
} as unknown as ToolPermissionContext

function host(over: Partial<ClaimSessionHost> = {}): ClaimSessionHost {
  let ctx = emptyCtx
  return {
    isBusy: () => false,
    isFreshSession: () => true,
    permissionModeSuppliedOnInvocation: true,
    getToolPermissionContext: () => ctx,
    setToolPermissionContext: next => {
      ctx = next
    },
    applyPromptOptions: () => {},
    currentPermissionMode: () => ctx.mode,
    checkPermissionMode: () => undefined,
    applyPermissionMode: () => undefined,
    recheckAutoModeGate: () => {},
    sdkMcpSettled: () => true,
    startSessionStartHooks: () => {},
    ...over,
  }
}

describe('densable 2.1.283 claim_session ofn / ne', () => {
  afterEach(() => {
    getBootstrapSessionHost().launchOptions.reset()
  })

  test('gold source-lock: not_claimed / not_a_spare / env / cwd / project strings', () => {
    const needles = [
      'not_claimed: this process was started with --await-claim and has not been claimed; send claim_session before the first message',
      'not_claimed: the claim of this spare failed; discard it and start the session normally',
      'not_claimed: this process is a spare waiting for claim_session; send this request after the claim',
      'not_claimed: the claim of this spare failed; discard the process and start the session cold',
      'not_a_spare: claim_session is only accepted by a process started with --await-claim that has not been claimed yet',
      'env_key_not_claimable:',
      'cwd_not_a_directory: the claim cwd is not a directory',
      'cwd_not_found: the claim cwd does not exist or is not accessible',
      'unsafe_path: the claim cwd is a network path or an obfuscated spelling',
      'permission_mode_not_claimable:',
      'project_settings_not_claimable:',
      'claim_session: SessionStart hooks failed (continuing without their output):',
      'busy: a turn is in progress',
      'turn_started: the spare already ran a turn and cannot be claimed',
    ]
    for (const n of needles) {
      expect(goldHas(n)).toBe(true)
    }
    expect(NOT_CLAIMED_BEFORE_FIRST_MESSAGE).toBe(needles[0]!)
    expect(NOT_CLAIMED_FAILED).toBe(needles[1]!)
    expect(NOT_CLAIMED_CONTROL_PARKED).toBe(needles[2]!)
    expect(NOT_CLAIMED_CONTROL_FAILED).toBe(needles[3]!)
  })

  test('ofn schema: cwd required; extra keys fail', () => {
    const ok = claimSessionRequestSchema().safeParse({
      subtype: 'claim_session',
      cwd: '/tmp',
    })
    expect(ok.success).toBe(true)
    const missing = claimSessionRequestSchema().safeParse({
      subtype: 'claim_session',
    })
    expect(missing.success).toBe(false)
    const extra = claimSessionRequestSchema().safeParse({
      subtype: 'claim_session',
      cwd: '/tmp',
      model: 'opus',
    })
    // gold ofn is z.object (strips unknown keys; model is not a claim field)
    expect(extra.success).toBe(true)
    if (extra.success) {
      expect('model' in extra.data).toBe(false)
    }
  })

  test('park allowlist ly: claim_session/initialize true; set_cwd/rewind_files false; unknown true', () => {
    expect(PARKED_CONTROL_SUBTYPE_ALLOWLIST.claim_session).toBe(true)
    expect(PARKED_CONTROL_SUBTYPE_ALLOWLIST.initialize).toBe(true)
    expect(PARKED_CONTROL_SUBTYPE_ALLOWLIST.set_cwd).toBe(false)
    expect(PARKED_CONTROL_SUBTYPE_ALLOWLIST.rewind_files).toBe(false)
    expect(PARKED_CONTROL_SUBTYPE_ALLOWLIST.add_directory).toBe(false)
    expect(isParkedControlSubtypeAllowed('claim_session')).toBe(true)
    expect(isParkedControlSubtypeAllowed('set_cwd')).toBe(false)
    expect(isParkedControlSubtypeAllowed('totally_unknown')).toBe(true)
  })

  test('not_a_spare when not parked', async () => {
    const r = await handleClaimSessionRequest(
      { subtype: 'claim_session', cwd: '/tmp' },
      host(),
    )
    expect(r.kind).toBe('error')
    if (r.kind === 'error') {
      expect(r.message).toBe(
        'not_a_spare: claim_session is only accepted by a process started with --await-claim that has not been claimed yet',
      )
    }
  })

  test('busy / turn_started refusals leave spare parked', async () => {
    markSpareParked()
    const busy = await handleClaimSessionRequest(
      { subtype: 'claim_session', cwd: '/tmp' },
      host({ isBusy: () => true }),
    )
    expect(busy.kind).toBe('error')
    if (busy.kind === 'error') {
      expect(busy.message).toBe('busy: a turn is in progress')
    }
    expect(isSpareParked()).toBe(true)

    const started = await handleClaimSessionRequest(
      { subtype: 'claim_session', cwd: '/tmp' },
      host({ isFreshSession: () => false }),
    )
    expect(started.kind).toBe('error')
    if (started.kind === 'error') {
      expect(started.message).toBe(
        'turn_started: the spare already ran a turn and cannot be claimed',
      )
    }
    expect(isSpareParked()).toBe(true)
  })

  test('env_key_not_claimable rejects CLAUDE_CONFIG_DIR and leaves parked', async () => {
    markSpareParked()
    const r = await handleClaimSessionRequest(
      {
        subtype: 'claim_session',
        cwd: '/tmp',
        env: { CLAUDE_CONFIG_DIR: '/x' },
      },
      host(),
    )
    expect(r.kind).toBe('error')
    if (r.kind === 'error') {
      expect(r.message).toBe(
        "env_key_not_claimable: CLAUDE_CONFIG_DIR is read during start-up; pass it in the spare's spawn env instead",
      )
    }
    expect(isSpareParked()).toBe(true)
    expect(CLAIM_ENV_ALLOWLIST.has('CLAUDE_CODE_OAUTH_TOKEN')).toBe(true)
  })

  test('cwd_not_found / cwd_not_a_directory', async () => {
    markSpareParked()
    const missing = await handleClaimSessionRequest(
      { subtype: 'claim_session', cwd: '/no/such/claim/dir/283' },
      host(),
    )
    expect(missing.kind).toBe('error')
    if (missing.kind === 'error') {
      expect(missing.message).toBe(
        'cwd_not_found: the claim cwd does not exist or is not accessible',
      )
    }

    const file = join(tmpdir(), `claim-ne-file-${Date.now()}`)
    writeFileSync(file, 'x')
    try {
      markSpareParked()
      const notDir = await handleClaimSessionRequest(
        { subtype: 'claim_session', cwd: file },
        host(),
      )
      expect(notDir.kind).toBe('error')
      if (notDir.kind === 'error') {
        expect(notDir.message).toBe(
          'cwd_not_a_directory: the claim cwd is not a directory',
        )
      }
    } finally {
      rmSync(file, { force: true })
    }
  })

  test('unsafe_path screens UNC', () => {
    expect(screenClaimPath('\\\\server\\share', '\\\\server\\share').ok).toBe(
      false,
    )
    expect(screenClaimPath('/tmp', '/tmp').ok).toBe(true)
  })

  test('permission_mode_not_claimable from host check', async () => {
    markSpareParked()
    const dir = mkdtempSync(join(tmpdir(), 'claim-ne-pm-'))
    try {
      const r = await handleClaimSessionRequest(
        {
          subtype: 'claim_session',
          cwd: dir,
          permission_mode: 'bypassPermissions',
        },
        host({
          checkPermissionMode: () =>
            'Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions',
        }),
      )
      expect(r.kind).toBe('error')
      if (r.kind === 'error') {
        expect(r.message.startsWith('permission_mode_not_claimable:')).toBe(
          true,
        )
      }
      expect(isSpareParked()).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('project_settings_not_claimable for env in claimed settings.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claim-ne-ps-'))
    try {
      mkdirSync(join(dir, '.claude'))
      writeFileSync(
        join(dir, '.claude', 'settings.json'),
        JSON.stringify({ env: { FOO: '1' } }),
      )
      const msg = checkClaimProjectSettings(dir, {
        permissionModeSupplied: true,
        modesInPlay: new Set(['default']),
      })
      expect(msg).toContain('project_settings_not_claimable:')
      expect(msg).toContain('settings.json')
      expect(msg).toContain('env')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('cwd bind success: parked → claimed, response status ok', async () => {
    markSpareParked()
    const dir = mkdtempSync(join(tmpdir(), 'claim-ne-ok-'))
    try {
      const r = await handleClaimSessionRequest(
        { subtype: 'claim_session', cwd: dir },
        host(),
      )
      expect(r.kind).toBe('ok')
      if (r.kind === 'ok') {
        expect(r.response.status).toBe('ok')
        expect(r.response.cwd).toBeDefined()
        expect(r.response.session_id).toBeTruthy()
        expect(typeof r.response.sdk_mcp_settled).toBe('boolean')
      }
      expect(isSpareUnclaimed()).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('gold source-lock: DNt / qhe / Mcn / freshSession / deferred-MCP / prepend wait', () => {
    const needles = [
      'function DNt(){',
      'function qhe(){Fc().emit()}',
      'function Mcn(){n().markWarmSpareClaimed()}',
      'directory move: re-deriving start-of-session state for the new directory failed (continuing):',
      'claim_session: starting the held-back MCP servers failed (continuing):',
      "claim_session: the session's own first-turn messages will not run ahead of the host's messages",
      'not queued after',
      'cannotQueue',
      'refused, the claim failed',
      'the input ended first',
    ]
    for (const n of needles) {
      expect(goldHas(n)).toBe(true)
    }
    const claimSrc = readFileSync(
      join(import.meta.dir, '../claimSession.ts'),
      'utf8',
    )
    expect(claimSrc).toContain('resetCredentialCachesAfterClaimEnv')
    expect(claimSrc).toContain('emitProcessEnvChange')
    expect(claimSrc).toContain('markWarmSpareClaimed')
    expect(claimSrc).toContain("profileCheckpointOnce('claim_received')")
    expect(claimSrc).toContain("profileCheckpointOnce('claim_validated')")
    expect(claimSrc).toContain("profileCheckpointOnce('spare_claimed')")
    expect(claimSrc).toContain("headlessProfilerCheckpoint('claim_relocated')")
    expect(claimSrc).toContain('assignStartupContext')
    expect(claimSrc).toContain('spare_parked_ms')
    expect(claimSrc).toContain('spare_claim_ms')
    const cdSrc = readFileSync(
      join(import.meta.dir, '../../commands/cd/cdCommand.tsx'),
      'utf8',
    )
    expect(cdSrc).toContain(
      'directory move: re-deriving start-of-session state for the new directory failed (continuing):',
    )
    const printSrc = readFileSync(join(import.meta.dir, '../print.ts'), 'utf8')
    expect(printSrc).toContain('takeHeldBackMcpConfigs')
    expect(printSrc).toContain(
      "claim_session: the session's own first-turn messages will not run ahead of the host's messages",
    )
    expect(printSrc).toContain('not queued after')
    expect(printSrc).toContain('cannotQueue')
  })

  test('OAUTH/SESSION env applies DNt + qhe + Mcn', async () => {
    markSpareParked()
    const dir = mkdtempSync(join(tmpdir(), 'claim-ne-dnt-'))
    const prevOauth = process.env.CLAUDE_CODE_OAUTH_TOKEN
    const prevHost = process.env.CLAUDE_CODE_HOST_SESSION_ID
    let envEmits = 0
    const unsub = subscribeProcessEnvChange(() => {
      envEmits++
    })
    try {
      const r = await handleClaimSessionRequest(
        {
          subtype: 'claim_session',
          cwd: dir,
          env: {
            CLAUDE_CODE_OAUTH_TOKEN: 'tok-283',
            CLAUDE_CODE_HOST_SESSION_ID: 'host-283',
          },
        },
        host(),
      )
      expect(r.kind).toBe('ok')
      expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok-283')
      expect(process.env.CLAUDE_CODE_HOST_SESSION_ID).toBe('host-283')
      expect(envEmits).toBeGreaterThanOrEqual(1)
      expect(wasWarmSpareClaimed()).toBe(true)
    } finally {
      unsub()
      if (prevOauth === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = prevOauth
      if (prevHost === undefined) delete process.env.CLAUDE_CODE_HOST_SESSION_ID
      else process.env.CLAUDE_CODE_HOST_SESSION_ID = prevHost
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('unclaimed user O6 envelope 1:1 gold', () => {
    markSpareParked()
    const r = buildNotClaimedExecutionResult('sess-1')
    expect(r.type).toBe('result')
    expect(r.subtype).toBe('error_during_execution')
    expect(r.is_error).toBe(true)
    expect(r.errors).toEqual([NOT_CLAIMED_BEFORE_FIRST_MESSAGE])
    expect(r.session_id).toBe('sess-1')
    expect('startup_failure_reason' in r).toBe(false)
    expect(parkedControlRefusalMessage()).toBe(NOT_CLAIMED_CONTROL_PARKED)
    expect(unclaimedUserRefusalMessage()).toBe(NOT_CLAIMED_BEFORE_FIRST_MESSAGE)
  })
})
