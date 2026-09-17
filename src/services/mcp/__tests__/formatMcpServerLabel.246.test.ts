import { describe, expect, test } from 'bun:test'
import {
  formatMcpServerLabel,
  parsePluginMcpServerName,
} from '../formatMcpServerLabel.js'

describe('densable 2.1.246 UKc formatMcpServerLabel', () => {
  test('non-plugin returns the raw name', () => {
    expect(formatMcpServerLabel('filesystem', false)).toBe('filesystem')
    expect(formatMcpServerLabel('plugin:foo:bar', false)).toBe('plugin:foo:bar')
  })

  test('plugin key becomes "server (from plugin name)"', () => {
    expect(formatMcpServerLabel('plugin:slack:alerts', true)).toBe(
      'alerts (from plugin slack)',
    )
  })

  test('server segment may contain further colons', () => {
    expect(formatMcpServerLabel('plugin:acme:a:b', true)).toBe(
      'a:b (from plugin acme)',
    )
  })

  test('plugin flag with unparseable name does not invent a suffix', () => {
    expect(formatMcpServerLabel('filesystem', true)).toBe('filesystem')
    expect(formatMcpServerLabel('plugin:only-two', true)).toBe(
      'plugin:only-two',
    )
  })

  // Local hardening, not part of the densable UKc contract.
  test('control characters in an untrusted name cannot restructure the dialog', () => {
    expect(formatMcpServerLabel('evil\nAllow all tools', false)).toBe(
      'evil\uFFFDAllow all tools',
    )
    expect(formatMcpServerLabel('evil\roverwrite', false)).toBe(
      'evil\uFFFDoverwrite',
    )
    expect(formatMcpServerLabel('evil\u001b[2Kesc', false)).toBe(
      'evil\uFFFD[2Kesc',
    )
    expect(formatMcpServerLabel('plugin:sl\nack:al\nerts', true)).toBe(
      'al\uFFFDerts (from plugin sl\uFFFDack)',
    )
    // Ordinary punctuation and non-ASCII names are untouched.
    expect(formatMcpServerLabel('my-server_v2.1', false)).toBe('my-server_v2.1')
    expect(formatMcpServerLabel('服务器', false)).toBe('服务器')
  })

  test('es requires plugin: + at least three segments', () => {
    expect(parsePluginMcpServerName('plugin:x:y')).toEqual({
      pluginName: 'x',
      serverName: 'y',
    })
    expect(parsePluginMcpServerName('plugin:x')).toBeUndefined()
    expect(parsePluginMcpServerName('x:y:z')).toBeUndefined()
  })
})
