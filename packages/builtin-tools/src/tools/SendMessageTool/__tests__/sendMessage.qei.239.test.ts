import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { readFileSync } from 'fs'
import { join } from 'path'
import { LIST_AGENTS_TOOL_NAME } from '../../ListPeersTool/constants.js'
import {
  getUdsMessagingSocketPath,
  isLocalSocketAddress,
  startUdsMessaging,
  stopUdsMessaging,
} from 'src/utils/udsMessaging.js'
import {
  CROSS_MACHINE_MESSAGING_UNAVAILABLE,
  isCrossMachineMessagingAvailable,
} from '../cloudHop.js'
import { SendMessageTool } from '../SendMessageTool.js'
import { validateSendMessageTo } from '../validateTo.js'

const toolSrc = readFileSync(
  join(import.meta.dir, '../SendMessageTool.ts'),
  'utf8',
)
const hopSrc = readFileSync(join(import.meta.dir, '../cloudHop.ts'), 'utf8')

describe('densable 2.1.239 Qei / ELe', () => {
  test('ELe: unix and teammate names pass; UNC share and NT object fail', () => {
    expect(isLocalSocketAddress('/tmp/peer.sock')).toBe(true)
    expect(isLocalSocketAddress('worker')).toBe(true)
    expect(isLocalSocketAddress('\\\\.\\pipe\\claude-code-1')).toBe(true)
    expect(isLocalSocketAddress('\\\\server\\share\\sock')).toBe(false)
    expect(isLocalSocketAddress('\\??\\C:\\Windows')).toBe(false)
  })

  test('Qei: empty to and empty bridge/uds target', () => {
    expect(validateSendMessageTo('   ')).toBe('to must not be empty')
    expect(validateSendMessageTo('uds:')).toBe(
      'address target must not be empty',
    )
    expect(validateSendMessageTo('bridge:')).toBe(
      'address target must not be empty',
    )
  })

  test('Qei: ELe third clause names ListAgents', () => {
    const msg = validateSendMessageTo('\\\\server\\share')
    expect(msg).toBe(
      `'\\\\server\\share' is not a local socket address. Use an address from ${LIST_AGENTS_TOOL_NAME}.`,
    )
    expect(validateSendMessageTo('uds:\\\\server\\share')).toContain(
      'is not a local socket address',
    )
    expect(validateSendMessageTo('\\??\\C:\\Windows')).toContain(
      'is not a local socket address',
    )
  })

  test('Qei: teammate name and named pipe pass', () => {
    expect(validateSendMessageTo('worker')).toBeUndefined()
    expect(validateSendMessageTo('\\\\.\\pipe\\claude-code-1')).toBeUndefined()
    expect(validateSendMessageTo('uds:/tmp/peer.sock')).toBeUndefined()
  })

  test('validateInput wires Qei before tcp empty-target', async () => {
    const unc = await SendMessageTool.validateInput!(
      { to: '\\\\server\\share', message: 'hello' } as never,
      {} as never,
    )
    expect(unc.result).toBe(false)
    if (unc.result) throw new Error('expected UNC reject')
    expect(unc.message).toContain('is not a local socket address')
    expect(unc.message).toContain(LIST_AGENTS_TOOL_NAME)

    const tcp = await SendMessageTool.validateInput!(
      { to: 'tcp:', message: 'hello' } as never,
      {} as never,
    )
    expect(tcp.result).toBe(false)
    if (tcp.result) throw new Error('expected empty tcp reject')
    expect(tcp.message).toBe('address target must not be empty')
  })
})

describe('densable 2.1.239 VEt in validateInput', () => {
  let previousConfigDir: string | undefined
  let tempConfigDir = ''

  beforeEach(async () => {
    previousConfigDir = process.env.CLAUDE_CONFIG_DIR
    tempConfigDir = await mkdtemp(join(tmpdir(), 'send-vet-239-'))
    process.env.CLAUDE_CONFIG_DIR = tempConfigDir
  })

  afterEach(async () => {
    await stopUdsMessaging()
    if (previousConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousConfigDir
    }
    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true })
      tempConfigDir = ''
    }
  })

  test('uds own inbox is DEe', async () => {
    const path =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\claude-qei-vet-${process.pid}`
        : join(tempConfigDir, 'own.sock')
    await startUdsMessaging(path, { isExplicit: true })
    const own = getUdsMessagingSocketPath()
    expect(own).toBe(path)
    const result = await SendMessageTool.validateInput!(
      { to: `uds:${own}`, message: 'hello' } as never,
      {} as never,
    )
    expect(result.result).toBe(false)
    if (result.result) throw new Error('expected VEt reject')
    expect(result.message).toContain('is this session itself')
    expect(result.errorCode).toBe(9)
  })
})

describe('densable 2.1.239 g0m / h0m', () => {
  const prevTraffic = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC

  afterEach(() => {
    if (prevTraffic === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    } else {
      process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = prevTraffic
    }
  })

  test('g0m is firstParty && !essential-traffic', () => {
    expect(hopSrc).toContain(
      "getAPIProvider() === 'firstParty' && !isEssentialTrafficOnly()",
    )
    expect(CROSS_MACHINE_MESSAGING_UNAVAILABLE).toContain(
      'Cross-machine messaging is unavailable',
    )
    expect(CROSS_MACHINE_MESSAGING_UNAVAILABLE).toContain(
      'third-party provider or with nonessential traffic disabled',
    )
  })

  test('g0m is false when nonessential traffic is disabled', () => {
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    expect(isCrossMachineMessagingAvailable()).toBe(false)
  })

  test('call() gates explicit bridge and resolved bridge-session', () => {
    expect(toolSrc).toContain('CROSS_MACHINE_MESSAGING_UNAVAILABLE')
    expect(
      toolSrc.split('if (!isCrossMachineMessagingAvailable())').length - 1,
    ).toBe(2)
    expect(toolSrc).toContain(
      'densable g0m — before posting through Anthropic servers',
    )
    expect(toolSrc).toContain(
      'densable g0m — official also gates resolved cloud-session here',
    )
  })
})
