// densable 2.1.239 #46 — tool-use row middle-truncates paths via hbo/e7h.
import { describe, expect, test } from 'bun:test'
import { getPlatform } from '../../utils/platform.js'
import { truncatePathMiddle } from '../../utils/truncate.js'
import {
  clampPathLabel,
  isLinkableAbsolutePath,
  toolUsePathWidth,
} from '../FilePathLink.js'

describe('densable 2.1.239 #46 tool-use path width', () => {
  test('e7h floors at 20 and subtracts dot + name + parens', () => {
    expect(toolUsePathWidth(80, true, 'Read')).toBe(
      Math.max(80 - 2 - 4 - 2, 20),
    )
    expect(toolUsePathWidth(80, false, 'Read')).toBe(
      Math.max(80 - 0 - 4 - 2, 20),
    )
    expect(toolUsePathWidth(10, true, 'ReadFile')).toBe(20)
  })

  test('hbo clamp only applies to string labels', () => {
    const wide = 'src/components/deeply/nested/folder/MyComponent.tsx'
    expect(clampPathLabel(wide, 24)).toBe(truncatePathMiddle(wide, 24))
    expect(clampPathLabel(wide, null)).toBe(wide)
    expect(clampPathLabel(12, 8)).toBe(12)
  })
})

describe('isLinkableAbsolutePath', () => {
  test('relative paths are not file:// links', () => {
    expect(isLinkableAbsolutePath('src/index.ts')).toBe(false)
    expect(isLinkableAbsolutePath('foo\\bar')).toBe(false)
  })

  test('platform absolute paths match official Ucs', () => {
    if (getPlatform() === 'windows') {
      expect(isLinkableAbsolutePath('C:\\Users\\a\\b.ts')).toBe(true)
      expect(isLinkableAbsolutePath('\\Users\\a')).toBe(false)
    } else {
      expect(isLinkableAbsolutePath('/usr/bin/env')).toBe(true)
    }
  })
})
