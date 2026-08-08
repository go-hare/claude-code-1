/**
 * densable 2.1.218 BJy plugin install --config KEY=VALUE parser.
 */
import { describe, expect, test } from 'bun:test'
import { parsePluginCliConfigFlags } from '../parsePluginCliConfig.js'
import type { PluginOptionSchema } from '../pluginOptionsStorage.js'

const schema: PluginOptionSchema = {
  apiKey: { type: 'string', required: true, title: 'API Key' },
  retries: { type: 'number', min: 0, max: 10 },
  enabled: { type: 'boolean' },
  path: { type: 'directory' },
}

describe('parsePluginCliConfigFlags (densable BJy)', () => {
  test('parses string/number/boolean KEY=VALUE', () => {
    const r = parsePluginCliConfigFlags(
      ['apiKey=sk-test', 'retries=3', 'enabled=yes', 'path=/tmp/x'],
      schema,
    )
    expect(r).toEqual({
      apiKey: 'sk-test',
      retries: 3,
      enabled: true,
      path: '/tmp/x',
    })
  })

  test('boolean accepts densable true/false 1/0 yes/no on/off', () => {
    for (const [raw, want] of [
      ['true', true],
      ['false', false],
      ['1', true],
      ['0', false],
      ['yes', true],
      ['no', false],
      ['on', true],
      ['off', false],
      ['YES', true],
    ] as const) {
      expect(
        parsePluginCliConfigFlags([`enabled=${raw}`], schema).enabled,
      ).toBe(want)
    }
  })

  test('rejects missing =', () => {
    expect(() => parsePluginCliConfigFlags(['apiKey'], schema)).toThrow(
      /expects KEY=VALUE/,
    )
  })

  test('rejects unknown key with Known keys list', () => {
    expect(() => parsePluginCliConfigFlags(['nope=1'], schema)).toThrow(
      /isn't declared/,
    )
    expect(() => parsePluginCliConfigFlags(['nope=1'], schema)).toThrow(
      /Known keys: apiKey, retries, enabled, path/,
    )
  })

  test('rejects empty value', () => {
    expect(() => parsePluginCliConfigFlags(['apiKey='], schema)).toThrow(
      /value is empty/,
    )
  })

  test('rejects non-number', () => {
    expect(() => parsePluginCliConfigFlags(['retries=x'], schema)).toThrow(
      /is not a number/,
    )
  })

  test('rejects non-boolean with densable hint', () => {
    expect(() => parsePluginCliConfigFlags(['enabled=maybe'], schema)).toThrow(
      /is not a boolean \(use true\/false, 1\/0, yes\/no, on\/off\)/,
    )
  })

  test('trims first line of value only', () => {
    const r = parsePluginCliConfigFlags(['apiKey=sk\nsecret'], schema)
    expect(r.apiKey).toBe('sk')
  })

  test('number out of max fails validation', () => {
    expect(() => parsePluginCliConfigFlags(['retries=99'], schema)).toThrow(
      /validation failed/,
    )
  })
})
