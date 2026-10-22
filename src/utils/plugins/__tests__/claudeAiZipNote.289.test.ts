import { describe, expect, test } from 'bun:test'
import {
  countClaudeAiZipStemMismatches,
  formatClaudeAiMarketplaceNote,
} from '../marketplaceHelpers.js'
import type { PluginMarketplace } from '../schemas.js'

describe('densable 2.1.289 $u zip-stem marketplace note', () => {
  test('counts claudeai catalog version vs zip stem', () => {
    const catalog = {
      name: 'hosted',
      owner: { name: 'claude.ai' },
      plugins: [
        {
          name: 'demo',
          source: { source: 'claudeai', version: '1.2.3' },
        },
      ],
    } as unknown as PluginMarketplace
    expect(
      countClaudeAiZipStemMismatches(catalog, [
        { name: 'demo', path: '/cache/1.0.0.zip' },
      ]),
    ).toBe(1)
    expect(
      countClaudeAiZipStemMismatches(catalog, [
        { name: 'demo', path: '/cache/1.2.3.zip' },
      ]),
    ).toBe(0)
  })

  test('skips empty version and non-claudeai sources', () => {
    const catalog = {
      name: 'hosted',
      owner: { name: 'x' },
      plugins: [
        { name: 'a', source: { source: 'claudeai', version: '' } },
        { name: 'b', source: { source: 'github', repo: 'o/r' } },
        { name: 'c', source: './local' },
      ],
    } as unknown as PluginMarketplace
    expect(
      countClaudeAiZipStemMismatches(catalog, [
        { name: 'a', path: '/a.zip' },
        { name: 'b', path: '/b.zip' },
        { name: 'c', path: '/c.zip' },
      ]),
    ).toBe(0)
  })

  test('formats gold note copy', () => {
    expect(formatClaudeAiMarketplaceNote(0)).toBeUndefined()
    expect(formatClaudeAiMarketplaceNote(1)).toBe(
      '1 plugin update available · update the marketplace to apply',
    )
    expect(formatClaudeAiMarketplaceNote(2)).toBe(
      '2 plugin updates available · update the marketplace to apply',
    )
    expect(formatClaudeAiMarketplaceNote(1, 'load failed')).toBe('load failed')
  })
})
