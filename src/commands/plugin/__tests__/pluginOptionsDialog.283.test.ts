import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildFieldDescriptors,
  buildFinalValues,
  requiredFieldError,
} from '../PluginOptionsDialog.js'
import type { PluginOptionSchema } from '../../../utils/plugins/pluginOptionsStorage.js'

const ROOT = join(import.meta.dir, '../../../..')

describe('buildFinalValues densable zs (2.1.283)', () => {
  test('first-line split + trim', () => {
    const schema: PluginOptionSchema = {
      token: { type: 'string', title: 'Token', description: 't' },
    }
    expect(
      buildFinalValues(['token'], { token: 'abc\ndef' }, schema, undefined),
    ).toEqual({ token: 'abc' })
    expect(
      buildFinalValues(
        ['token'],
        { token: '  abc\r\nrest' },
        schema,
        undefined,
      ),
    ).toEqual({ token: 'abc' })
    expect(
      buildFinalValues(['token'], { token: 'abc\rdef' }, schema, undefined),
    ).toEqual({ token: 'abc' })
  })

  test('empty sensitive omits when initial exists (keep existing)', () => {
    const schema: PluginOptionSchema = {
      secret: {
        type: 'string',
        title: 'Secret',
        description: 's',
        sensitive: true,
      },
    }
    expect(
      buildFinalValues(['secret'], { secret: '' }, schema, { secret: 'saved' }),
    ).toEqual({})
    expect(
      buildFinalValues(['secret'], { secret: '   \n' }, schema, {
        secret: 'saved',
      }),
    ).toEqual({})
  })

  test('empty number omit; empty non-required omit if no initial', () => {
    const schema: PluginOptionSchema = {
      n: { type: 'number', title: 'N', description: 'n' },
      opt: { type: 'string', title: 'Opt', description: 'o' },
      req: { type: 'string', title: 'Req', description: 'r', required: true },
    }
    expect(
      buildFinalValues(
        ['n', 'opt', 'req'],
        { n: '', opt: '', req: '' },
        schema,
        undefined,
      ),
    ).toEqual({ req: '' })
  })

  test('number/boolean/string coerce', () => {
    const schema: PluginOptionSchema = {
      n: { type: 'number', title: 'N', description: 'n' },
      b: { type: 'boolean', title: 'B', description: 'b' },
      s: { type: 'string', title: 'S', description: 's' },
    }
    expect(
      buildFinalValues(
        ['n', 'b', 's'],
        { n: '42', b: 'true', s: 'hi' },
        schema,
        undefined,
      ),
    ).toEqual({ n: 42, b: true, s: 'hi' })
    expect(buildFinalValues(['n'], { n: 'nope' }, schema, undefined)).toEqual({
      n: 'nope',
    })
  })
})

describe('Ao field list select vs text (2.1.283)', () => {
  test('string+options → select; sensitive mask *; existing secret placeholder (unchanged)', () => {
    const schema: PluginOptionSchema = {
      region: {
        type: 'string',
        title: 'Region',
        description: 'pick',
        options: ['us', 'eu'],
      },
      token: {
        type: 'string',
        title: 'Token',
        description: 'secret',
        sensitive: true,
        required: true,
      },
      name: { type: 'string', title: 'Name', description: 'n' },
    }
    const fields = buildFieldDescriptors(['region', 'token', 'name'], schema, {
      token: 'saved',
    })
    expect(fields[0]).toMatchObject({
      type: 'select',
      key: 'region',
      options: ['us', 'eu'],
    })
    expect(fields[1]).toMatchObject({
      type: 'text',
      key: 'token',
      mask: '*',
      placeholder: '(unchanged)',
      required: false,
    })
    expect(fields[2]).toMatchObject({
      type: 'text',
      key: 'name',
      mask: undefined,
      placeholder: undefined,
    })
  })

  test('dialog still uses Dialog chrome; no pane title bar / settings.set', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/plugin/PluginOptionsDialog.tsx'),
      'utf8',
    )
    expect(src).toContain('<Dialog')
    expect(src).toContain("type: 'select'")
    expect(src).toContain("mask: sensitive ? '*' : undefined")
    expect(src).toContain(
      "placeholder: existingSecret ? '(unchanged)' : undefined",
    )
    expect(src).not.toContain('settings.set')
    expect(src).not.toContain('Pane title')
    expect(src).toContain('Save configuration')
    expect(src).toContain('select:previous')
    expect(src).toContain('tabs:next')
  })

  test('MN required empty trim blocks submit', () => {
    const fields = buildFieldDescriptors(
      ['name'],
      {
        name: {
          type: 'string',
          title: 'Name',
          description: 'n',
          required: true,
        },
      },
      undefined,
    )
    expect(requiredFieldError(fields[0]!, '')).toBe('Name is required')
    expect(requiredFieldError(fields[0]!, '   ')).toBe('Name is required')
    expect(requiredFieldError(fields[0]!, 'ok')).toBe(null)
  })
})
