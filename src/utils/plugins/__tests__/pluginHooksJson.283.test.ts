/**
 * densable 2.1.283 JSON hooks: PluginHooksSchema `$schema` / unknown-key
 * warn, and Fe/ut unquoted plugin-path placeholder warnings.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  collectUnknownPluginHooksJsonKeyWarnings,
  PluginHooksSchema,
} from '../schemas.js'
import {
  findUnquotedPluginPlaceholders,
  validatePluginContents,
  warnUnquotedPluginPlaceholders,
} from '../validatePlugin.js'

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

describe('PluginHooksSchema $schema (densable Xmn)', () => {
  test('accepts $schema string and keeps description/hooks', () => {
    const parsed = PluginHooksSchema().parse({
      $schema: 'https://example.com/hooks.schema.json',
      description: 'teardown',
      hooks: {
        SessionEnd: [
          { matcher: '*', hooks: [{ type: 'command', command: 'true' }] },
        ],
      },
    })
    expect(parsed.$schema).toBe('https://example.com/hooks.schema.json')
    expect(parsed.description).toBe('teardown')
    expect(parsed.hooks?.SessionEnd).toHaveLength(1)
  })

  test('non-string $schema is caught as undefined, parse still succeeds', () => {
    const parsed = PluginHooksSchema().parse({
      $schema: 12,
      hooks: {
        SessionEnd: [
          { matcher: '*', hooks: [{ type: 'command', command: 'true' }] },
        ],
      },
    })
    expect(parsed.$schema).toBeUndefined()
  })

  test('modules-only hooks.json is valid', () => {
    const parsed = PluginHooksSchema().parse({
      modules: ['./hooks.ts'],
    })
    expect(parsed.modules).toEqual(['./hooks.ts'])
    expect(parsed.hooks).toBeUndefined()
  })

  test('empty object fails refine (need hooks or modules)', () => {
    const result = PluginHooksSchema().safeParse({})
    expect(result.success).toBe(false)
  })

  test('surface is refused with gold gone copy', () => {
    const result = PluginHooksSchema().safeParse({
      surface: './board.tsx',
      hooks: {
        SessionEnd: [
          { matcher: '*', hooks: [{ type: 'command', command: 'true' }] },
        ],
      },
    })
    expect(result.success).toBe(false)
    const blob = JSON.stringify(result)
    expect(blob).toContain('hooks.json `surface` is gone')
  })
})

describe('collectUnknownPluginHooksJsonKeyWarnings (densable t6e)', () => {
  test('does not warn for $schema description hooks modules surface', () => {
    expect(
      collectUnknownPluginHooksJsonKeyWarnings({
        $schema: 'https://example.com/schema.json',
        description: 'x',
        hooks: {
          SessionEnd: [
            { matcher: '*', hooks: [{ type: 'command', command: 'true' }] },
          ],
        },
        modules: ['./a.ts'],
      }),
    ).toEqual([])
  })

  test('warns unknown top-level keys without failing', () => {
    const warnings = collectUnknownPluginHooksJsonKeyWarnings({
      extra: 1,
      hooks: {
        SessionEnd: [
          { matcher: '*', hooks: [{ type: 'command', command: 'true' }] },
        ],
      },
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('hooks.json: unknown key "extra" ignored')
  })
})

describe('warnUnquotedPluginPlaceholders (densable Fe/ut)', () => {
  test('flags unquoted ${CLAUDE_PLUGIN_ROOT} in shell command form', () => {
    expect(
      findUnquotedPluginPlaceholders('${CLAUDE_PLUGIN_ROOT}/bin/hook.sh'),
    ).toEqual(['${CLAUDE_PLUGIN_ROOT}'])
  })

  test('flags bare $CLAUDE_PROJECT_DIR', () => {
    expect(findUnquotedPluginPlaceholders('$CLAUDE_PROJECT_DIR/hook')).toEqual([
      '${CLAUDE_PROJECT_DIR}',
    ])
  })

  test('skips quoted placeholders', () => {
    expect(
      findUnquotedPluginPlaceholders('"${CLAUDE_PLUGIN_ROOT}/bin/hook.sh"'),
    ).toEqual([])
    expect(findUnquotedPluginPlaceholders("'${CLAUDE_PLUGIN_DATA}/x'")).toEqual(
      [],
    )
  })

  test('skips exec-form args and powershell', () => {
    const hits = warnUnquotedPluginPlaceholders({
      SessionEnd: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node',
              args: ['${CLAUDE_PLUGIN_ROOT}/hook.js'],
            },
            {
              type: 'command',
              command: '${CLAUDE_PLUGIN_ROOT}/hook.ps1',
              shell: 'powershell',
            },
            {
              type: 'command',
              command: '${CLAUDE_PLUGIN_ROOT}/bin/hook.sh',
            },
          ],
        },
      ],
    })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.event).toBe('SessionEnd')
    expect(hits[0]?.placeholders).toEqual(['${CLAUDE_PLUGIN_ROOT}'])
  })
})

describe('validatePluginContents hooks.json Fe/ut warning', () => {
  test('adds gold unquoted-placeholder warning after schema parse', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-hooks-283-'))
    tempDirs.push(dir)
    await mkdir(join(dir, 'hooks'))
    await writeFile(
      join(dir, 'hooks', 'hooks.json'),
      JSON.stringify({
        $schema: 'https://example.com/hooks.schema.json',
        extra: true,
        hooks: {
          SessionEnd: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: '${CLAUDE_PLUGIN_ROOT}/bin/session-end.sh',
                },
              ],
            },
          ],
        },
      }),
    )
    const results = await validatePluginContents(dir)
    const hooks = results.find(r => r.fileType === 'hooks')
    expect(hooks?.success).toBe(true)
    expect(hooks?.errors).toEqual([])
    const messages = (hooks?.warnings ?? []).map(w => w.message)
    expect(messages.some(m => m.includes('unknown key "extra" ignored'))).toBe(
      true,
    )
    expect(
      messages.some(m =>
        m.includes(
          'Shell command uses ${CLAUDE_PLUGIN_ROOT} without quotes: ${CLAUDE_PLUGIN_ROOT}/bin/session-end.sh',
        ),
      ),
    ).toBe(true)
    expect(
      messages.some(m =>
        m.includes(
          'Wrap the placeholder in double quotes, or use exec form: {"command": "<executable>", "args": ["${CLAUDE_PLUGIN_ROOT}/..."]}.',
        ),
      ),
    ).toBe(true)
  })
})
