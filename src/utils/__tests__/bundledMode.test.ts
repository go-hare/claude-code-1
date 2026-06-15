import { describe, expect, test } from 'bun:test'
import { isBunCompiledVirtualPath } from '../bundledMode'

describe('isBunCompiledVirtualPath', () => {
  test('detects macOS/Linux compiled entry paths', () => {
    expect(isBunCompiledVirtualPath('compiled://root/claude')).toBe(true)
  })

  test('detects Windows Bun virtual entry paths', () => {
    expect(isBunCompiledVirtualPath('B:/~BUN/root/claude.exe')).toBe(true)
  })

  test('detects normalized Windows Bun virtual paths nested in argv', () => {
    expect(isBunCompiledVirtualPath('C:\\tmp\\~BUN\\root\\claude.exe')).toBe(
      true,
    )
  })

  test('does not treat regular script paths as compiled entry paths', () => {
    expect(
      isBunCompiledVirtualPath('D:\\work\\src\\entrypoints\\cli.tsx'),
    ).toBe(false)
  })
})
