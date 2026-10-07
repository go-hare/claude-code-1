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
    expect(src).toContain("pluginConfigureHandler")
    expect(src).toContain("'--config <key=value>'")
  })

  test('pluginConfigureHandler exists and lists / values-stdin paths', () => {
    const src = readFileSync(HANDLER, 'utf8')
    expect(src).toContain('export async function pluginConfigureHandler')
    expect(src).toContain('No option values were piped in')
    expect(src).toContain('Configuration saved. Restart Claude Code to apply it.')
    expect(src).toContain('has no options to set')
    expect(src).toContain('Set values with /plugin configure <plugin>')
  })

  test('slash /plugin configure parses to manage-plugins configure action', () => {
    expect(parsePluginArgs('configure foo@bar')).toEqual({
      type: 'configure',
      plugin: 'foo@bar',
    })
  })
})
