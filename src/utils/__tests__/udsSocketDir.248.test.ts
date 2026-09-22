/**
 * densable 2.1.248 #44 — wZe + socket-dir refuse + /status Peer address.
 *
 * Gold wZe @201218721 sha=bf7e3df16fb2603b
 * Gold r0t @202057629: return wZe(s())
 * Gold Wm @208535688: Peer address via r0t
 * Gold Bf @201567134: Cross-session messaging is off
 * per-user /tmp / claude-$USER needle 0 — do not invent.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  formatUdsStartFailureReason,
  getUdsStartFailureCause,
  getUdsStartFailureDetail,
  getUdsStartFailureReason,
  startUdsMessaging,
  stopUdsMessaging,
  UDS_SOCKETS_PATH_HINT,
  UDS_SOCKETS_PATH_NOT_A_DIRECTORY,
  UDS_SOCKETS_PATH_SYMLINK_LOOP,
} from '../udsMessaging.js'
import { buildCrossSessionPeerAddressProperties } from '../status.js'

const udsSrc = readFileSync(join(import.meta.dir, '../udsMessaging.ts'), 'utf8')
const statusSrc = readFileSync(join(import.meta.dir, '../status.tsx'), 'utf8')
const settingsStatusSrc = readFileSync(
  join(import.meta.dir, '../../components/Settings/Status.tsx'),
  'utf8',
)
const noticeSrc = readFileSync(
  join(import.meta.dir, '../statusNoticeDefinitions.tsx'),
  'utf8',
)
const setupSrc = readFileSync(join(import.meta.dir, '../../setup.ts'), 'utf8')

const HARBOR = 'CLAUDE_CODE_HARBOR_KITE'
const savedHarbor = process.env[HARBOR]
const savedSocket = process.env.CLAUDE_CODE_MESSAGING_SOCKET

afterEach(async () => {
  await stopUdsMessaging()
  if (savedHarbor === undefined) delete process.env[HARBOR]
  else process.env[HARBOR] = savedHarbor
  if (savedSocket === undefined) delete process.env.CLAUDE_CODE_MESSAGING_SOCKET
  else process.env.CLAUDE_CODE_MESSAGING_SOCKET = savedSocket
})

describe('densable 2.1.248 #44 wZe / socket dir / /status', () => {
  test('wZe gold strings 1:1 including lastStartFailureDetail', () => {
    expect(
      formatUdsStartFailureReason({
        lastStartFailureCause: 'socket_dir_refused',
        lastStartFailureDetail: '/run/user/1000/cc-socks',
      }),
    ).toBe('its socket directory could not be set up: /run/user/1000/cc-socks')
    expect(
      formatUdsStartFailureReason({
        lastStartFailureCause: 'socket_dir_refused',
      }),
    ).toBe('its socket directory could not be set up')
    expect(
      formatUdsStartFailureReason({
        lastStartFailureCause: 'path_refused',
      }),
    ).toBe('its socket path is not a usable local address')
    expect(
      formatUdsStartFailureReason({
        lastStartFailureCause: 'bind_failed',
      }),
    ).toBe('it could not be started')
    expect(
      formatUdsStartFailureReason({
        lastStartFailureCause: 'key_publish_failed',
      }),
    ).toBe('its peer key could not be published')
    expect(
      formatUdsStartFailureReason({
        lastStartFailureCause: 'post_bind_setup_failed',
      }),
    ).toBe('setting it up after bind failed')
    expect(formatUdsStartFailureReason({})).toBeUndefined()
    expect(
      formatUdsStartFailureReason({
        lastStartFailureCause: 'socket_dir_refused',
        startInFlight: true,
      }),
    ).toBeUndefined()
    expect(
      formatUdsStartFailureReason({
        lastStartFailureCause: 'socket_dir_refused',
        activeSocketPath: '/tmp/x.sock',
      }),
    ).toBeUndefined()
  })

  test('does not invent per-user /tmp or /tmp/claude-$USER', () => {
    expect(udsSrc).not.toContain('per-user /tmp')
    expect(udsSrc).not.toContain('/tmp/claude-$USER')
    expect(udsSrc).not.toContain('claude-$USER')
    expect(udsSrc).toContain('process.env.XDG_RUNTIME_DIR')
    expect(udsSrc).toContain('process.env.CLAUDE_CODE_TMPDIR')
    expect(udsSrc).toContain('tmpdir()')
    expect(udsSrc).toContain(UDS_SOCKETS_PATH_HINT)
    expect(udsSrc).toContain('isSymbolicLink')
    expect(statusSrc).not.toContain('per-user /tmp')
    expect(noticeSrc).not.toContain('/tmp/claude-$USER')
  })

  test('/status Wm Peer address gold copy 1:1', () => {
    expect(statusSrc).toContain("label: 'Peer address'")
    expect(statusSrc).toContain('`uds:${socket}`')
    expect(statusSrc).toContain(
      '`unavailable \\u2014 ${reason} (details in the --debug log)`',
    )
    expect(settingsStatusSrc).toContain(
      'buildCrossSessionPeerAddressProperties()',
    )
    process.env[HARBOR] = '1'
    delete process.env.CLAUDE_CODE_MESSAGING_SOCKET

    process.env.CLAUDE_CODE_MESSAGING_SOCKET = '/tmp/cc.sock'
    expect(buildCrossSessionPeerAddressProperties()).toEqual([
      { label: 'Peer address', value: 'uds:/tmp/cc.sock' },
    ])
    delete process.env.CLAUDE_CODE_MESSAGING_SOCKET

    process.env[HARBOR] = '0'
    expect(buildCrossSessionPeerAddressProperties()).toEqual([])
  })

  test('Bf notice gold copy 1:1', () => {
    expect(noticeSrc).toContain("id: 'cross-session-messaging-off'")
    expect(noticeSrc).toContain('Cross-session messaging is off:')
    expect(noticeSrc).toContain(
      "getUdsStartFailureCause() === 'socket_dir_refused'",
    )
    expect(noticeSrc).toContain(
      "getUdsStartFailureReason() ?? 'its socket directory could not be set up'",
    )
    expect(noticeSrc).toContain('run with --debug-file <path> for the full log')
  })

  test('setup_uds does not exit on inbox start failure', () => {
    expect(setupSrc).toContain('logError(error)')
    expect(setupSrc).not.toContain(
      'Error: Failed to start messaging socket (UDS_INBOX)',
    )
    const udsCatch = setupSrc.slice(
      setupSrc.indexOf('await m.startUdsMessaging'),
      setupSrc.indexOf('captureTeammateModeSnapshot'),
    )
    expect(udsCatch).not.toContain('process.exit(1)')
  })

  test('implicit file-in-the-way records socket_dir_refused + official Vi detail', async () => {
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'uds-44-vi-'))
    const blocker = join(dir, 'not-a-dir')
    await writeFile(blocker, 'in-the-way')
    const path = join(blocker, 'messaging.sock')
    await expect(
      startUdsMessaging(path, { isExplicit: false, requireAuth: false }),
    ).rejects.toThrow(UDS_SOCKETS_PATH_NOT_A_DIRECTORY)
    expect(getUdsStartFailureCause()).toBe('socket_dir_refused')
    expect(getUdsStartFailureDetail()).toBe(UDS_SOCKETS_PATH_NOT_A_DIRECTORY)
    expect(getUdsStartFailureReason()).toBe(
      `its socket directory could not be set up: ${UDS_SOCKETS_PATH_NOT_A_DIRECTORY}`,
    )
    process.env[HARBOR] = '1'
    delete process.env.CLAUDE_CODE_MESSAGING_SOCKET
    expect(buildCrossSessionPeerAddressProperties()).toEqual([
      {
        label: 'Peer address',
        value: `unavailable \u2014 ${getUdsStartFailureReason()} (details in the --debug log)`,
      },
    ])
    expect(UDS_SOCKETS_PATH_SYMLINK_LOOP).toContain(UDS_SOCKETS_PATH_HINT)
    await rm(dir, { recursive: true, force: true })
  })
})
