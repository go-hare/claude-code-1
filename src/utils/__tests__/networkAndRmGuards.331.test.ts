/**
 * Official Claude Code 2.1.331 alignment tests:
 * 1. Bash dangerous `rm` empty-variable guard (`ZQ`, `Ast`, `Bkn`, `Hkn`, `Ukn`, `HLr`, `KPs`).
 * 2. Outbound model API redirect refusal (`RedirectRefused`, `CLAUDE_CODE_DISABLE_REDIRECT_CHECK`,
 *    `tengu_nifty_chipmunk`) + `CLAUDE_CODE_DISABLE_RESPONSE_COMPRESSION` (`tengu_velvety_duckling`).
 * 3. Proxy `http://` IdP SSRF block (`ECONNREFUSED_SSRF`, `IdpProxyAgent`, `y$`) +
 *    HTTP Proxy `CONNECT` request/response parser hardening (`Oe`, `so`, `IUo`).
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import type http from 'http'
import net from 'net'
import { Readable } from 'stream'
import { APIError } from '@anthropic-ai/sdk'
import { formatAPIError } from 'src/services/api/errorUtils.js'
import { BashTool } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import {
  DANGEROUS_RM_GUARD_FLAG,
  detectDangerousVariableRm,
  getDangerousRmBypassWaiverNotice,
  getGuardedRmLine,
  type GuardedPermissionAskDecision,
  isDangerousRmGuardEnabled,
  MAX_GUARDABLE_RM_COMMAND_LENGTH,
  MAX_GUARDED_RM_REASON_LENGTH,
  replaceSafetyCheckReason,
  rewriteDangerousRmWithGuard,
  type SafetyCheckDecisionReason,
  tryGuardDangerousRmAsk,
} from '@claude-code/builtin-tools/tools/BashTool/dangerousRmGuard.js'
import {
  applyResponseCompressionPolicy,
  createRedirectRefusedError,
  getModelRedirectTrackingState,
  isAnthropicApiHost,
  isRedirectRefusedError,
  parseTriBoolEnv,
  resetApiRedirectCountsForTests,
  runWithModelRedirectTracking,
  shouldDisableResponseCompression,
  wrapFetchWithModelRedirectGuard,
} from 'src/services/api/modelRedirectGuard.js'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import type { PermissionDecisionReason } from 'src/types/permissions.js'
import { TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/utils/errors.js'
import {
  assertSafeIdpProxyTarget,
  buildConnectRequestLines,
  createIdpProxyAgent,
  ERR_PROXY_TUNNEL_CODE,
  HardenedHttpsProxyAgent,
  IdpProxyAgent,
  isBlockedLoopbackOrMetadataHost,
  MAX_PROXY_CONNECT_HEADER_BYTES,
  parseProxyConnectResponse,
  SecureHttpsProxyAgent,
} from 'src/utils/proxy.js'

// ============================================================================
// Area 1: Bash dangerous `rm` empty-variable guard (2.1.331)
// ============================================================================

describe('2.1.331 Area 1: Bash dangerous rm empty-variable guard', () => {
  test('detectDangerousVariableRm classifies variable_path, var_root_child, assigned, and derived', () => {
    const varPath = detectDangerousVariableRm('rm -rf $FOO/*', {
      mayBeUnset: () => true,
    })
    expect(varPath).not.toBeNull()
    expect(varPath?.command).toBe('rm')
    expect(varPath?.target).toBe('$FOO/*')
    expect(varPath?.removalRule).toBe('variable_path')

    const rootChild = detectDangerousVariableRm('rm -rf $DIR/etc', {
      mayBeUnset: () => true,
    })
    expect(rootChild).not.toBeNull()
    expect(rootChild?.rootChild).toBe('etc')
    expect(rootChild?.removalRule).toBe('var_root_child')

    const rootChildGlob = detectDangerousVariableRm('rm -rf "${ROOT}/usr/*"', {
      mayBeUnset: () => true,
    })
    expect(rootChildGlob).not.toBeNull()
    expect(rootChildGlob?.rootChild).toBe('usr')
    expect(rootChildGlob?.removalRule).toBe('var_root_child')

    const assigned = detectDangerousVariableRm('FOO=/tmp/work; rm -rf $FOO/*', {
      mayBeUnset: () => true,
    })
    expect(assigned).not.toBeNull()
    expect(assigned?.assigned).toBe(true)
    expect(assigned?.removalRule).toBe('variable_path_set_in_command')

    const derived = detectDangerousVariableRm('DIR=$(pwd); rm -rf $DIR/*', {
      mayBeUnset: () => true,
    })
    expect(derived).not.toBeNull()
    expect(derived?.derived?.becomes).toBe('prints the current directory')
    expect(derived?.removalRule).toBe('derived_var')

    expect(
      detectDangerousVariableRm('rm -rf /tmp/project/dist', {
        mayBeUnset: () => true,
      }),
    ).toBeNull()
    expect(
      detectDangerousVariableRm('ls $DIR/*', { mayBeUnset: () => true }),
    ).toBeNull()
  })

  test('rewriteDangerousRmWithGuard (Ast) rewrites eligible variable_path & var_root_child commands', () => {
    expect(rewriteDangerousRmWithGuard('rm -rf $FOO/*')).toEqual({
      line: 'rm -rf ${FOO:?}/*',
      variables: '$FOO',
      wholeTree: true,
      nameUsedElsewhere: false,
    })
    expect(getGuardedRmLine('rm -rf $FOO/*')).toBe('rm -rf ${FOO:?}/*')

    expect(rewriteDangerousRmWithGuard('rm -rf "${DIR}"/*')).toEqual({
      line: 'rm -rf "${DIR:?}"/*',
      variables: '$DIR',
      wholeTree: true,
      nameUsedElsewhere: false,
    })

    expect(rewriteDangerousRmWithGuard('rm -rf $FOO/etc')).toEqual({
      line: 'rm -rf ${FOO:?}/etc',
      variables: '$FOO',
      wholeTree: false,
      nameUsedElsewhere: false,
    })

    expect(
      rewriteDangerousRmWithGuard('rm -rf $BUILD_DIR/* 2>/dev/null; echo ok'),
    ).toEqual({
      line: 'rm -rf ${BUILD_DIR:?}/* 2>/dev/null; echo ok',
      variables: '$BUILD_DIR',
      wholeTree: true,
      nameUsedElsewhere: false,
    })

    expect(rewriteDangerousRmWithGuard('rm -rf $FOO/*; echo $FOO')).toEqual({
      line: 'rm -rf ${FOO:?}/*; echo $FOO',
      variables: '$FOO',
      wholeTree: true,
      nameUsedElsewhere: true,
    })
  })

  test('rewriteDangerousRmWithGuard refuses unsafe or ineligible commands', () => {
    // Well-known env vars are excluded (wst)
    expect(rewriteDangerousRmWithGuard('rm -rf $HOME/*')).toBeUndefined()
    expect(rewriteDangerousRmWithGuard('rm -rf $TMPDIR/*')).toBeUndefined()
    expect(rewriteDangerousRmWithGuard('rm -rf $PWD/*')).toBeUndefined()
    expect(rewriteDangerousRmWithGuard('rm -rf $USERPROFILE/*')).toBeUndefined()

    // Non-recursive rm or rmdir
    expect(rewriteDangerousRmWithGuard('rm -f $FOO/*')).toBeUndefined()
    expect(rewriteDangerousRmWithGuard('rmdir $FOO/')).toBeUndefined()

    // Already guarded
    expect(rewriteDangerousRmWithGuard('rm -rf ${FOO:?}/*')).toBeUndefined()

    // Multiple positional targets or flags after --
    expect(
      rewriteDangerousRmWithGuard('rm -rf $FOO/* /tmp/other'),
    ).toBeUndefined()
    expect(rewriteDangerousRmWithGuard('rm -- $FOO/* -rf')).toBeUndefined()

    // Assigned or derived in same command
    expect(
      rewriteDangerousRmWithGuard('FOO=/tmp/work; rm -rf $FOO/*'),
    ).toBeUndefined()
    expect(
      rewriteDangerousRmWithGuard('FOO=$(pwd); rm -rf $FOO/*'),
    ).toBeUndefined()

    // Heredoc, ANSI-C quoting, xargs, dotdot, backticks, reparsed
    expect(
      rewriteDangerousRmWithGuard('cat <<EOF\nhi\nEOF\nrm -rf $FOO/*'),
    ).toBeUndefined()
    expect(
      rewriteDangerousRmWithGuard("echo $'hi'; rm -rf $FOO/*"),
    ).toBeUndefined()
    expect(
      rewriteDangerousRmWithGuard('echo a | xargs rm -rf $FOO/*'),
    ).toBeUndefined()
    expect(rewriteDangerousRmWithGuard('rm -rf $FOO/../*')).toBeUndefined()
    expect(
      rewriteDangerousRmWithGuard('bash -c "rm -rf $FOO/*"'),
    ).toBeUndefined()
    expect(rewriteDangerousRmWithGuard('eval "rm -rf $FOO/*"')).toBeUndefined()

    // Two unguarded dangerous rms on one line (re-check ZQ(y) !== null)
    expect(
      rewriteDangerousRmWithGuard('rm -rf $FOO/*; rm -rf $BAR/*'),
    ).toBeUndefined()

    // Exceeds MAX_GUARDABLE_RM_COMMAND_LENGTH
    const huge = `rm -rf $FOO/* # ${'a'.repeat(MAX_GUARDABLE_RM_COMMAND_LENGTH)}`
    expect(rewriteDangerousRmWithGuard(huge)).toBeUndefined()
  })

  test('tryGuardDangerousRmAsk (Ukn) rewrites variable_path & var_root_child, emits analytics, and sets official copy', () => {
    const emitted: string[] = []
    const makeAsk = (
      removalRule: string,
      reason = 'Dangerous rm operation on possibly-empty variable path',
    ): {
      ask: GuardedPermissionAskDecision<{ command: string; _host?: string }>
      reasonObj: SafetyCheckDecisionReason
    } => {
      const reasonObj: SafetyCheckDecisionReason = {
        type: 'safetyCheck',
        reason,
        classifierApprovable: false,
        circuitBreaker: 'dangerousRemoval',
        removalRule,
      }
      return {
        reasonObj,
        ask: {
          behavior: 'ask',
          message: 'Dangerous rm',
          decisionReason: reasonObj as PermissionDecisionReason,
          suggestions: [],
        },
      }
    }

    // 1. variable_path wholeTree
    const input1 = { command: 'rm -rf $BUILD_DIR/*' }
    const { ask: ask1, reasonObj: r1 } = makeAsk('variable_path')
    const guarded1 = tryGuardDangerousRmAsk(input1, ask1, r1, false, {
      isGateEnabled: () => true,
      emitEvent: name => emitted.push(name),
    })
    expect(guarded1).toBeDefined()
    expect(guarded1?.updatedInput).toEqual({
      command: 'rm -rf ${BUILD_DIR:?}/*',
    })
    expect(guarded1?.judgedInput).toBe(input1)
    expect(emitted).toEqual(['tengu_bash_dangerous_rm_guarded'])
    expect(
      guarded1?.decisionReason?.type === 'safetyCheck'
        ? guarded1.decisionReason.reason
        : '',
    ).toBe(
      "Dangerous rm operation on possibly-empty variable path. If $BUILD_DIR holds a wrong path, even /, this rm removes everything under it. Claude Code added a check to this rm, so if $BUILD_DIR is empty or unset, this rm doesn't run and later steps may stop too.",
    )

    // 2. var_root_child (wholeTree = false)
    const input2 = { command: 'rm -rf $PREFIX/etc' }
    const { ask: ask2, reasonObj: r2 } = makeAsk('var_root_child')
    const guarded2 = tryGuardDangerousRmAsk(input2, ask2, r2, false, {
      isGateEnabled: () => true,
      emitEvent: name => emitted.push(name),
    })
    expect(guarded2?.updatedInput).toEqual({
      command: 'rm -rf ${PREFIX:?}/etc',
    })
    expect(
      guarded2?.decisionReason?.type === 'safetyCheck'
        ? guarded2.decisionReason.reason
        : '',
    ).toBe(
      "Dangerous rm operation on possibly-empty variable path. If $PREFIX holds a wrong path, even /, this rm removes the path it names. Claude Code added a check to this rm, so if $PREFIX is empty or unset, this rm doesn't run and later steps may stop too.",
    )

    // 3. nameUsedElsewhere: skipped without force, included with force + extra sentence
    const input3 = { command: 'rm -rf $DIR/*; echo $DIR' }
    const { ask: ask3, reasonObj: r3 } = makeAsk('variable_path')
    expect(
      tryGuardDangerousRmAsk(input3, ask3, r3, false, {
        isGateEnabled: () => true,
        emitEvent: name => emitted.push(name),
      }),
    ).toBeUndefined()
    const guarded3 = tryGuardDangerousRmAsk(input3, ask3, r3, true, {
      isGateEnabled: () => false,
      emitEvent: name => emitted.push(name),
    })
    expect(guarded3?.updatedInput).toEqual({
      command: 'rm -rf ${DIR:?}/*; echo $DIR',
    })
    expect(
      guarded3?.decisionReason?.type === 'safetyCheck'
        ? guarded3.decisionReason.reason
        : '',
    ).toContain('Steps that still run see an empty value.')

    // 4. Long variable name falls back to generic phrasing when > Cst (300)
    const longVar = 'A'.repeat(60)
    const input4 = { command: `rm -rf $${longVar}/*` }
    const { ask: ask4, reasonObj: r4 } = makeAsk('variable_path')
    const guarded4 = tryGuardDangerousRmAsk(input4, ask4, r4, true, {
      emitEvent: () => {},
    })
    const reason4 =
      guarded4?.decisionReason?.type === 'safetyCheck'
        ? guarded4.decisionReason.reason
        : ''
    expect(reason4.length).toBeLessThanOrEqual(MAX_GUARDED_RM_REASON_LENGTH)
    expect(reason4).toContain('If a variable here holds a wrong path, even /')

    // 5. Nested subcommandResults Map replaced via Hkn
    const innerReason: SafetyCheckDecisionReason = {
      type: 'safetyCheck',
      reason: 'orig',
      classifierApprovable: false,
      circuitBreaker: 'dangerousRemoval',
      removalRule: 'variable_path',
    }
    const compoundDecision: PermissionDecisionReason = {
      type: 'subcommandResults',
      reasons: new Map([
        [
          'rm -rf $FOO/*',
          {
            behavior: 'ask',
            message: 'ask',
            decisionReason: innerReason as PermissionDecisionReason,
          },
        ],
      ]),
    }
    const replaced = replaceSafetyCheckReason(
      compoundDecision,
      innerReason as PermissionDecisionReason,
      'updated reason',
    )
    expect(replaced.type).toBe('subcommandResults')
    if (replaced.type === 'subcommandResults') {
      const sub = replaced.reasons.get('rm -rf $FOO/*')
      expect(
        sub?.decisionReason?.type === 'safetyCheck'
          ? sub.decisionReason.reason
          : '',
      ).toBe('updated reason')
    }

    // 6. Refuses when gate off, non-matching removalRule, hostDisplay set,
    // updatedInput diverges, or remote _host is set
    expect(
      tryGuardDangerousRmAsk(input1, ask1, r1, false, {
        isGateEnabled: () => false,
        emitEvent: () => {},
      }),
    ).toBeUndefined()
    expect(
      tryGuardDangerousRmAsk(
        input1,
        ask1,
        { ...r1, removalRule: 'critical_path' },
        true,
        { emitEvent: () => {} },
      ),
    ).toBeUndefined()
    expect(
      tryGuardDangerousRmAsk(
        input1,
        { ...ask1, hostDisplay: { label: 'custom' } },
        r1,
        true,
        { emitEvent: () => {} },
      ),
    ).toBeUndefined()
    expect(
      tryGuardDangerousRmAsk(
        input1,
        { ...ask1, updatedInput: { command: 'rm -rf /other' } },
        r1,
        true,
        { emitEvent: () => {} },
      ),
    ).toBeUndefined()
    expect(
      tryGuardDangerousRmAsk(
        { command: 'rm -rf $BUILD_DIR/*', _host: 'remote-box' },
        ask1,
        r1,
        true,
        { emitEvent: () => {} },
      ),
    ).toBeUndefined()
    // Local host names (`this-machine`, `container`) are allowed
    expect(
      tryGuardDangerousRmAsk(
        { command: 'rm -rf $BUILD_DIR/*', _host: 'this-machine' },
        ask1,
        r1,
        true,
        { emitEvent: () => {} },
      )?.updatedInput?.command,
    ).toBe('rm -rf ${BUILD_DIR:?}/*')
  })

  test('isDangerousRmGuardEnabled (HLr) requires non-interactive + anthropic_cloud + tengu_purring_naur=variable_path', () => {
    expect(DANGEROUS_RM_GUARD_FLAG).toBe('tengu_purring_naur')
    expect(
      isDangerousRmGuardEnabled({
        isNonInteractive: true,
        env: {
          CLAUDE_CODE_REMOTE: '1',
          CLAUDE_CODE_ENVIRONMENT_KIND: 'anthropic_cloud',
        },
        flagValue: 'variable_path',
      }),
    ).toBe(true)
    expect(
      isDangerousRmGuardEnabled({
        isNonInteractive: false,
        env: {
          CLAUDE_CODE_REMOTE: '1',
          CLAUDE_CODE_ENVIRONMENT_KIND: 'anthropic_cloud',
        },
        flagValue: 'variable_path',
      }),
    ).toBe(false)
    expect(
      isDangerousRmGuardEnabled({
        isNonInteractive: true,
        env: {
          CLAUDE_CODE_REMOTE: '1',
          CLAUDE_CODE_ENVIRONMENT_KIND: 'byoc',
        },
        flagValue: 'variable_path',
      }),
    ).toBe(false)
    expect(
      isDangerousRmGuardEnabled({
        isNonInteractive: true,
        env: {
          CLAUDE_CODE_REMOTE: '1',
          CLAUDE_CODE_ENVIRONMENT_KIND: 'anthropic_cloud',
        },
        flagValue: 'off',
      }),
    ).toBe(false)
  })

  test('BashTool exposes guardedRemovalAsk and guardedLineOf matching 2.1.331 Si', () => {
    expect(BashTool.guardedRemovalAsk).toBe(tryGuardDangerousRmAsk)
    expect(BashTool.guardedLineOf).toBe(getGuardedRmLine)
    expect(BashTool.guardedLineOf('rm -rf $FOO/*')).toBe('rm -rf ${FOO:?}/*')
  })

  test('getDangerousRmBypassWaiverNotice (KPs) produces exact 2.1.331 copy', () => {
    const bypassCtx = {
      ...getEmptyToolPermissionContext(),
      mode: 'bypassPermissions' as const,
      isBypassPermissionsModeAvailable: true,
    }
    // Unset env or child session -> undefined
    expect(
      getDangerousRmBypassWaiverNotice(bypassCtx, { env: {} }),
    ).toBeUndefined()
    expect(
      getDangerousRmBypassWaiverNotice(bypassCtx, {
        env: {
          CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS: '1',
          CLAUDE_CODE_CHILD_SESSION: '1',
        },
      }),
    ).toBeUndefined()

    // Waiver disqualified + chrome floor lifts present -> exact 2.1.331 copy
    expect(
      getDangerousRmBypassWaiverNotice(bypassCtx, {
        env: { CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS: '1' },
        removalWaiverAllowed: false,
        hasChromeFloorLifts: true,
      }),
    ).toBe(
      'CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS has no effect on dangerous rm commands in this session: they keep their usual checks.',
    )

    // Waiver disqualified without chrome floor lifts
    expect(
      getDangerousRmBypassWaiverNotice(bypassCtx, {
        env: { CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS: '1' },
        removalWaiverAllowed: false,
        hasChromeFloorLifts: false,
      }),
    ).toBe(
      'CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS has no effect in this session: dangerous rm commands keep their usual checks.',
    )

    // Windows registry unreadable
    expect(
      getDangerousRmBypassWaiverNotice(bypassCtx, {
        env: { CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS: '1' },
        removalWaiverAllowed: true,
        isWindows: true,
        windowsRegistryReadable: false,
      }),
    ).toBe(
      "CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS has no effect while the Windows registry cannot be read for managed settings: dangerous rm commands keep their usual checks, and can run without a prompt in bypass permissions mode if the registry later becomes readable. If you didn't set it, check your shell profile.",
    )

    // Active waiver notice
    expect(
      getDangerousRmBypassWaiverNotice(bypassCtx, {
        env: { CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS: '1' },
        removalWaiverAllowed: true,
        isWindows: false,
      }),
    ).toBe(
      "CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS is set, so dangerous rm commands can run without a prompt in bypass permissions mode once managed settings and plugin hooks have loaded. If you didn't set it, check your shell profile.",
    )
  })
})

// ============================================================================
// Area 2: Outbound model API redirect refusal & response compression (2.1.331)
// ============================================================================

describe('2.1.331 Area 2: Model API RedirectRefused & CLAUDE_CODE_DISABLE_RESPONSE_COMPRESSION', () => {
  afterEach(() => {
    resetApiRedirectCountsForTests()
  })

  test('isAnthropicApiHost (DUr) matches only api(-staging)?.anthropic.com', () => {
    expect(isAnthropicApiHost('https://api.anthropic.com/v1/messages')).toBe(
      true,
    )
    expect(
      isAnthropicApiHost('https://api-staging.anthropic.com/v1/messages'),
    ).toBe(true)
    expect(isAnthropicApiHost('https://api.anthropic.com./v1/messages')).toBe(
      true,
    )
    expect(isAnthropicApiHost('https://evil.anthropic.com/v1/messages')).toBe(
      false,
    )
    expect(
      isAnthropicApiHost('https://api.anthropic.com.evil.com/v1/messages'),
    ).toBe(false)
    expect(isAnthropicApiHost('https://example.com/v1/messages')).toBe(false)
  })

  test('refuses cross-origin 302 redirect on model API POST with RedirectRefused and marks ALS state', async () => {
    const seenRedirects: Array<string | undefined> = []
    const mockFetch = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      seenRedirects.push(init?.redirect)
      if (init?.redirect === 'error') {
        throw Object.assign(new Error('unexpected redirect'), {
          code: 'UnexpectedRedirect',
        })
      }
      return new Response(null, {
        status: 302,
        headers: { location: 'https://portal.corp.local/login' },
      })
    }

    const guarded = wrapFetchWithModelRedirectGuard(mockFetch, {
      env: {},
      killswitchValue: true,
    })

    const trackingState: { modelCallRefused?: boolean } = {}
    let caught: unknown
    await runWithModelRedirectTracking(async () => {
      try {
        await guarded('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          body: '{"model":"claude"}',
        })
      } catch (err) {
        caught = err
      }
      expect(getModelRedirectTrackingState()?.modelCallRefused).toBe(true)
    }, trackingState)

    expect(isRedirectRefusedError(caught)).toBe(true)
    expect((caught as Error).message).toBe(
      'Claude Code refused a redirect of this request',
    )
    expect((caught as { code?: string }).code).toBe('RedirectRefused')
    expect(trackingState.modelCallRefused).toBe(true)
    expect(seenRedirects).toEqual(['error', 'manual'])
  })

  test('refuses same-origin 301/302/303 and https->http downgrade, and recognizes cause-chain unexpected redirect', async () => {
    for (const [status, location] of [
      [301, 'https://api.anthropic.com/v1/messages2'],
      [302, 'https://api.anthropic.com/v1/messages2'],
      [303, 'https://api.anthropic.com/v1/messages2'],
      [307, 'http://api.anthropic.com/v1/messages'],
      [308, 'https://other.example.com/v1/messages'],
      [307, ''],
    ] as const) {
      const mockFetch = async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        if (init?.redirect === 'error') {
          throw new TypeError('fetch failed', {
            cause: new Error('unexpected redirect'),
          })
        }
        return new Response(null, {
          status,
          headers: location ? { location } : {},
        })
      }
      const guarded = wrapFetchWithModelRedirectGuard(mockFetch, {
        env: {},
        killswitchValue: true,
      })
      await expect(
        guarded('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          body: '{}',
        }),
      ).rejects.toMatchObject({
        message: 'Claude Code refused a redirect of this request',
        code: 'RedirectRefused',
      })
    }
  })

  test('follows safe same-origin 307/308 redirects up to 5 hops and refuses the 6th hop', async () => {
    // 2 safe hops -> succeeds
    let calls = 0
    const twoHopFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      calls++
      if (init?.redirect === 'error') {
        throw Object.assign(new Error('unexpected redirect'), {
          code: 'UnexpectedRedirect',
        })
      }
      const url = String(input)
      if (url.endsWith('/v1/messages')) {
        return new Response(null, {
          status: 307,
          headers: { location: '/v1/messages?hop=1' },
        })
      }
      if (url.endsWith('hop=1')) {
        return new Response(null, {
          status: 308,
          headers: { location: 'https://api.anthropic.com/v1/messages?hop=2' },
        })
      }
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'request-id': 'req_test123' },
      })
    }
    const guarded = wrapFetchWithModelRedirectGuard(twoHopFetch, {
      env: {},
      killswitchValue: true,
    })
    const res = await guarded('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: '{"hello":"world"}',
    })
    expect(res.status).toBe(200)
    expect(calls).toBe(4) // 1 error + 3 manual

    // Infinite same-origin 307 loop -> refused at hop === 5
    const loopFetch = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      if (init?.redirect === 'error') {
        throw Object.assign(new Error('unexpected redirect'), {
          code: 'UnexpectedRedirect',
        })
      }
      return new Response(null, {
        status: 307,
        headers: { location: 'https://api.anthropic.com/v1/messages' },
      })
    }
    const guardedLoop = wrapFetchWithModelRedirectGuard(loopFetch, {
      env: {},
      killswitchValue: true,
    })
    await expect(
      guardedLoop('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        body: '{}',
      }),
    ).rejects.toMatchObject({ code: 'RedirectRefused' })
  })

  test('CLAUDE_CODE_DISABLE_REDIRECT_CHECK=1, killswitch off, non-POST, and non-Anthropic hosts bypass redirect check', async () => {
    const capturedInits: Array<RequestInit | undefined> = []
    const passFetch = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      capturedInits.push(init)
      return new Response('ok', { status: 200 })
    }

    const disabledByEnv = wrapFetchWithModelRedirectGuard(passFetch, {
      env: { CLAUDE_CODE_DISABLE_REDIRECT_CHECK: '1' },
      killswitchValue: true,
    })
    await disabledByEnv('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: '{}',
    })
    expect(capturedInits.at(-1)?.redirect).toBeUndefined()

    const disabledByKillswitch = wrapFetchWithModelRedirectGuard(passFetch, {
      env: {},
      killswitchValue: false,
    })
    await disabledByKillswitch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: '{}',
    })
    expect(capturedInits.at(-1)?.redirect).toBeUndefined()

    const enabled = wrapFetchWithModelRedirectGuard(passFetch, {
      env: {},
      killswitchValue: true,
    })
    await enabled('https://api.anthropic.com/v1/models', { method: 'GET' })
    expect(capturedInits.at(-1)?.redirect).toBeUndefined()

    await enabled('https://custom-gateway.corp/v1/messages', {
      method: 'POST',
      body: '{}',
    })
    expect(capturedInits.at(-1)?.redirect).toBeUndefined()
  })

  test('formatAPIError formats RedirectRefused with official 2.1.331 copy', () => {
    const err = new APIError(
      undefined,
      undefined,
      'Connection error.',
      undefined,
    )
    Object.assign(err, { cause: createRedirectRefusedError() })
    expect(formatAPIError(err)).toBe(
      "Unable to connect to API: sign in to network or proxy. The request was redirected (RedirectRefused). If that does not help, ask the network's administrator to let api.anthropic.com through",
    )
  })

  test('CLAUDE_CODE_DISABLE_RESPONSE_COMPRESSION & tengu_velvety_duckling set accept-encoding: identity 1:1 with 2.1.331', () => {
    expect(parseTriBoolEnv('1')).toBe(true)
    expect(parseTriBoolEnv('0')).toBe(false)
    expect(parseTriBoolEnv(undefined)).toBeUndefined()

    const proxyEnv = { HTTPS_PROXY: 'http://proxy.corp:8080' }

    // 1. Explicit env=1 sets accept-encoding: identity on proxied HTTPS
    const h1 = new Headers()
    expect(
      applyResponseCompressionPolicy(
        'https://api.anthropic.com/v1/messages',
        h1,
        {
          provider: 'firstParty',
          env: { ...proxyEnv, CLAUDE_CODE_DISABLE_RESPONSE_COMPRESSION: '1' },
          isDiskless: false,
          gbValue: false,
        },
      ),
    ).toBe(true)
    expect(h1.get('accept-encoding')).toBe('identity')

    // 2. Gate tengu_velvety_duckling=true enables it for firstParty when env unset
    const h2 = new Headers()
    expect(
      applyResponseCompressionPolicy(
        'https://api.anthropic.com/v1/messages',
        h2,
        {
          provider: 'firstParty',
          env: proxyEnv,
          isDiskless: false,
          gbValue: true,
        },
      ),
    ).toBe(true)
    expect(h2.get('accept-encoding')).toBe('identity')

    // 3. Explicit env=0 overrides gate tengu_velvety_duckling=true
    const h3 = new Headers()
    expect(
      applyResponseCompressionPolicy(
        'https://api.anthropic.com/v1/messages',
        h3,
        {
          provider: 'firstParty',
          env: { ...proxyEnv, CLAUDE_CODE_DISABLE_RESPONSE_COMPRESSION: '0' },
          isDiskless: false,
          gbValue: true,
        },
      ),
    ).toBe(false)
    expect(h3.has('accept-encoding')).toBe(false)

    // 4. Respects existing accept-encoding, non-HTTPS, unix socket, no proxy, NO_PROXY
    expect(
      shouldDisableResponseCompression({
        url: 'https://api.anthropic.com/v1/messages',
        headers: new Headers({ 'accept-encoding': 'gzip' }),
        provider: 'firstParty',
        env: { ...proxyEnv, CLAUDE_CODE_DISABLE_RESPONSE_COMPRESSION: '1' },
      }),
    ).toBe(false)
    expect(
      shouldDisableResponseCompression({
        url: 'http://api.anthropic.com/v1/messages',
        headers: new Headers(),
        provider: 'firstParty',
        env: { ...proxyEnv, CLAUDE_CODE_DISABLE_RESPONSE_COMPRESSION: '1' },
      }),
    ).toBe(false)
    expect(
      shouldDisableResponseCompression({
        url: 'https://api.anthropic.com/v1/messages',
        headers: new Headers(),
        unix: '/tmp/ssh.sock',
        provider: 'firstParty',
        env: { ...proxyEnv, CLAUDE_CODE_DISABLE_RESPONSE_COMPRESSION: '1' },
      }),
    ).toBe(false)
    expect(
      shouldDisableResponseCompression({
        url: 'https://api.anthropic.com/v1/messages',
        headers: new Headers(),
        provider: 'firstParty',
        env: { CLAUDE_CODE_DISABLE_RESPONSE_COMPRESSION: '1' },
      }),
    ).toBe(false)
    expect(
      shouldDisableResponseCompression({
        url: 'https://api.anthropic.com/v1/messages',
        headers: new Headers(),
        provider: 'firstParty',
        env: {
          ...proxyEnv,
          NO_PROXY: 'api.anthropic.com',
          CLAUDE_CODE_DISABLE_RESPONSE_COMPRESSION: '1',
        },
      }),
    ).toBe(false)

    // 5. Gate-only path skips non-firstParty, remote cloud, and diskless mode
    expect(
      shouldDisableResponseCompression({
        url: 'https://bedrock-runtime.us-east-1.amazonaws.com/model',
        headers: new Headers(),
        provider: 'bedrock',
        env: proxyEnv,
        isDiskless: false,
        gbValue: true,
      }),
    ).toBe(false)
    expect(
      shouldDisableResponseCompression({
        url: 'https://api.anthropic.com/v1/messages',
        headers: new Headers(),
        provider: 'firstParty',
        env: { ...proxyEnv, CLAUDE_CODE_REMOTE: '1' },
        isDiskless: false,
        gbValue: true,
      }),
    ).toBe(false)
    expect(
      shouldDisableResponseCompression({
        url: 'https://api.anthropic.com/v1/messages',
        headers: new Headers(),
        provider: 'firstParty',
        env: proxyEnv,
        isDiskless: true,
        gbValue: true,
      }),
    ).toBe(false)
  })
})

// ============================================================================
// Area 3: Proxy http:// IdP SSRF block & CONNECT parser hardening (2.1.331)
// ============================================================================

async function withMockProxyServer(
  onConnection: (socket: net.Socket, received: string) => void,
  run: (proxyUrl: string) => Promise<void>,
): Promise<void> {
  const server = net.createServer(socket => {
    let data = ''
    socket.on('data', chunk => {
      data += chunk.toString('latin1')
      if (data.includes('\r\n\r\n')) {
        onConnection(socket, data)
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as net.AddressInfo
  try {
    await run(`http://127.0.0.1:${addr.port}`)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

describe('2.1.331 Area 3: IdP http:// SSRF block & Proxy CONNECT parser hardening', () => {
  test('isBlockedLoopbackOrMetadataHost (y$) blocks loopback, link-local, metadata, and IPv6-embedded IPv4', () => {
    const blocked = [
      '',
      'localhost',
      'sub.localhost',
      'localhost.',
      '127.0.0.1',
      '127.255.0.1',
      '0.0.0.0',
      '169.254.169.254',
      '100.100.100.200',
      '168.63.129.16',
      '192.0.0.192',
      'metadata.google.internal',
      'metadata.goog',
      'metadata',
      'instance-data',
      'instance-data.ec2.internal',
      'instance-data.us-east-1.compute.internal',
      'ip6-localhost',
      '::1',
      '[::1]',
      '::',
      'fe80::1',
      'fd00:ec2::254',
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
      '64:ff9b::169.254.169.254',
      '64:ff9b:1::1',
      '2002:7f00:0001::1',
      '2001:db8::5efe:169.254.169.254',
    ]
    for (const host of blocked) {
      expect(isBlockedLoopbackOrMetadataHost(host)).toBe(true)
    }

    const allowed = [
      'idp.example.com',
      'login.microsoftonline.com',
      '8.8.8.8',
      '1.1.1.1',
      '2606:4700:4700::1111',
    ]
    for (const host of allowed) {
      expect(isBlockedLoopbackOrMetadataHost(host)).toBe(false)
    }
  })

  test('IdpProxyAgent (Bd) blocks http:// IdP endpoints via proxy with ECONNREFUSED_SSRF', async () => {
    const agent = createIdpProxyAgent('http://127.0.0.1:8080', 'FAKE-CA-PEM', {
      connectByHostname: true,
    })
    expect(agent).toBeInstanceOf(IdpProxyAgent)
    expect(agent.options.ca).toBe('FAKE-CA-PEM')

    const fakeReq = new EventEmitter() as unknown as http.ClientRequest
    let caught: unknown
    try {
      await agent.connect(fakeReq, {
        host: 'idp.corp.example',
        port: 80,
        secureEndpoint: false,
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(
      TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    )
    expect((caught as { code?: string }).code).toBe('ECONNREFUSED_SSRF')
    expect(
      (caught as TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
        .telemetryMessage,
    ).toBe('ECONNREFUSED_SSRF: blocked http:// IdP endpoint via proxy')
    expect((caught as Error).message).toContain(
      'ECONNREFUSED_SSRF: blocked http://idp.corp.example:80 via proxy',
    )
    expect((caught as Error).message).toContain('NO_PROXY')

    // Loopback/metadata host via proxy is also blocked even for https
    let ssrfErr: unknown
    try {
      await agent.connect(fakeReq, {
        host: 'metadata.google.internal',
        port: 443,
        secureEndpoint: true,
      })
    } catch (err) {
      ssrfErr = err
    }
    expect((ssrfErr as { code?: string }).code).toBe('ECONNREFUSED_SSRF')
    expect((ssrfErr as Error).message).toBe(
      'ECONNREFUSED_SSRF: blocked loopback/metadata host via proxy',
    )

    // URL-level assertSafeIdpProxyTarget enforces the same ECONNREFUSED_SSRF rules
    expect(() =>
      assertSafeIdpProxyTarget('http://idp.corp.example/oauth/token', {
        connectByHostname: true,
      }),
    ).toThrow(
      /ECONNREFUSED_SSRF: blocked http:\/\/idp\.corp\.example:80 via proxy/,
    )
    expect(() =>
      assertSafeIdpProxyTarget('https://169.254.169.254/latest/meta-data', {
        connectByHostname: true,
      }),
    ).toThrow('ECONNREFUSED_SSRF: blocked loopback/metadata host via proxy')
    expect(() =>
      assertSafeIdpProxyTarget('https://idp.corp.example/oauth/token', {
        connectByHostname: true,
      }),
    ).not.toThrow()
  })

  test('IdpProxyAgent rejects DNS resolving to metadata/loopback when connectByHostname is off', async () => {
    const agent = new IdpProxyAgent('http://127.0.0.1:8080', {
      connectByHostname: false,
      proxyIsEgressBoundary: false,
      allowLoopback: false,
      ssrfLookup: (_hostname, _opts, cb) => {
        cb(null, [{ address: '169.254.169.254', family: 4 }])
      },
    })
    const fakeReq = new EventEmitter() as unknown as http.ClientRequest
    await expect(
      agent.connect(fakeReq, {
        host: 'rebind.example.com',
        port: 443,
        secureEndpoint: true,
      }),
    ).rejects.toMatchObject({
      code: 'ECONNREFUSED_SSRF',
    })
  })

  test('buildConnectRequestLines rejects space in target and CR/LF/NUL in target or headers', () => {
    expect(() =>
      buildConnectRequestLines('evil.com:443 HTTP/1.1', {
        Host: 'evil.com:443',
      }),
    ).toThrow(
      'Space in the target, or line break or NUL in the target or a header, of a CONNECT request',
    )
    expect(() =>
      buildConnectRequestLines('evil.com\r\nX-Injected: 1:443', {
        Host: 'evil.com:443',
      }),
    ).toThrow(TypeError)
    expect(() =>
      buildConnectRequestLines('evil.com\0:443', { Host: 'evil.com:443' }),
    ).toThrow(TypeError)
    expect(() =>
      buildConnectRequestLines('api.anthropic.com:443', {
        Host: 'api.anthropic.com:443',
        'X-Custom': 'val\r\nEvil: injected',
      }),
    ).toThrow(TypeError)
    expect(() =>
      buildConnectRequestLines('api.anthropic.com:443', {
        Host: 'api.anthropic.com:443',
        'X-Custom': 'val\0null',
      }),
    ).toThrow(TypeError)

    const ok = buildConnectRequestLines('api.anthropic.com:443', {
      Host: 'api.anthropic.com:443',
      'Proxy-Connection': 'close',
    })
    expect(ok).toEqual([
      'CONNECT api.anthropic.com:443 HTTP/1.1',
      'Host: api.anthropic.com:443',
      'Proxy-Connection: close',
    ])
  })

  test('parseProxyConnectResponse enforces 64 KiB cap, strict header syntax, EOF, and safe header map', async () => {
    const makeStream = (chunks: Buffer[]): Readable => {
      let i = 0
      return new Readable({
        read() {
          if (i < chunks.length) {
            this.push(chunks[i++]!)
          } else {
            this.push(null)
          }
        },
      })
    }

    // Valid response with repeated headers + __proto__ key safety
    const parsed = await parseProxyConnectResponse(
      makeStream([
        Buffer.from(
          'HTTP/1.1 200 Connection Established\r\nX-Via: proxy1\r\nX-Via: proxy2\r\n__proto__: safe\r\n\r\n',
        ),
      ]) as unknown as net.Socket,
    )
    expect(parsed.statusCode).toBe(200)
    expect(parsed.headers['x-via']).toEqual(['proxy1', 'proxy2'])
    expect(Object.hasOwn(parsed.headers, '__proto__')).toBe(true)

    // Oversized response header (> 65536 bytes)
    const hugeHeader = `HTTP/1.1 200 OK\r\nX-Pad: ${'A'.repeat(MAX_PROXY_CONNECT_HEADER_BYTES + 10)}\r\n\r\n`
    await expect(
      parseProxyConnectResponse(
        makeStream([Buffer.from(hugeHeader)]) as unknown as net.Socket,
      ),
    ).rejects.toMatchObject({
      message: 'Proxy CONNECT response header is too large',
      code: ERR_PROXY_TUNNEL_CODE,
    })

    // Malformed header (no colon)
    await expect(
      parseProxyConnectResponse(
        makeStream([
          Buffer.from('HTTP/1.1 200 OK\r\nMalformedHeaderWithoutColon\r\n\r\n'),
        ]) as unknown as net.Socket,
      ),
    ).rejects.toThrow('Invalid header from proxy CONNECT response')

    // Empty status line
    await expect(
      parseProxyConnectResponse(
        makeStream([Buffer.from('\r\n\r\n')]) as unknown as net.Socket,
      ),
    ).rejects.toThrow('No header received from proxy CONNECT response')

    // Premature EOF before \r\n\r\n
    await expect(
      parseProxyConnectResponse(
        makeStream([
          Buffer.from('HTTP/1.1 200 OK\r\nX-A: 1'),
        ]) as unknown as net.Socket,
      ),
    ).rejects.toThrow(
      'Proxy connection ended before receiving CONNECT response',
    )
  })

  test('HardenedHttpsProxyAgent / SecureHttpsProxyAgent rejects non-200 non-error CONNECT response and handles 407 / 200 over TCP', async () => {
    // 1. Proxy returns 201 Created (neither 200 nor 4xx/5xx error) on secureEndpoint -> destroyed with ERR_PROXY_TUNNEL
    await withMockProxyServer(
      socket => {
        socket.write('HTTP/1.1 201 Created\r\nContent-Length: 0\r\n\r\n')
      },
      async proxyUrl => {
        const agent = new SecureHttpsProxyAgent(proxyUrl)
        const fakeReq = new EventEmitter() as EventEmitter & {
          destroy: (err?: Error) => void
        }
        let destroyedErr: Error | undefined
        fakeReq.destroy = (err?: Error) => {
          destroyedErr = err
        }
        const dummySocket = await agent.connect(
          fakeReq as unknown as http.ClientRequest,
          {
            host: 'api.anthropic.com',
            port: 443,
            secureEndpoint: true,
          },
        )
        fakeReq.emit('socket', dummySocket)
        expect(destroyedErr).toBeDefined()
        expect(destroyedErr?.message).toBe(
          'Proxy answered CONNECT with neither 200 nor an error',
        )
        expect((destroyedErr as { code?: string })?.code).toBe(
          ERR_PROXY_TUNNEL_CODE,
        )
      },
    )

    // 2. Proxy returns 407 Proxy Auth Required -> pushed into dummy socket without destroying
    await withMockProxyServer(
      socket => {
        socket.write(
          'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="corp"\r\n\r\n',
        )
      },
      async proxyUrl => {
        const agent = new HardenedHttpsProxyAgent(proxyUrl)
        const fakeReq = new EventEmitter() as EventEmitter & {
          destroy: (err?: Error) => void
        }
        let destroyedErr: Error | undefined
        fakeReq.destroy = (err?: Error) => {
          destroyedErr = err
        }
        let emittedMeta: { statusCode?: number } | undefined
        fakeReq.on('proxyConnect', meta => {
          emittedMeta = meta as { statusCode?: number }
        })
        const dummySocket = await agent.connect(
          fakeReq as unknown as http.ClientRequest,
          {
            host: 'api.anthropic.com',
            port: 443,
            secureEndpoint: true,
          },
        )
        fakeReq.emit('socket', dummySocket)
        expect(destroyedErr).toBeUndefined()
        expect(emittedMeta?.statusCode).toBe(407)
      },
    )

    // 3. Proxy returns oversized CONNECT response header over TCP -> ERR_PROXY_TUNNEL
    await withMockProxyServer(
      socket => {
        socket.write(
          `HTTP/1.1 200 OK\r\nX-Big: ${'B'.repeat(MAX_PROXY_CONNECT_HEADER_BYTES + 128)}\r\n\r\n`,
        )
      },
      async proxyUrl => {
        const agent = new HardenedHttpsProxyAgent(proxyUrl)
        const fakeReq = new EventEmitter() as unknown as http.ClientRequest
        await expect(
          agent.connect(fakeReq, {
            host: 'example.com',
            port: 80,
            secureEndpoint: false,
          }),
        ).rejects.toMatchObject({
          message: 'Proxy CONNECT response header is too large',
          code: ERR_PROXY_TUNNEL_CODE,
        })
      },
    )

    // 4. Proxy returns 200 Connection Established for non-TLS tunnel -> returns live socket
    await withMockProxyServer(
      (socket, received) => {
        expect(received).toContain('CONNECT example.com:80 HTTP/1.1')
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      },
      async proxyUrl => {
        const agent = new HardenedHttpsProxyAgent(proxyUrl)
        const fakeReq = new EventEmitter() as unknown as http.ClientRequest
        const tunnel = await agent.connect(fakeReq, {
          host: 'example.com',
          port: 80,
          secureEndpoint: false,
        })
        expect(tunnel).toBeInstanceOf(net.Socket)
        tunnel.destroy()
      },
    )
  })
})
