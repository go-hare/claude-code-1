/**
 * Official 2.1.207: custom launcher at ~/.local/bin/claude must not be
 * overwritten, and version cleanup must skip when the launcher is external.
 */
import { describe, expect, test } from 'bun:test'
import {
  isNativeInstallerSymlinkTarget,
  isNpmShimResolvedPath,
  NATIVE_VERSIONS_PATH_MARKER,
} from '../installer.js'

describe('isNativeInstallerSymlinkTarget', () => {
  test('accepts paths under claude/versions/', () => {
    expect(
      isNativeInstallerSymlinkTarget(
        `/Users/u/.local/share/claude/versions/2.1.207`,
      ),
    ).toBe(true)
    expect(NATIVE_VERSIONS_PATH_MARKER.includes('versions')).toBe(true)
  })

  test('rejects unrelated paths', () => {
    expect(isNativeInstallerSymlinkTarget('/usr/local/bin/claude')).toBe(false)
    expect(isNativeInstallerSymlinkTarget('/home/u/my-wrapper.sh')).toBe(false)
    expect(isNativeInstallerSymlinkTarget('/opt/claude/bin/claude')).toBe(false)
  })
})

describe('isNpmShimResolvedPath', () => {
  test('accepts .js entry and node_modules paths', () => {
    expect(
      isNpmShimResolvedPath(
        '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js',
      ),
    ).toBe(true)
    expect(isNpmShimResolvedPath('/tmp/claude.js')).toBe(true)
  })

  test('rejects native binaries and custom scripts', () => {
    expect(
      isNpmShimResolvedPath('/Users/u/.local/share/claude/versions/2.1.207'),
    ).toBe(false)
    expect(isNpmShimResolvedPath('/home/u/bin/my-claude')).toBe(false)
  })
})

describe('external launcher ownership matrix', () => {
  test('custom script is neither native nor npm', () => {
    const custom = '/home/u/.local/bin/my-claude-wrapper'
    expect(isNativeInstallerSymlinkTarget(custom)).toBe(false)
    expect(isNpmShimResolvedPath(custom)).toBe(false)
  })

  test('native versions target is owned', () => {
    const native = '/Users/u/.local/share/claude/versions/2.1.207'
    expect(isNativeInstallerSymlinkTarget(native)).toBe(true)
    expect(isNpmShimResolvedPath(native)).toBe(false)
  })
})
