/**
 * densable 2.1.248 #22 lIe @186254433 sha=b5614ce00cf5c225
 * `{` + invalid JSON → validationError with the gold parse message.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { errorMessage } from '../errors.js'
import { parseHookOutput } from '../hooks.js'

const GOLD_PARSE_PREFIX =
  'Hook output looks like a JSON object but is not valid JSON — '
const GOLD_PARSE_SUFFIX =
  'Emit the payload with a JSON encoder (jq, ConvertTo-Json, json.dumps) rather than string concatenation so backslashes and quotes inside strings are escaped.'
const GOLD_SEVERAL =
  'Hook output is several JSON documents, treating as plain text'

const hooksSrc = readFileSync(join(import.meta.dir, '../hooks.ts'), 'utf8')

function jsonParseMessage(text: string): string {
  try {
    JSON.parse(text)
    throw new Error('expected JSON.parse to throw')
  } catch (e) {
    return errorMessage(e)
  }
}

function goldInvalidJsonMessage(text: string): string {
  return `${GOLD_PARSE_PREFIX}${jsonParseMessage(text)}. ${GOLD_PARSE_SUFFIX}`
}

describe('densable 2.1.248 #22 parseHookOutput lIe', () => {
  test('gold catch strings are in hooks.ts', () => {
    expect(hooksSrc).toContain(GOLD_PARSE_PREFIX)
    expect(hooksSrc).toContain(GOLD_PARSE_SUFFIX)
    expect(hooksSrc).toContain(GOLD_SEVERAL)
    expect(hooksSrc).not.toContain('Failed to parse hook output as JSON')
  })

  test('trimmed { invalid JSON object } is a hook error, not plain text', () => {
    const stdout = '  {not json}  \n'
    const result = parseHookOutput(stdout)
    expect(result.validationError).toBe(goldInvalidJsonMessage(stdout.trim()))
    expect(result.json).toBeUndefined()
  })

  test('schema-invalid JSON that parses stays leftover schema error', () => {
    const stdout = '{"decision":"maybe"}'
    const result = parseHookOutput(stdout)
    expect(result.validationError).toContain(
      'Hook JSON output validation failed',
    )
    expect(result.validationError).not.toContain(GOLD_PARSE_PREFIX)
    expect(result.json).toBeUndefined()
  })

  test('several empty JSON documents are plain text', () => {
    const stdout = '{}\n{}'
    const result = parseHookOutput(stdout)
    expect(result.validationError).toBeUndefined()
    expect(result.json).toBeUndefined()
    expect(result.plainText).toBe(stdout)
  })

  test('unclosed { is leftover plain text', () => {
    const stdout = '{"continue": true'
    const result = parseHookOutput(stdout)
    expect(result.validationError).toBeUndefined()
    expect(result.json).toBeUndefined()
    expect(result.plainText).toBe(stdout)
  })

  test('valid hook JSON still parses', () => {
    const result = parseHookOutput('{"continue": true}')
    expect(result.validationError).toBeUndefined()
    expect(result.json).toEqual({ continue: true })
  })

  test('stdout that does not start with { is leftover plain text', () => {
    const stdout = 'not an object'
    const result = parseHookOutput(stdout)
    expect(result.validationError).toBeUndefined()
    expect(result.json).toBeUndefined()
    expect(result.plainText).toBe(stdout)
  })
})
