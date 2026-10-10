/**
 * densable 2.1.289 — source-lock for `claude plugin configure` registration
 * and slash `/plugin configure` parse.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parsePluginArgs } from '../../../commands/plugin/parseArgs.js'
import { getCliCommandGraphNode } from '../../cliCommandGraph.js'

const REGISTER = join(import.meta.dir, '../../registerCliHostCommands.ts')
const HANDLER = join(import.meta.dir, '../pluginConfigure.ts')

describe('densable 2.1.289 plugin configure', () => {
  test('cliCommandGraph registers plugin.configure with gold description', () => {
    const node = getCliCommandGraphNode(['plugin', 'configure'])
    expect(node.description).toBe(
      "Show a plugin's options and which are unset, or save values from stdin with --values-stdin",
    )
  })

  test('registerCliHostCommands wires configure + --values-stdin + install --config', () => {
    const src = readFileSync(REGISTER, 'utf8')
    expect(src).toContain(".command('configure <plugin>')")
    expect(src).toContain("describe(['plugin', 'configure'])")
    expect(src).toContain("'--values-stdin'")
    expect(src).toContain('pluginConfigureHandler')
    expect(src).toContain("'--config <key=value>'")
  })

  test('pluginConfigureHandler exists and lists / values-stdin paths', () => {
    const src = readFileSync(HANDLER, 'utf8')
    expect(src).toContain('export async function pluginConfigureHandler')
    expect(src).toContain('No option values were piped in')
    expect(src).toContain(
      'Configuration saved. Restart Claude Code to apply it.',
    )
    expect(src).toContain('has no options to set')
    expect(src).toContain('Set values with /plugin configure <plugin>')
  })

  test('installPlugin skips --config when nothingWritten', () => {
    const cli = readFileSync(
      join(import.meta.dir, '../../../services/plugins/pluginCliCommands.ts'),
      'utf8',
    )
    const ops = readFileSync(
      join(import.meta.dir, '../../../services/plugins/pluginOperations.ts'),
      'utf8',
    )
    expect(ops).toContain('nothingWritten?: boolean')
    expect(ops).toContain('nothingWritten: true')
    expect(ops).toContain('const wasInstalled = (')
    expect(ops).toContain('const wasEnabled =')
    const snapshot = ops.indexOf('const wasInstalled = (')
    const install = ops.indexOf('const result = await installResolvedPlugin({')
    const written = ops.indexOf('nothingWritten: true')
    expect(snapshot).toBeGreaterThan(0)
    expect(install).toBeGreaterThan(snapshot)
    expect(written).toBeGreaterThan(install)
    expect(ops).toContain('It was disabled, so it is enabled again.')
    expect(cli).toContain('if (result.nothingWritten)')
    expect(cli).toContain(
      '--config values were not saved, because this command changed nothing. To set them, run /plugin configure',
    )
    expect(cli).toContain('configApplied = false')
  })

  test('slash /plugin configure parses to manage-plugins configure action', () => {
    expect(parsePluginArgs('configure foo@bar')).toEqual({
      type: 'configure',
      plugin: 'foo@bar',
    })
  })
})
