/**
 * densable 2.1.248 #33 — gold `b` / `C` / `w` + commander allowUnknownOption.
 *
 * GOLD: gold-248-na-33-b.txt / gold-248-na-33-C.txt / gold-248-na-33-w.txt /
 * gold-248-na-33-commander.txt
 *
 * Commander: .helpOption(false).allowUnknownOption().allowExcessArguments(true)
 * then C(Y(L)) refuse parent CLI flags that are not in `f`.
 */
import { Command } from '@commander-js/extra-typings'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  rootOptionsRefusedMessage,
  rootOptionsRemoteControlRefuses,
  suppliedRootOptions,
  type CommanderLike,
  type SuppliedRootOption,
} from '../remoteControlFlags.js'

const ROOT = join(import.meta.dir, '../../..')

function extractRemoteControlBlock(source: string): string {
  const idx = source.indexOf(".command('remote-control'")
  expect(idx).toBeGreaterThanOrEqual(0)
  return source.slice(idx, idx + 1200)
}

function optionStub(spec: {
  key: string
  negate?: boolean
  long?: string
  flags: string
}): CommanderLike['options'][number] {
  return {
    attributeName: () => spec.key,
    negate: spec.negate === true,
    long: spec.long,
    flags: spec.flags,
  }
}

function parentCommand(opts: {
  values: Record<string, unknown>
  sources: Record<string, string | undefined>
  options: CommanderLike['options']
}): CommanderLike {
  return {
    parent: null,
    options: opts.options,
    getOptionValueSource: name => opts.sources[name],
    getOptionValue: name => opts.values[name],
    args: [],
  }
}

