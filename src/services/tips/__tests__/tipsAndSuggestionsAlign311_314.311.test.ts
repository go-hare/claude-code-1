import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { extractIgnoreReincludeRules } from '../../../hooks/fileSuggestions.js'

describe('#1224, #1396, #1418 tips registry & policy gating', () => {
  test('tipRegistry includes explanatory-output-style, push-notif, and policy-gated web-app', () => {
    const src = readFileSync(join(__dirname, '..', 'tipRegistry.ts'), 'utf8')
    expect(src).toContain("id: 'explanatory-output-style'")
    expect(src).toContain(
      'Want Claude to teach as it works? · /config outputStyle=explanatory',
    )
    expect(src).toContain("id: 'push-notif'")
    expect(src).toContain('isPushNotifTipRelevant')
    expect(src).toContain("isRemotePolicyAllowed('allow_remote_sessions')")
    expect(src).toContain("isRemotePolicyAllowed('allow_remote_control')")
  })
})

describe('#1233 fileSuggestions .ignore/.rgignore negation rules', () => {
  test('extractIgnoreReincludeRules tracks !pattern negation and builds augmentations', () => {
    const res = extractIgnoreReincludeRules(
      ['*.log', '!important.log', '!dist/bundle.js'],
      '',
    )
    expect(res.hasNegation).toBe(true)
    expect(res.augmentations).toContain('**/important.log/**')
    expect(res.augmentations).toContain('dist/bundle.js/**')
    expect(res.rules).toEqual(['!*.log', 'important.log', 'dist/bundle.js'])
  })

  test('extractIgnoreReincludeRules returns hasNegation=false when no negations', () => {
    const res = extractIgnoreReincludeRules(
      ['node_modules/', '# comment'],
      'sub',
    )
    expect(res.hasNegation).toBe(false)
    expect(res.augmentations).toEqual([])
    expect(res.rules).toEqual(['!sub/**/node_modules/'])
  })
})

describe('#1298 claude purge local-only notice', () => {
  test('purgeProject.ts prints local-only deletion notice in printPlan', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'cli', 'handlers', 'purgeProject.ts'),
      'utf8',
    )
    expect(src).toContain(
      'Purging deletes data only on this computer, not anything stored by Anthropic.',
    )
  })
})
