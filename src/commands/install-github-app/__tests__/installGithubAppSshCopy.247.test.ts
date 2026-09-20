/**
 * densable 2.1.247 #17 — /install-github-app SSH copy/open URL.
 * Official eo: ClipboardPath + /^c+$/ + gs() immediate URL + assumeSupport.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('install-github-app ssh url copy 247 #17', () => {
  const src = readFileSync(
    join(import.meta.dir, '../OAuthFlowStep.tsx'),
    'utf8',
  )

  test('c classifier is /^c+$/ and reports ClipboardPath not boolean', () => {
    expect(src).toContain('/^c+$/.test(pastedCode)')
    expect(src).toContain('useState<ClipboardPath | null>(null)')
    expect(src).toContain('getClipboardPath()')
    expect(src).toContain("path === 'native'")
    expect(src).not.toContain('urlCopied')
  })

  test('URL delay: headless immediate else 3000', () => {
    expect(src).toContain('isHeadlessBrowserEnvironment()')
    expect(src).toContain('setShowPastePrompt(true)')
    expect(src).toContain('setTimeout(() => setShowPastePrompt(true), 3000)')
  })

  test('official copy-result lines + assumeSupport', () => {
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
    expect(src).toContain('assumeSupport')
    expect(src).toContain('probeLinuxClipboardTool()')
  })
})
