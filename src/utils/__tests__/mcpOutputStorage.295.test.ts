import { describe, expect, test } from 'bun:test'
import { extensionForMimeType } from '../mcpOutputStorage.js'

describe('extensionForMimeType (#363)', () => {
  test('maps CSS, JS, XML, webmanifest, icons, fonts, and wasm', () => {
    expect(extensionForMimeType('image/x-icon')).toBe('ico')
    expect(extensionForMimeType('image/vnd.microsoft.icon')).toBe('ico')
    expect(extensionForMimeType('text/css; charset=utf-8')).toBe('css')
    expect(extensionForMimeType('text/javascript')).toBe('js')
    expect(extensionForMimeType('application/javascript')).toBe('js')
    expect(extensionForMimeType('application/xml')).toBe('xml')
    expect(extensionForMimeType('text/xml')).toBe('xml')
    expect(extensionForMimeType('application/manifest+json')).toBe(
      'webmanifest',
    )
    expect(extensionForMimeType('font/woff2')).toBe('woff2')
    expect(extensionForMimeType('application/font-woff2')).toBe('woff2')
    expect(extensionForMimeType('font/woff')).toBe('woff')
    expect(extensionForMimeType('application/font-woff')).toBe('woff')
    expect(extensionForMimeType('font/ttf')).toBe('ttf')
    expect(extensionForMimeType('font/otf')).toBe('otf')
    expect(extensionForMimeType('application/wasm')).toBe('wasm')
    expect(extensionForMimeType('application/octet-stream')).toBe('bin')
  })
})
