/**
 * densable 2.1.283 gold BODY — `--json-schema` / StructuredOutput extra-turn.
 *
 * Official: tools=[] + output_format json_schema + max_turns=1 must keep
 * StructuredOutput in the first-turn pool (Stop-hook retry otherwise burns
 * the only turn). Gold Vko / parse / Fi / append-after-getTools.
 *
 * QueryEngine turnCount: gold `Pt++` @ 190856339 increments on every
 * `n.type==="user"` including Stop-hook meta users — no skip landed.
 *
 * Gold pe/ze `endsTurn:!0` @ 181130570 + smo/Ud @ 190790198: StructuredOutput
 * completes without a recursive query turn so max_turns=1 does not fire.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createSyntheticOutputTool,
  isSyntheticOutputToolEnabled,
  SYNTHETIC_OUTPUT_TOOL_NAME,
} from '@claude-code/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { filterToolsByDenyRules } from '../../tools.js'

const ROOT = join(import.meta.dir, '../../..')

const SUM_SCHEMA = {
  type: 'object',
  properties: { sum: { type: 'number' } },
  required: ['sum'],
} as const

describe('densable 2.1.283 json-schema / StructuredOutput', () => {
  test('Vko: isSyntheticOutputToolEnabled ORs isBgSession', () => {
    expect(
      isSyntheticOutputToolEnabled({ isNonInteractiveSession: false }),
    ).toBe(false)
    expect(
      isSyntheticOutputToolEnabled({
        isNonInteractiveSession: false,
        isBgSession: false,
      }),
    ).toBe(false)
    expect(
      isSyntheticOutputToolEnabled({ isNonInteractiveSession: true }),
    ).toBe(true)
    expect(
      isSyntheticOutputToolEnabled({
        isNonInteractiveSession: false,
        isBgSession: true,
      }),
    ).toBe(true)
  })

  test('--tools "" deny-all keeps StructuredOutput in assembled pool', () => {
    const created = createSyntheticOutputTool({ ...SUM_SCHEMA })
    expect('tool' in created).toBe(true)
    if (!('tool' in created)) return

    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        cliArg: ['Bash', 'Read', 'Edit', SYNTHETIC_OUTPUT_TOOL_NAME],
      },
    }
    const result = filterToolsByDenyRules(
      [{ name: 'Bash' }, { name: 'Read' }, created.tool],
      ctx,
    )
    expect(result.some(t => t.name === SYNTHETIC_OUTPUT_TOOL_NAME)).toBe(true)
    expect(result.some(t => t.name === 'Bash')).toBe(false)
    expect(result.some(t => t.name === 'Read')).toBe(false)
  })

  test('permissionSetup never puts StructuredOutput on toolsToDisallow', () => {
    const src = readFileSync(
      join(ROOT, 'src/utils/permissions/permissionSetup.ts'),
      'utf8',
    )
    expect(src).toContain('SYNTHETIC_OUTPUT_TOOL_NAME')
    expect(src).toContain(
      'tool !== SYNTHETIC_OUTPUT_TOOL_NAME && !baseToolsSet.has(tool)',
    )
  })

  test('print.ts always re-appends StructuredOutput for jsonSchema or init schema', () => {
    const src = readFileSync(join(ROOT, 'src/cli/print.ts'), 'utf8')
    expect(src).toContain('options.jsonSchema ?? initJsonSchema')
    expect(src).toContain('toolMatchesName(tool, SYNTHETIC_OUTPUT_TOOL_NAME)')
    expect(src).not.toContain('if (initJsonSchema && !options.jsonSchema)')
  })

  test('invalid JSON / non-object / invalid schema use gold Fi strings', () => {
    const src = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8')
    expect(src).toContain(
      'Error: --json-schema is not valid JSON: ${errorMessage(s)}',
    )
    expect(src).toContain('Error: --json-schema must be a JSON object')
    expect(src).toContain(
      'Error: --json-schema is not a valid JSON Schema: ${syntheticOutputResult.error}',
    )
    expect(src).toContain('isBgSession: isBgSession()')
    expect(src).toContain('process.exit(1)')
  })

  test('StructuredOutput call returns densable endsTurn so max_turns=1 does not recurse', async () => {
    const created = createSyntheticOutputTool({ ...SUM_SCHEMA })
    expect('tool' in created).toBe(true)
    if (!('tool' in created)) return
    const out = await created.tool.call(
      { sum: 5 },
      {} as never,
      {} as never,
      {} as never,
    )
    expect(out).toEqual(
      expect.objectContaining({
        structured_output: { sum: 5 },
        endsTurn: true,
      }),
    )
    const querySrc = readFileSync(join(ROOT, 'src/query.ts'), 'utf8')
    expect(querySrc).toContain('tengu_mcp_tool_result_ended_turn')
    expect(querySrc).toContain('if (toolRequestedEndTurn)')
  })

  test('createSyntheticOutputTool returns gold-style schema error', () => {
    const bad = createSyntheticOutputTool({
      type: 'object',
      properties: { n: { type: 'not-a-json-type' } },
    })
    expect('error' in bad).toBe(true)
    if (!('error' in bad)) return
    expect(typeof bad.error).toBe('string')
    expect(bad.error.length).toBeGreaterThan(0)
  })
})