describe('densable 2.1.248 #33 remote-control flag order', () => {
  test('main.tsx commander allows unknown then C(Y(L))', () => {
    const src = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8')
    const block = extractRemoteControlBlock(src)
    expect(block).toContain('.helpOption(false)')
    expect(block).toContain('.allowUnknownOption()')
    expect(block).toContain('.allowExcessArguments(true)')
    expect(block).toContain('rootOptionsRemoteControlRefuses')
    expect(block).toContain('suppliedRootOptions')
    expect(block).toContain('rootOptionsRefusedMessage')
    expect(block).toContain('enterRemoteControl')
    expect(block).not.toContain('process.argv.slice(3)')
  })

  test('cli.tsx fast path stays args[0] and enters via R', () => {
    const src = readFileSync(join(ROOT, 'src/entrypoints/cli.tsx'), 'utf8')
    const idx = src.indexOf("args[0] === 'remote-control'")
    expect(idx).toBeGreaterThanOrEqual(0)
    const block = src.slice(idx - 80, idx + 1100)
    expect(block).toContain("args[0] === 'rc'")
    expect(block).toContain('enterRemoteControl')
    expect(block).toContain('args.slice(1)')
    expect(block).not.toContain("args.includes('remote-control')")
  })

  test('C() allows listed parent flags and refuses the rest', () => {
    const supplied: SuppliedRootOption[] = [
      { flag: '--verbose', key: 'verbose', value: true },
      { flag: '--debug', key: 'debug', value: true },
      { flag: '--chrome', key: 'chrome', value: true },
      { flag: '--name', key: 'name', value: 'rc' },
      { flag: '--permission-mode', key: 'permissionMode', value: 'plan' },
      { flag: '--print', key: 'print', value: true },
    ]
    expect(rootOptionsRemoteControlRefuses(supplied)).toEqual([
      '--permission-mode',
      '--print',
    ])
  })

  test('C() chrome allow is value===true only', () => {
    expect(
      rootOptionsRemoteControlRefuses([
        { flag: '--chrome', key: 'chrome', value: true },
      ]),
    ).toEqual([])
    expect(
      rootOptionsRemoteControlRefuses([
        { flag: '--no-chrome', key: 'chrome', value: false },
      ]),
    ).toEqual(['--no-chrome'])
  })

  test('w() gold singular / plural / permission-mode hint', () => {
    expect(rootOptionsRefusedMessage(['--print'])).toBe(
      "Error: `--print` before `remote-control` is not carried over to the sessions Remote Control starts, so Remote Control refuses to start rather than drop it \u2014 remove it, and give Remote Control's own options after the verb (see `claude remote-control --help`).",
    )
    expect(rootOptionsRefusedMessage(['--print', '--continue'])).toBe(
      "Error: `--print`, `--continue` before `remote-control` are not carried over to the sessions Remote Control starts, so Remote Control refuses to start rather than drop them \u2014 remove them, and give Remote Control's own options after the verb (see `claude remote-control --help`).",
    )
    expect(rootOptionsRefusedMessage(['--permission-mode'])).toBe(
      "Error: `--permission-mode` before `remote-control` is not carried over to the sessions Remote Control starts, so Remote Control refuses to start rather than drop it \u2014 remove it, and give Remote Control's own options after the verb (see `claude remote-control --help`). Set the permission mode with `claude remote-control --permission-mode <mode>`.",
    )
  })

  test('b() reads parent CLI-sourced options and prefers negate flag', () => {
    const verbose = optionStub({
      key: 'verbose',
      long: '--verbose',
      flags: '--verbose',
    })
    const chrome = optionStub({
      key: 'chrome',
      long: '--chrome',
      flags: '--chrome',
    })
    const noChrome = optionStub({
      key: 'chrome',
      negate: true,
      long: '--no-chrome',
      flags: '--no-chrome',
    })
    const print = optionStub({
      key: 'print',
      long: '--print',
      flags: '--print',
    })
    const parent = parentCommand({
      options: [verbose, chrome, noChrome, print],
      values: { verbose: true, chrome: false, print: true },
      sources: { verbose: 'cli', chrome: 'cli', print: 'default' },
    })
    const child: CommanderLike = {
      parent,
      options: [],
      getOptionValueSource: () => undefined,
      getOptionValue: () => undefined,
      args: ['--spawn'],
    }
    expect(suppliedRootOptions(child)).toEqual([
      { flag: '--verbose', key: 'verbose', value: true },
      { flag: '--no-chrome', key: 'chrome', value: false },
    ])
    expect(rootOptionsRemoteControlRefuses(suppliedRootOptions(child))).toEqual(
      ['--no-chrome'],
    )
  })

  test('b() empty when command has no parent', () => {
    const lone: CommanderLike = {
      parent: null,
      options: [],
      getOptionValueSource: () => undefined,
      getOptionValue: () => undefined,
      args: [],
    }
    expect(suppliedRootOptions(lone)).toEqual([])
  })

  test('commander keeps RC flags in L.args when a parent flag precedes the verb', async () => {
    let captured: { args: string[]; refused: string[] } | undefined
    const program = new Command()
      .enablePositionalOptions()
      .exitOverride()
      .option('--verbose', 'verbose', () => true)
      .option('--permission-mode <mode>', 'permission mode')

    program
      .command('remote-control')
      .helpOption(false)
      .allowUnknownOption()
      .allowExcessArguments(true)
      .action(async (_P, L) => {
        captured = {
          args: L.args,
          refused: rootOptionsRemoteControlRefuses(suppliedRootOptions(L)),
        }
      })

    await program.parseAsync(
      ['--verbose', 'remote-control', '--spawn', '--name', 'lab'],
      { from: 'user' },
    )
    expect(captured?.args).toEqual(['--spawn', '--name', 'lab'])
    expect(captured?.refused).toEqual([])
  })

  test('commander C() refuses parent --permission-mode before the verb', async () => {
    let captured: { args: string[]; refused: string[] } | undefined
    const program = new Command()
      .enablePositionalOptions()
      .exitOverride()
      .option('--verbose', 'verbose', () => true)
      .option('--permission-mode <mode>', 'permission mode')

    program
      .command('remote-control')
      .helpOption(false)
      .allowUnknownOption()
      .allowExcessArguments(true)
      .action(async (_P, L) => {
        captured = {
          args: L.args,
          refused: rootOptionsRemoteControlRefuses(suppliedRootOptions(L)),
        }
      })

    await program.parseAsync(
      ['--permission-mode', 'plan', 'remote-control', '--spawn'],
      { from: 'user' },
    )
    expect(captured?.args).toEqual(['--spawn'])
    expect(captured?.refused).toEqual(['--permission-mode'])
    expect(rootOptionsRefusedMessage(captured?.refused ?? [])).toContain(
      'Set the permission mode with `claude remote-control --permission-mode <mode>`.',
    )
  })
})
