import { describe, expect, test } from 'bun:test'
import {
  chromeDomainSetsFromContext,
  createChromeOnPermissionRequest,
  isChromeHostInSet,
} from '../chromeCallPermission.js'

describe('chromeCallPermission host:80 deny/allow (#365)', () => {
  test('parses host:80 rules from chrome permission rules', () => {
    const ctx = {
      alwaysAllowRules: {},
      alwaysDenyRules: {
        userSettings: ['mcp__claude-in-chrome__navigate:example.com:80'],
      },
    } as never
    const sets = chromeDomainSetsFromContext(ctx)
    expect(sets.denied.has('example.com:80')).toBe(true)
    expect(
      isChromeHostInSet(sets.denied, 'example.com', 'http://example.com/page'),
    ).toBe(true)
    expect(
      isChromeHostInSet(sets.denied, 'example.com', 'https://example.com/page'),
    ).toBe(false)
  })

  test('createChromeOnPermissionRequest matches host:80 for plain http', async () => {
    const onPerm = createChromeOnPermissionRequest(new Set(['example.com:80']))
    expect(
      await onPerm({ url: 'http://example.com/index.html' } as never),
    ).toBe(true)
    expect(
      await onPerm({ url: 'https://example.com/index.html' } as never),
    ).toBe(false)
  })
})
