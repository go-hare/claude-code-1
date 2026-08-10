/**
 * densable 2.1.221 #31 — plugins skills: "." (plugin root).
 */
import { describe, expect, test } from 'bun:test'
import { PluginManifestSchema } from '../schemas.js'

describe('PluginManifestSchema skills densable 2.1.221', () => {
  test('accepts skills: "."', () => {
    const r = PluginManifestSchema().safeParse({
      name: 'root-skill-plugin',
      skills: '.',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.skills).toBe('.')
    }
  })

  test('accepts skills array including "."', () => {
    const r = PluginManifestSchema().safeParse({
      name: 'multi-skill-plugin',
      skills: ['.', './extra-skills'],
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.skills).toEqual(['.', './extra-skills'])
    }
  })

  test('still accepts relative ./skills path', () => {
    const r = PluginManifestSchema().safeParse({
      name: 'classic-plugin',
      skills: './my-skills',
    })
    expect(r.success).toBe(true)
  })

  test('rejects bare non-dot path without ./', () => {
    const r = PluginManifestSchema().safeParse({
      name: 'bad-plugin',
      skills: 'skills',
    })
    expect(r.success).toBe(false)
  })
})
