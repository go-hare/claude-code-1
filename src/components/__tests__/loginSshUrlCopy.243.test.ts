import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('login-ssh-url-copy 243 #48', () => {
  const src = readFileSync(
    join(import.meta.dir, '../ConsoleOAuthFlow.tsx'),
    'utf8',
  )

  test('c classifier is /^c+$/ and reports ClipboardPath not boolean', () => {
    expect(src).toContain('/^c+$/.test(pastedCode)')
    expect(src).toContain('useState<ClipboardPath | null>(null)')
    expect(src).toContain('getClipboardPath()')
    expect(src).toContain("path === 'native'")
    expect(src).not.toContain('urlCopied')
  })

  test('URL delay: Xo/D immediate else 3000', () => {
    expect(src).toContain('isHeadlessBrowserEnvironment()')
    expect(src).toContain('setShowPastePrompt(true)')
    expect(src).toContain('setTimeout(() => setShowPastePrompt(true), 3000)')
  })

  test('official copy-result lines', () => {
    expect(src).toContain(
      'Browser didn&apos;t open? Use the url below to sign in',
    )
    expect(src).toContain('(Copied!)')
    expect(src).toContain(
      '(Copied to tmux buffer · select the URL manually if paste fails)',
    )
    expect(src).toContain(
      '(Sent via OSC 52 · select the URL manually if paste fails)',
    )
    expect(src).toContain(
      'while selecting to use your terminal&apos;s native copy',
    )
    expect(src).toContain('getNativeSelectionHoldKey()')
    expect(src).not.toContain(
      "If your browser doesn't open automatically, copy this URL manually",
    )
  })

  test('fr hint gates on fullscreen + mouse not off; Vo probes on show', () => {
    expect(src).toContain(
      'isFullscreenActive() && resolveMouseTrackingMode() !== ',
    )
    expect(src).toContain("!== 'off'")
    expect(src).toContain('probeLinuxClipboardTool()')
  })
})
