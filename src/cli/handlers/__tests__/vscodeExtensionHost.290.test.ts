import { describe, expect, test } from 'bun:test'
import { Command } from '@commander-js/extra-typings'
import { registerVscodeExtensionHostCommands } from '../vscodeExtensionHost.js'

describe('2.1.290 #88 vscodeExtensionHost edit-sandbox-settings', () => {
  test('registers hidden edit-sandbox-settings command with --json option', () => {
    const program = new Command()
    registerVscodeExtensionHostCommands(program)
    const cmd = program.commands.find(c => c.name() === 'edit-sandbox-settings')
    expect(cmd).toBeDefined()
    expect(cmd?.description()).toBe(
      'Apply one sandbox settings edit read as JSON from stdin (used by the VS Code extension)',
    )
    const jsonOpt = cmd?.options.find(o => o.long === '--json')
    expect(jsonOpt).toBeDefined()
    expect(jsonOpt?.mandatory).toBe(true)
  })
})
