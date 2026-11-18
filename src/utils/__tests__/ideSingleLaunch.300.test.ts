import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'

describe('2.1.300 #788 IDE extension single CLI launch', () => {
  test('setupIDEAutoInstall does not call isIDEExtensionInstalled before maybeInstallIDEExtension for VSCode IDEs', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../ide.ts'), 'utf8')
    const idx = src.indexOf('if (isVSCodeIde(ideType)) {')
    // Find the setupIDEAutoInstall occurrence (the last one)
    const lastIdx = src.lastIndexOf('if (isVSCodeIde(ideType)) {')
    expect(idx).toBeGreaterThan(-1)
    const block = src.slice(lastIdx, lastIdx + 1400)
    expect(block).toContain('maybeInstallIDEExtension(ideType)')
    expect(block).not.toContain('isIDEExtensionInstalled(ideType)')
    expect(block).toContain('!status?.previouslyInstalled')
  })
})
