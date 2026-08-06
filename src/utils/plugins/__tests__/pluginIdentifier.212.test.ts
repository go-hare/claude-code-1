/**
 * densable 2.1.212 #30 — hi / Lwe / are plugin id helpers
 */
import { describe, expect, test } from 'bun:test'
import {
  findPluginKeyCaseInsensitive,
  parsePluginIdentifier,
  pluginIdEquals,
} from '../pluginIdentifier.js'

describe('densable #30 pluginIdentifier hi/Lwe/are', () => {
  test('hi parsePluginIdentifier splits on first @ only', () => {
    expect(parsePluginIdentifier('foo@bar')).toEqual({
      name: 'foo',
      marketplace: 'bar',
    })
    expect(parsePluginIdentifier('foo@bar@baz')).toEqual({
      name: 'foo',
      marketplace: 'bar',
    })
    expect(parsePluginIdentifier('solo')).toEqual({ name: 'solo' })
  })

  test('Lwe pluginIdEquals is case-insensitive', () => {
    expect(pluginIdEquals('Foo', 'foo')).toBe(true)
    expect(pluginIdEquals('a@b', 'A@B')).toBe(true)
    expect(pluginIdEquals('a', 'b')).toBe(false)
  })

  test('are findPluginKeyCaseInsensitive prefers exact then Lwe', () => {
    const keys = ['Foo@Mkt', 'other']
    expect(findPluginKeyCaseInsensitive(keys, 'Foo@Mkt')).toBe('Foo@Mkt')
    expect(findPluginKeyCaseInsensitive(keys, 'foo@mkt')).toBe('Foo@Mkt')
    expect(findPluginKeyCaseInsensitive(keys, 'missing')).toBeUndefined()
  })
})
