import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSrtWinNativeProvider,
  findDistRootFromModuleDir,
  resolveSrtWinBinaryPath,
  SRT_WIN_EXIT_CODES,
  SrtWinExecutionError,
} from '../index.js'

describe('win-sandbox-native (srt-win 2.1.331)', () => {
  let stateDir: string

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'srt-win-test-'))
  })

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true })
  })

  test('resolves compiled native srt-win binary', () => {
    const binPath = resolveSrtWinBinaryPath()
    expect(binPath).not.toBeNull()
    expect(binPath!).toContain('srt-win')
  })

  test('runs full install -> status -> wfp verify -> denies -> profile forget -> probe-mxc -> run -> uninstall lifecycle', async () => {
    const binPath = resolveSrtWinBinaryPath()
    expect(binPath).not.toBeNull()

    const provider = createSrtWinNativeProvider({
      srtWin: { exe: binPath!, prependArgs: [] },
      env: { SRT_WIN_TEST_STATE_DIR: stateDir },
    })

    // 1. Initial status is absent
    const initial = await provider.checkStatus()
    expect(initial.user.provisioned).toBe(false)
    expect(initial.user.credPresent).toBe(false)
    expect(initial.user.sandboxUser).toBeNull()
    expect(initial.wfp.state).toBe('absent')
    expect(initial.wfp.proxyPortRange).toBeNull()

    // 2. Install provisions user + WFP + proxy port range
    const customGuid = 'a1b2c3d4-e5f6-4789-abcd-0123456789ef'
    const customSid = 'S-1-5-21-1000000001-2000000002-3000000003-1001'
    const installed = await provider.install({
      sandboxUser: 'claude_srt_ci',
      realUserSid: customSid,
      sublayerGuid: customGuid,
      proxyPortRange: [60080, 60089],
      allowLoopback: true,
    })
    expect(installed.user.provisioned).toBe(true)
    expect(installed.user.credPresent).toBe(true)
    expect(installed.user.sandboxUser).toBe('claude_srt_ci')
    expect(installed.user.realUserSid).toBe(customSid)
    expect(installed.user.seclogonState).toBe('running')
    expect(installed.wfp.state).toBe('installed')
    expect(installed.wfp.allowLoopback).toBe(true)
    expect(installed.wfp.sublayerGuid).toBe(customGuid)
    expect(installed.wfp.proxyPortRange).toEqual([60080, 60089])

    // 3. Subsequent status reflects persisted installation
    const afterInstall = await provider.checkStatus()
    expect(afterInstall).toEqual(installed)

    // 4. WFP verify confirms egress is blocked under write-restricted token
    const verified = await provider.verifyWfp({ target: '1.1.1.1:443' })
    expect(verified).toEqual({
      egress_probe: 'blocked',
      target: '1.1.1.1:443',
      write_restricted_token: true,
    })

    // 5. Denies pipes JSON over stdin and returns exact tally
    const sandboxSid = 'S-1-5-21-1000000001-2000000002-3000000003-2002'
    const denies1 = await provider.applyDenies({
      denyRead: ['C:\\Users\\alice\\.ssh', 'C:\\Users\\alice\\.aws'],
      denyWrite: ['C:\\readonly'],
      allowWrite: ['C:\\readonly\\work'],
      sid: sandboxSid,
      deadlineMs: 5000,
    })
    expect(denies1.planted).toBe(3)
    expect(denies1.inPlace).toBe(0)
    expect(denies1.laid).toBe(1)
    expect(denies1.pushedDown).toBe(1)
    expect(denies1.guarded).toBe(3)
    expect(denies1.extrasSkipped).toBe(0)
    expect(denies1.stands).toBe(0)
    expect(denies1.handedBack).toBe(0)
    expect(typeof denies1.ms).toBe('number')

    // Second denies call exercises idempotent inPlace/stands + handedBack
    const denies2 = await provider.applyDenies({
      denyRead: ['C:\\Users\\alice\\.ssh'],
      denyWrite: [],
      allowWrite: [],
      sid: sandboxSid,
    })
    expect(denies2.inPlace).toBe(1)
    expect(denies2.stands).toBe(1)
    expect(denies2.planted).toBe(0)
    expect(denies2.handedBack).toBe(2)

    // 6. Profile forget clears profile read grant
    const forget = await provider.forgetProfileRead({ sid: sandboxSid })
    expect(forget).toEqual({ cleared: true, deferred: false })

    // 7. Probe MXC reports job-restricted tier and UI isolation capabilities
    const mxc = await provider.probeMxc()
    expect(mxc.tier).toBe('job-restricted')
    expect(mxc.needsDaclAugmentation).toBe(true)
    expect(mxc.probes.baseContainerSupportsDenyPaths).toBe(true)
    expect(mxc.probes.baseContainerSupportsIdentitylessLoopbackProxy).toBe(true)
    expect(mxc.probes.baseContainerSupportsIngressHostLoopbackAllow).toBe(true)
    expect(mxc.probes.uiCapabilities).toEqual({
      canBlockClipboardRead: true,
      canBlockClipboardWrite: true,
      canBlockInputInjection: true,
    })
    expect(mxc.error).toBeUndefined()

    // 8. Run spawns real child process with proxy env vars pinned and secrets scrubbed
    const runResult = await provider.spawnSandboxed({
      command: '/bin/sh',
      args: [
        '-c',
        'printf "%s|%s|%s|%s|%s" "$HTTP_PROXY" "$HTTPS_PROXY" "$SRT_WIN_SANDBOXED" "$SRT_WIN_BLOCK_CLIPBOARD_READ" "${ANTHROPIC_API_KEY:-scrubbed}"',
      ],
      env: {
        ANTHROPIC_API_KEY: 'sk-ant-should-be-scrubbed',
      },
      proxyPort: 60082,
      allowLoopback: true,
      blockClipboardRead: true,
      blockClipboardWrite: true,
      blockInputInjection: true,
    })
    expect(runResult.exitCode).toBe(0)
    expect(runResult.timedOut).toBe(false)
    expect(runResult.stdout).toBe(
      'http://127.0.0.1:60082|http://127.0.0.1:60082|1|1|scrubbed',
    )

    // 9. Uninstall resets state back to absent
    const uninstalled = await provider.uninstall({
      sandboxUser: 'claude_srt_ci',
      sublayerGuid: customGuid,
    })
    expect(uninstalled.user.provisioned).toBe(false)
    expect(uninstalled.wfp.state).toBe('absent')

    const finalStatus = await provider.checkStatus()
    expect(finalStatus.user.provisioned).toBe(false)
    expect(finalStatus.wfp.state).toBe('absent')
  })

  test('reports clean non-Windows diagnostics when SRT_WIN_TEST_STATE_DIR is unset', async () => {
    const binPath = resolveSrtWinBinaryPath()
    expect(binPath).not.toBeNull()

    const cleanEnv: NodeJS.ProcessEnv = { ...process.env }
    delete cleanEnv.SRT_WIN_TEST_STATE_DIR

    const provider = createSrtWinNativeProvider({
      srtWin: { exe: binPath!, prependArgs: [] },
      env: { SRT_WIN_TEST_STATE_DIR: '' },
    })

    const status = await provider.checkStatus()
    expect(status.user.provisioned).toBe(false)
    expect(status.wfp.state).toBe('absent')

    const mxc = await provider.probeMxc()
    expect(mxc.tier).toBe('none')
    expect(mxc.error).toContain('requires native Windows')
  })

  test('rejects invalid SID, GUID, proxy port range, username, and bypass paths with validation exit code', async () => {
    const binPath = resolveSrtWinBinaryPath()
    expect(binPath).not.toBeNull()

    const provider = createSrtWinNativeProvider({
      srtWin: { exe: binPath!, prependArgs: [] },
      env: { SRT_WIN_TEST_STATE_DIR: stateDir },
    })

    const expectValidationFailure = async (fn: () => Promise<unknown>) => {
      try {
        await fn()
        throw new Error('Expected SrtWinExecutionError')
      } catch (err) {
        expect(err).toBeInstanceOf(SrtWinExecutionError)
        const execErr = err as SrtWinExecutionError
        expect(execErr.exitCode).toBe(SRT_WIN_EXIT_CODES.VALIDATION)
        expect(execErr.isValidationError).toBe(true)
      }
    }

    // Blocked system SID S-1-5-18
    await expectValidationFailure(() =>
      provider.install({ realUserSid: 'S-1-5-18' }),
    )

    // Malformed SID
    await expectValidationFailure(() =>
      provider.install({ realUserSid: 'S-1-5-21-bad-sid' }),
    )

    // Invalid GUID
    await expectValidationFailure(() =>
      provider.install({ sublayerGuid: 'not-a-valid-guid' }),
    )

    // Privileged port range (< 1024)
    await expectValidationFailure(() =>
      provider.install({ proxyPortRange: [80, 443] }),
    )

    // Inverted port range (start > end)
    await expectValidationFailure(() =>
      provider.install({ proxyPortRange: [60089, 60080] }),
    )

    // Reserved Windows username
    await expectValidationFailure(() =>
      provider.install({ sandboxUser: 'Administrator' }),
    )

    // Invalid username characters
    await expectValidationFailure(() =>
      provider.install({ sandboxUser: 'bad;name' }),
    )

    // Provision cleanly, then verify bypass path and self-SID rejection in denies
    const installed = await provider.install()
    await expectValidationFailure(() =>
      provider.applyDenies({
        denyRead: ['\\\\?\\C:\\Windows\\System32'],
        denyWrite: [],
        allowWrite: [],
      }),
    )
    await expectValidationFailure(() =>
      provider.applyDenies({
        denyRead: [' \\\\.\\PhysicalDrive0'],
        denyWrite: [],
        allowWrite: [],
      }),
    )
    await expectValidationFailure(() =>
      provider.applyDenies({
        denyRead: ['\\\\evil\\share\\secret'],
        denyWrite: [],
        allowWrite: [],
      }),
    )
    await expectValidationFailure(() =>
      provider.applyDenies({
        denyRead: ['/reset'],
        denyWrite: [],
        allowWrite: [],
      }),
    )
    await expectValidationFailure(() =>
      provider.applyDenies({
        denyRead: ['C:\\Users\\alice\\*.key'],
        denyWrite: [],
        allowWrite: [],
      }),
    )
    await expectValidationFailure(() =>
      provider.applyDenies({
        denyRead: ['C:\\Users\\alice\\..\\bob'],
        denyWrite: [],
        allowWrite: [],
      }),
    )
    // P1-12: DOS device username rejection
    await expectValidationFailure(() =>
      provider.install({ sandboxUser: 'CON' }),
    )
    await expectValidationFailure(() =>
      provider.install({ sandboxUser: 'NUL.txt' }),
    )
    // P0-2: Self-SID refusal (must never apply denies or profile forget to realUserSid)
    await expectValidationFailure(() =>
      provider.applyDenies({
        denyRead: ['C:\\Users\\alice\\.ssh'],
        denyWrite: [],
        allowWrite: [],
        sid: installed.user.realUserSid ?? undefined,
      }),
    )
    await expectValidationFailure(() =>
      provider.forgetProfileRead({
        sid: installed.user.realUserSid ?? undefined,
      }),
    )

    // P2-6: BatBadBut .bat/.cmd target rejection in run
    const batRun = await provider.spawnSandboxed({
      command: 'C:\\temp\\payload.bat',
      args: ['arg1'],
    })
    expect(batRun.exitCode).toBe(SRT_WIN_EXIT_CODES.VALIDATION)

    // P1-12: Invalid proxy URL rejection in run
    const badProxyRun = await provider.spawnSandboxed({
      command: '/bin/sh',
      args: ['-c', 'echo hi'],
      httpProxyUrl: 'socks5://127.0.0.1:1080',
    })
    expect(badProxyRun.exitCode).toBe(SRT_WIN_EXIT_CODES.VALIDATION)
  })

  test('P0-1 & P2-2: refuses CWD binary hijacking, requires regular files, fails closed without PATH fallback, and matches exact /dist segment', () => {
    const fakeCwd = mkdtempSync(join(tmpdir(), 'srt-win-cwd-hijack-'))
    try {
      const hijackDir1 = join(
        fakeCwd,
        'packages',
        'win-sandbox-native',
        'target',
        'release',
      )
      const hijackDir2 = join(fakeCwd, 'dist', 'vendor', 'win-sandbox')
      mkdirSync(hijackDir1, { recursive: true })
      mkdirSync(hijackDir2, { recursive: true })
      const fakeWinBin1 = join(hijackDir1, 'srt-win.exe')
      const fakeWinBin2 = join(hijackDir2, 'srt-win.exe')
      writeFileSync(fakeWinBin1, 'malicious')
      writeFileSync(fakeWinBin2, 'malicious')

      // Must ignore CWD candidates completely
      const resolvedWin = resolveSrtWinBinaryPath({
        cwd: fakeCwd,
        platform: 'win32',
        env: {},
      })
      expect(resolvedWin).toBeNull()

      // CLAUDE_CODE_SRT_WIN_PATH pointing to a directory must NOT be accepted (isFile check)
      const resolvedDir = resolveSrtWinBinaryPath({
        platform: 'win32',
        env: { CLAUDE_CODE_SRT_WIN_PATH: hijackDir1 },
      })
      expect(resolvedDir).toBeNull()

      // Explicit absolute file path via CLAUDE_CODE_SRT_WIN_PATH is accepted
      const resolvedExplicit = resolveSrtWinBinaryPath({
        platform: 'win32',
        env: { CLAUDE_CODE_SRT_WIN_PATH: fakeWinBin1 },
      })
      expect(resolvedExplicit).toBe(fakeWinBin1)

      // createSrtWinNativeProvider must fail closed (throw SrtWinExecutionError) rather than falling back to bare 'srt-win' on PATH
      expect(() =>
        createSrtWinNativeProvider({
          platform: 'win32',
          env: {},
        }),
      ).toThrow(SrtWinExecutionError)

      // P2-2: findDistRootFromModuleDir must not match '/distributed-app/'
      expect(findDistRootFromModuleDir('/opt/distributed-app/src')).toBeNull()
      expect(findDistRootFromModuleDir('/tmp/my-dist/vendor')).toBeNull()
      expect(findDistRootFromModuleDir('/opt/app/dist')).toBe('/opt/app/dist')
      expect(findDistRootFromModuleDir('/opt/app/dist/sub/module')).toBe(
        '/opt/app/dist',
      )
      expect(findDistRootFromModuleDir('C:\\app\\dist\\sub')).toBe(
        'C:\\app\\dist',
      )
    } finally {
      rmSync(fakeCwd, { recursive: true, force: true })
    }
  })

  test('P1-9: caps buffered output, survives early-exit EPIPE, and does not hang on timeout with grandchild holding stdio', async () => {
    const binPath = resolveSrtWinBinaryPath()
    expect(binPath).not.toBeNull()

    const provider = createSrtWinNativeProvider({
      srtWin: { exe: binPath!, prependArgs: [] },
      env: { SRT_WIN_TEST_STATE_DIR: stateDir },
    })
    await provider.install()

    // 1. Output cap on spawnSandboxed
    const capped = await provider.spawnSandboxed({
      command: '/bin/sh',
      args: ['-c', 'yes AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA | head -c 65536'],
      maxOutputBytes: 1024,
    })
    expect(Buffer.byteLength(capped.stdout, 'utf8')).toBeLessThanOrEqual(1024)
    expect(capped.exitCode).not.toBe(0)
    expect(capped.outputLimitExceeded).toBe(true)

    // 2. Output cap on checked command throws SrtWinExecutionError
    const chattyProvider = createSrtWinNativeProvider({
      srtWin: {
        exe: '/bin/sh',
        prependArgs: [
          '-c',
          'yes BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB | head -c 16384',
        ],
      },
      maxOutputBytes: 512,
    })
    try {
      await chattyProvider.checkStatus()
      throw new Error('Expected output limit error')
    } catch (err) {
      expect(err).toBeInstanceOf(SrtWinExecutionError)
      expect((err as SrtWinExecutionError).message).toContain('exceeded limit')
    }

    // 3. EPIPE safety when child exits immediately before large stdin finishes writing
    const epipeProvider = createSrtWinNativeProvider({
      srtWin: { exe: '/bin/sh', prependArgs: ['-c', 'exit 0'] },
    })
    const epipeResult = await epipeProvider.spawnSandboxed({
      command: 'ignored',
      stdin: 'x'.repeat(256 * 1024),
    })
    expect(epipeResult.exitCode).toBe(0)

    // 4. Timeout resolves promptly even when a grandchild inherits and holds stdout open
    const startedAt = Date.now()
    const timeoutProvider = createSrtWinNativeProvider({
      srtWin: {
        exe: '/bin/sh',
        prependArgs: ['-c', 'sleep 30 & exec sleep 30'],
      },
    })
    const timedOutResult = await timeoutProvider.spawnSandboxed({
      command: 'ignored',
      timeoutMs: 150,
    })
    const elapsedMs = Date.now() - startedAt
    expect(timedOutResult.timedOut).toBe(true)
    expect(elapsedMs).toBeLessThan(2000)
  })

  test('P1-10: probeMxc accepts base-container tier', async () => {
    const scriptPath = join(stateDir, 'fake-mxc.sh')
    writeFileSync(
      scriptPath,
      '#!/bin/sh\nprintf \'{"tier":"base-container","needsDaclAugmentation":false,"probes":{"baseContainerSupportsDenyPaths":true,"baseContainerSupportsIdentitylessLoopbackProxy":true,"baseContainerSupportsIngressHostLoopbackAllow":true,"uiCapabilities":{"canBlockClipboardRead":true,"canBlockClipboardWrite":true,"canBlockInputInjection":true}}}\'\n',
    )
    chmodSync(scriptPath, 0o755)

    const provider = createSrtWinNativeProvider({
      srtWin: { exe: scriptPath, prependArgs: [] },
    })
    const mxc = await provider.probeMxc()
    expect(mxc.tier).toBe('base-container')
    expect(mxc.needsDaclAugmentation).toBe(false)
  })

  test('preserves UAC cancelled (10) and WFP error (19) exit codes', async () => {
    const binPath = resolveSrtWinBinaryPath()
    expect(binPath).not.toBeNull()

    const uacProvider = createSrtWinNativeProvider({
      srtWin: { exe: binPath!, prependArgs: [] },
      env: {
        SRT_WIN_TEST_STATE_DIR: stateDir,
        SRT_WIN_TEST_SIMULATE_UAC_CANCEL: '1',
      },
    })

    try {
      await uacProvider.install()
      throw new Error('Expected UAC cancel error')
    } catch (err) {
      expect(err).toBeInstanceOf(SrtWinExecutionError)
      const execErr = err as SrtWinExecutionError
      expect(execErr.exitCode).toBe(SRT_WIN_EXIT_CODES.UAC_CANCELLED)
      expect(execErr.isUacCancelled).toBe(true)
    }

    const wfpProvider = createSrtWinNativeProvider({
      srtWin: { exe: binPath!, prependArgs: [] },
      env: {
        SRT_WIN_TEST_STATE_DIR: stateDir,
        SRT_WIN_TEST_SIMULATE_WFP_ERROR: '1',
      },
    })

    try {
      await wfpProvider.verifyWfp()
      throw new Error('Expected WFP error')
    } catch (err) {
      expect(err).toBeInstanceOf(SrtWinExecutionError)
      const execErr = err as SrtWinExecutionError
      expect(execErr.exitCode).toBe(SRT_WIN_EXIT_CODES.WFP_ERROR)
      expect(execErr.isWfpError).toBe(true)
    }
  })

  test('R3 hardening: WFP fail-closed in run, deadline preserves denies, relative/ADS/CRLF path rejection, safe --env overrides, case-insensitive denies, --sublayer-guid & cannot-read status, and compiled execPath resolution', async () => {
    const binPath = resolveSrtWinBinaryPath()
    expect(binPath).not.toBeNull()

    const provider = createSrtWinNativeProvider({
      srtWin: { exe: binPath!, prependArgs: [] },
      env: { SRT_WIN_TEST_STATE_DIR: stateDir },
    })

    const customGuid = 'b2c3d4e5-f6a7-4890-bcde-1234567890ab'
    await provider.install({ sublayerGuid: customGuid })

    // R3-P2-1: checkStatus forwards --sublayer-guid
    const matchingStatus = await provider.checkStatus({
      sublayerGuid: customGuid,
    })
    expect(matchingStatus.wfp.state).toBe('installed')
    expect(matchingStatus.wfp.sublayerGuid).toBe(customGuid)

    const mismatchedStatus = await provider.checkStatus({
      sublayerGuid: '11111111-2222-3333-4444-555555555555',
    })
    expect(mismatchedStatus.wfp.state).toBe('absent')

    // R3-P2-1: parseWfpState preserves 'cannot-read'
    const cannotReadScript = join(stateDir, 'cannot-read-status.sh')
    writeFileSync(
      cannotReadScript,
      '#!/bin/sh\nprintf \'{"user":{"provisioned":true,"credPresent":true,"realUserSid":null,"sandboxUser":"claude_srt","seclogonState":"disabled"},"wfp":{"state":"cannot-read","allowLoopback":false,"sublayerGuid":null,"proxyPortRange":null}}\'\n',
    )
    chmodSync(cannotReadScript, 0o755)
    const cannotReadProvider = createSrtWinNativeProvider({
      srtWin: { exe: cannotReadScript, prependArgs: [] },
    })
    const crStatus = await cannotReadProvider.checkStatus()
    expect(crStatus.wfp.state).toBe('cannot-read')
    expect(crStatus.user.seclogonState).toBe('disabled')

    // R3-P0-3: reject relative, drive-relative, and leading-backslash paths
    const expectValidationErr = async (fn: () => Promise<unknown>) => {
      try {
        await fn()
        throw new Error('Expected validation error')
      } catch (err) {
        expect(err).toBeInstanceOf(SrtWinExecutionError)
        expect((err as SrtWinExecutionError).exitCode).toBe(
          SRT_WIN_EXIT_CODES.VALIDATION,
        )
      }
    }
    await expectValidationErr(() =>
      provider.applyDenies({
        denyRead: ['relative\\secret.txt'],
        denyWrite: [],
        allowWrite: [],
      }),
    )
    await expectValidationErr(() =>
      provider.applyDenies({
        denyRead: ['C:relative.txt'],
        denyWrite: [],
        allowWrite: [],
      }),
    )
    await expectValidationErr(() =>
      provider.applyDenies({
        denyRead: ['\\Windows\\System32'],
        denyWrite: [],
        allowWrite: [],
      }),
    )

    // R3-P0-3 & R3-P1-5: deadline expiry preserves previous denies & keys are case-insensitive
    const sandboxSid = 'S-1-5-21-1000000001-2000000002-3000000003-2002'
    const planted = await provider.applyDenies({
      denyRead: ['C:\\Users\\Alice\\.ssh', 'C:\\Users\\Alice\\.aws'],
      denyWrite: [],
      allowWrite: [],
      sid: sandboxSid,
    })
    expect(planted.planted).toBe(2)

    const timedOutDenies = await provider.applyDenies({
      denyRead: ['C:\\Users\\Alice\\.gnupg'],
      denyWrite: [],
      allowWrite: [],
      sid: sandboxSid,
      deadlineMs: 0,
    })
    expect(timedOutDenies.handedBack).toBe(0)
    expect(timedOutDenies.extrasSkipped).toBe(1)

    // Case-insensitive match proves .ssh and .aws survived the timed-out denies call
    const afterTimeout = await provider.applyDenies({
      denyRead: ['c:\\users\\alice\\.ssh', 'C:\\USERS\\ALICE\\.AWS'],
      denyWrite: [],
      allowWrite: [],
      sid: sandboxSid,
    })
    expect(afterTimeout.inPlace).toBe(2)
    expect(afterTimeout.planted).toBe(0)
    expect(afterTimeout.handedBack).toBe(0)

    // R3-P1-4: safe --env overrides forwarded while sensitive secrets scrubbed; ADS & CR/LF rejected
    const envRun = await provider.spawnSandboxed({
      command: '/bin/sh',
      args: [
        '-c',
        'printf "%s|%s|%s" "$NODE_EXTRA_CA_CERTS" "$CUSTOM_SAFE_VAR" "${AWS_SECRET_ACCESS_KEY:-scrubbed}"',
      ],
      env: {
        NODE_EXTRA_CA_CERTS: 'C:\\ProgramData\\sandbox-runtime\\ca\\cert.pem',
        CUSTOM_SAFE_VAR: 'ok-val',
        AWS_SECRET_ACCESS_KEY: 'super-secret',
      },
    })
    expect(envRun.exitCode).toBe(0)
    expect(envRun.outputLimitExceeded).toBe(false)
    expect(envRun.stdout).toBe(
      'C:\\ProgramData\\sandbox-runtime\\ca\\cert.pem|ok-val|scrubbed',
    )

    const adsRun = await provider.spawnSandboxed({
      command: 'C:\\temp\\payload.bat::$DATA',
    })
    expect(adsRun.exitCode).toBe(SRT_WIN_EXIT_CODES.VALIDATION)

    const crlfRun = await provider.spawnSandboxed({
      command: 'cmd.exe\r\nevil',
    })
    expect(crlfRun.exitCode).toBe(SRT_WIN_EXIT_CODES.VALIDATION)

    // R3-P0-1: cmd_run fails closed with exit 19 (WFP_ERROR) when WFP state != installed unless --no-net
    const stateFile = join(stateDir, 'state.json')
    const rawState = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<
      string,
      unknown
    >
    rawState.wfpState = 'absent'
    writeFileSync(stateFile, JSON.stringify(rawState))

    const wfpFailRun = await provider.spawnSandboxed({
      command: '/bin/sh',
      args: ['-c', 'echo should-not-run'],
    })
    expect(wfpFailRun.exitCode).toBe(SRT_WIN_EXIT_CODES.WFP_ERROR)

    const noNetRun = await provider.spawnSandboxed({
      command: '/bin/sh',
      args: ['-c', 'printf ok'],
      noNet: true,
    })
    expect(noNetRun.exitCode).toBe(0)
    expect(noNetRun.stdout).toBe('ok')

    // R3-P0-6: resolveSrtWinBinaryPath finds vendor/win-sandbox/srt-win.exe next to compiled execPath
    const fakeBundleRoot = join(stateDir, 'compiled-pkg')
    const fakeExecBin = join(fakeBundleRoot, 'bin', 'claude.exe')
    const fakeVendorNextToExec = join(
      fakeBundleRoot,
      'bin',
      'vendor',
      'win-sandbox',
      'srt-win.exe',
    )
    const fakeVendorAtPkgRoot = join(
      fakeBundleRoot,
      'vendor',
      'win-sandbox',
      'srt-win.exe',
    )
    mkdirSync(join(fakeBundleRoot, 'vendor', 'win-sandbox'), {
      recursive: true,
    })
    writeFileSync(fakeVendorAtPkgRoot, 'MZ')
    expect(
      resolveSrtWinBinaryPath({
        platform: 'win32',
        env: {},
        execPath: fakeExecBin,
      }),
    ).toBe(fakeVendorAtPkgRoot)

    mkdirSync(join(fakeBundleRoot, 'bin', 'vendor', 'win-sandbox'), {
      recursive: true,
    })
    writeFileSync(fakeVendorNextToExec, 'MZ')
    expect(
      resolveSrtWinBinaryPath({
        platform: 'win32',
        env: {},
        execPath: fakeExecBin,
      }),
    ).toBe(fakeVendorNextToExec)
  })

  test('E5-P0-2 & E5-P1-3: --apply-restricted-token self-reexec mode and fail-closed denies on deadline skip inside allowWrite', async () => {
    const binPath = resolveSrtWinBinaryPath()
    expect(binPath).not.toBeNull()

    // 1. --apply-restricted-token executes target with restricted-token marker in test state mode
    const reexecOk = spawnSync(
      binPath!,
      [
        '--apply-restricted-token',
        '--',
        '/bin/sh',
        '-c',
        'printf "%s" "$SRT_WIN_RESTRICTED_TOKEN_APPLIED"',
      ],
      {
        env: { ...process.env, SRT_WIN_TEST_STATE_DIR: stateDir },
        encoding: 'utf8',
      },
    )
    expect(reexecOk.status).toBe(0)
    expect(reexecOk.stdout).toBe('1')

    // 2. --apply-restricted-token rejects BatBadBut .bat scripts with validation exit code
    const reexecBat = spawnSync(
      binPath!,
      ['--apply-restricted-token', '--', 'C:\\temp\\payload.bat'],
      {
        env: { ...process.env, SRT_WIN_TEST_STATE_DIR: stateDir },
        encoding: 'utf8',
      },
    )
    expect(reexecBat.status).toBe(SRT_WIN_EXIT_CODES.VALIDATION)

    // 3. --apply-restricted-token rejects missing command with usage exit code
    const reexecMissing = spawnSync(binPath!, ['--apply-restricted-token'], {
      env: { ...process.env, SRT_WIN_TEST_STATE_DIR: stateDir },
      encoding: 'utf8',
    })
    expect(reexecMissing.status).toBe(SRT_WIN_EXIT_CODES.USAGE)

    // 4. E5-P1-3: denies fails closed when deadline_ms=0 skips a deny target inside allowWrite
    const provider = createSrtWinNativeProvider({
      srtWin: { exe: binPath!, prependArgs: [] },
      env: { SRT_WIN_TEST_STATE_DIR: stateDir },
    })
    await provider.install()
    const sandboxSid = 'S-1-5-21-1000000001-2000000002-3000000003-2002'
    await expect(
      provider.applyDenies({
        denyRead: [],
        denyWrite: ['C:\\Users\\alice\\work\\.git\\config'],
        allowWrite: ['C:\\Users\\alice\\work'],
        sid: sandboxSid,
        deadlineMs: 0,
      }),
    ).rejects.toThrow(/Deadline expired|Unguarded deny target/)
  })
})
