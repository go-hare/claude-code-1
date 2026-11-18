import { describe, expect, test } from 'bun:test'
import { supportsHyperlinks } from '../supports-hyperlinks.js'

describe('supportsHyperlinks FORCE_HYPERLINK falsy values (2.1.314 #1447)', () => {
  test.each([
    'false',
    'FALSE',
    'no',
    'NO',
    'off',
    'OFF',
    ' off ',
    '0',
  ])('FORCE_HYPERLINK=%p turns hyperlinks off even when stdout supports them', value => {
    expect(
      supportsHyperlinks({
        env: { FORCE_HYPERLINK: value },
        stdoutSupported: true,
      }),
    ).toBe(false)
  })

  test.each([
    'true',
    'yes',
    'on',
    '1',
  ])('FORCE_HYPERLINK=%p turns hyperlinks on even when stdout does not support them', value => {
    expect(
      supportsHyperlinks({
        env: { FORCE_HYPERLINK: value },
        stdoutSupported: false,
      }),
    ).toBe(true)
  })
})
