/**
 * Regression: empty FooterLinkBadges must not enter Byline parts.
 * Otherwise footer shows "auto on … · · ← for agents" (stray middot).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const footerLeftSide = readFileSync(
  join(import.meta.dir, '../PromptInputFooterLeftSide.tsx'),
  'utf8',
)
const badges = readFileSync(
  join(import.meta.dir, '../FooterLinkBadges.tsx'),
  'utf8',
)

describe('footer empty FooterLinkBadges · regression', () => {
  test('useHasVisibleFooterLinks is exported and used before Byline parts push', () => {
    expect(badges).toContain('export function useHasVisibleFooterLinks')
    expect(footerLeftSide).toContain('useHasVisibleFooterLinks')
    expect(footerLeftSide).toContain('hasVisibleFooterLinks')
    // Conditionally spread — not always-push element that returns null
    expect(footerLeftSide).toMatch(
      /\.\.\.\(hasVisibleFooterLinks\s*\?\s*\[<FooterLinkBadges/,
    )
    // Must NOT always include bare <FooterLinkBadges without gate
    expect(footerLeftSide).not.toMatch(
      /^\s*<FooterLinkBadges key="footer-links"/m,
    )
  })
})
