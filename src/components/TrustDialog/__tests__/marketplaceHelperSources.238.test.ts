/**
 * densable 2.1.238 — TrustDialog SEA BSy/aRs/sRs headersHelper disclosure.
 * Prefer source-lock + pure helpers to avoid process-global mock.module pollution.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import {
  ACCESSING_HEADERS_HELPER_PREFIX,
  ACCESSING_HEADERS_HELPER_TRUST_NOTE,
} from '../trustDialogCopy.js'
import { formatEnglishSourceList } from '../utils.js'

describe('TrustDialog marketplaceHelperSources densable 2.1.238', () => {
  test('SEA copy constants match gold', () => {
    expect(ACCESSING_HEADERS_HELPER_PREFIX).toBe(
      'This folder runs commands to mint HTTP headers (headersHelper), declared in ',
    )
    expect(ACCESSING_HEADERS_HELPER_TRUST_NOTE).toBe(
      'These will apply without asking. Only proceed if you trust this configuration.',
    )
  })

  test('formatEnglishSourceList matches SEA LKe', () => {
    expect(formatEnglishSourceList([])).toBe('')
    expect(formatEnglishSourceList(['a'])).toBe('a')
    expect(formatEnglishSourceList(['a', 'b'])).toBe('a and b')
    expect(formatEnglishSourceList(['a', 'b', 'c'])).toBe('a, b, and c')
    expect(formatEnglishSourceList(['a', 'b', 'c', 'd'], 2)).toBe(
      'a, b, and 2 more',
    )
  })

  test('utils exports BSy/aRs/sRs collectors', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../utils.ts'),
      'utf8',
    )
    expect(src).toContain(
      'export function settingsDeclareUntrustedMarketplaceHeadersHelper',
    )
    expect(src).toContain('export function getMarketplaceHelperSources')
    expect(src).toContain('export function getRepoHeadersHelperSources')
    expect(src).toContain("source.source === 'url'")
    expect(src).toContain('/^https:\\/\\//i.test(source.url)')
    expect(src).toContain("sources.push('.mcp.json')")
    expect(src).toContain('local-scope MCP servers for this project')
  })

  test('TrustDialog wires repoHelperSources + SEA copy', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../TrustDialog.tsx'),
      'utf8',
    )
    expect(src).toContain('getMarketplaceHelperSources')
    expect(src).toContain('getRepoHeadersHelperSources')
    expect(src).toContain('ACCESSING_HEADERS_HELPER_PREFIX')
    expect(src).toContain('ACCESSING_HEADERS_HELPER_TRUST_NOTE')
    expect(src).toContain('hasMarketplaceHeadersHelper')
    expect(src).toContain('hasRepoHeadersHelpers')
    expect(src).toContain('formatEnglishSourceList(repoHelperSources)')
  })
})
