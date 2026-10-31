/**
 * densable 2.1.289 jj / C$t / a5n screening plus BZt slash.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  hasUltraplanKeyword,
  stampSlashNameOnlyPastedGaps,
} from '../ultraplanKeyword.js'

const SRC = join(import.meta.dir, '../ultraplanKeyword.ts')
const SUBMIT = join(import.meta.dir, '../handlePromptSubmit.ts')
const PROMPT = join(
  import.meta.dir,
  '../../components/PromptInput/PromptInput.tsx',
)

describe('densable 2.1.289 ultraplan C$t screening', () => {
  test('C$t hits typed ultraplan; skips path-like', () => {
    expect(hasUltraplanKeyword('please ultraplan this')).toBe(true)
    expect(hasUltraplanKeyword('src/ultraplan/foo.ts')).toBe(false)
    expect(hasUltraplanKeyword('/ultraplan this')).toBe(false)
  })

  test('a5n / S$r: paste-gap ranges, not whole-string paste content', () => {
    expect(
      hasUltraplanKeyword('hello [Pasted text #1]', {
        1: { id: 1, type: 'text', content: 'ultraplan me', inline: true },
      }),
    ).toBe(false)
    expect(
      hasUltraplanKeyword('ultraplan me [Pasted text #1]', {
        1: { id: 1, type: 'text', content: 'ultraplan me', inline: true },
      }),
    ).toBe(false)
    expect(
      hasUltraplanKeyword('ultraplan this [Pasted text #1]', {
        1: { id: 1, type: 'text', content: 'noise', inline: true },
      }),
    ).toBe(true)
  })

  test('k1e skips slashNameOnly paste contents', () => {
    expect(
      hasUltraplanKeyword('ultraplan this [Pasted text #1]', {
        1: {
          id: 1,
          type: 'text',
          content: 'ultraplan this',
          inline: true,
          slashNameOnly: true,
        },
      }),
    ).toBe(true)
  })

  test('UG/FWe stamps slashNameOnly on typed gaps when slash command present', () => {
    const stamped = stampSlashNameOnlyPastedGaps(
      { 1: { id: 1, type: 'text', content: 'noise', inline: true } },
      'please /rename ultraplan this [Pasted text #1]',
    )
    const extras = Object.values(stamped).filter(p => p.slashNameOnly === true)
    expect(extras.length).toBeGreaterThan(0)
    expect(extras.some(p => p.inline === true)).toBe(true)
  })

  test('source never exports minify jj/C$t/k1e; enqueue kn drainOnly', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).not.toContain('export function jj(')
    expect(src).not.toContain('export function C$t(')
    expect(src).not.toContain('export function k1e(')
    expect(src).not.toContain('export function t7e(')
    expect(src).toContain('isUltraplanProductEnabled')
    expect(src).toContain('parseReferences')
    expect(src).toContain('slashNameOnly')
    expect(src).toContain('organizationUuid')
    expect(src).toContain('require_trusted_devices')
    expect(src).toContain("getPrivacyLevel() !== 'no-telemetry'")
    expect(src).toContain('DISABLE_GROWTHBOOK')
    expect(src).toContain('CLAUDE_CODE_CUSTOM_OAUTH_URL')
    expect(src).toContain('leftoverPolicyLimitsDu')
    expect(src).toContain('stampSlashNameOnlyPastedGaps')
    const submit = readFileSync(SUBMIT, 'utf8')
    expect(submit).toContain('stampSlashNameOnlyPastedGaps')
    expect(submit).toContain('isUltraplanProductEnabled()')
    const prompt = readFileSync(PROMPT, 'utf8')
    expect(prompt).toContain('stampSlashNameOnlyPastedGaps')
    expect(submit).toContain('hasUltraplanKeyword')
    expect(submit).toContain('kn || drainOnlyIdleHooks')
    expect(submit).toContain('drainOnly: true')
    expect(src).toContain('replaceUltraplanKeyword')
  })
})
