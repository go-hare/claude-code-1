import { describe, expect, test } from 'bun:test'
import {
  PLUGIN_JSON_SHOWN_COMMAND_FAILURE_CODES,
  acceptCommandMatches,
  confirmMarketplaceDeclaredCommand,
  hashShownCommand,
  printPluginCliJsonLine,
  withAcceptCommandMatched,
  withShownCommandSha256,
  type MarketplaceShownCommand,
} from '../pluginAcceptCommand.js'

const shown: MarketplaceShownCommand = {
  kind: 'command_source',
  pluginId: 'demo@official',
  command: 'printf /tmp/plugin',
  mode: 'copy',
  catalogRevision: 'sha256:abc',
}

describe('densable 2.1.283 --accept-command (j/F/M/Qxe)', () => {
  test('hash is stable hex of kind/plugin/command/mode/catalog', () => {
    const a = hashShownCommand(shown)
    const b = hashShownCommand({ ...shown })
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(b)
    expect(hashShownCommand({ ...shown, catalogRevision: 'sha256:other' })).not.toBe(
      a,
    )
  })

  test('acceptCommandMatches is case-insensitive trim', () => {
    const sha = hashShownCommand(shown)
    expect(acceptCommandMatches(sha, shown)).toBe(true)
    expect(acceptCommandMatches(` ${sha.toUpperCase()} `, shown)).toBe(true)
    expect(acceptCommandMatches('deadbeef', shown)).toBe(false)
    expect(acceptCommandMatches(undefined, shown)).toBe(false)
  })

  test('withAcceptCommandMatched annotates only when flag present', () => {
    expect(withAcceptCommandMatched(shown, undefined).acceptCommandMatched).toBe(
      undefined,
    )
    expect(
      withAcceptCommandMatched(shown, hashShownCommand(shown)).acceptCommandMatched,
    ).toBe(true)
  })

  test('shownCommand failure codes match gold se set', () => {
    expect([...PLUGIN_JSON_SHOWN_COMMAND_FAILURE_CODES].sort()).toEqual(
      [
        'command_source_declined',
        'command_source_refused',
        'entry_helper_declined',
        'entry_helper_unconfirmed',
      ].sort(),
    )
  })

  test('printPluginCliJsonLine strips shownCommand unless refusal code', async () => {
    const writes: string[] = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stdout.write
    try {
      await printPluginCliJsonLine({
        command: 'install',
        outcome: 'ok',
        plugin: 'demo',
        message: 'ok',
        shownCommand: withShownCommandSha256(shown),
      })
      await printPluginCliJsonLine({
        command: 'install',
        outcome: 'failed',
        plugin: 'demo',
        message: 'no',
        failureCode: 'command_source_declined',
        shownCommand: withShownCommandSha256(shown),
      })
    } finally {
      process.stdout.write = orig
    }
    const ok = JSON.parse(writes[0]!) as { shownCommand?: unknown }
    const failed = JSON.parse(writes[1]!) as { shownCommand?: { sha256: string } }
    expect(ok.shownCommand).toBeUndefined()
    expect(failed.shownCommand?.sha256).toBe(hashShownCommand(shown))
  })

  test('non-TTY --accept-command mismatch is unconfirmed', async () => {
    const wasOut = process.stdout.isTTY
    const wasIn = process.stdin.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    const lines: string[] = []
    try {
      const verdict = await confirmMarketplaceDeclaredCommand({
        acceptCommand: 'not-the-hash',
        shown,
        write: text => lines.push(text),
      })
      expect(verdict).toBe('unconfirmed')
      expect(lines.join('')).toContain(
        '--accept-command does not name the command shown above',
      )
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: wasOut, configurable: true })
      Object.defineProperty(process.stdin, 'isTTY', { value: wasIn, configurable: true })
    }
  })
})
