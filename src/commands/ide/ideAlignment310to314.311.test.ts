import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  formatIdeInstallOutcome,
  formatJetBrainsMissingPluginMessage,
} from './ide.js'

describe('/ide 2.1.311 alignment (#1248, #1260)', () => {
  test('#1248: formatIdeInstallOutcome distinguishes installed, previouslyInstalled, error, and not-installed', () => {
    const installedMsg = formatIdeInstallOutcome('vscode', { installed: true })
    expect(installedMsg).toContain('Installed the Claude Code extension in')

    const prevMsg = formatIdeInstallOutcome('vscode', {
      installed: true,
      previouslyInstalled: true,
    })
    expect(prevMsg).toContain('Reload Window')

    const errMsg = formatIdeInstallOutcome('vscode', {
      installed: false,
      error: 'permission denied',
    })
    expect(errMsg).toContain("Couldn't install the Claude Code extension in")
    expect(errMsg).toContain('permission denied')

    const skippedMsg = formatIdeInstallOutcome('vscode', undefined)
    expect(skippedMsg).toContain("Didn't install the Claude Code extension in")
    expect(skippedMsg).not.toContain('Installed the Claude Code extension')
  })

  test('#1260: formatJetBrainsMissingPluginMessage does not claim plugin was installed', () => {
    const msg = formatJetBrainsMissingPluginMessage('intellij')
    expect(msg).toContain("Couldn't find the Claude Code plugin running in")
    expect(msg).toContain('JetBrains Marketplace')
    expect(msg).not.toContain('Installed plugin to')
  })

  test('#1248 & #1260: ide.tsx awaits installExtension via InstallExtensionWaiter and handles JetBrains separately', () => {
    const src = readFileSync(join(import.meta.dir, 'ide.tsx'), 'utf8')
    expect(src).toContain('InstallExtensionWaiter')
    expect(src).toContain('formatJetBrainsMissingPluginMessage')
    expect(src).not.toContain('Installed plugin to')
  })
})
