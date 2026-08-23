/**
 * densable 2.1.238 #7 s3T/pze — catalog `r.name` producer + renderer without
 * OUTPUT_STYLE_CONFIG lookup. Custom/plugin names still render; >gFn=256 suppress.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import {
  CONCISE_TURN_REMINDER,
  OUTPUT_STYLE_NAME_MAX,
} from '../../constants/outputStyles.js'
import { normalizeAttachmentForAPI } from '../messages.js'
import { escapeOutputStyleName } from '../xml.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

function reminderText(style: string, turnReminder?: string): string | null {
  const msgs = normalizeAttachmentForAPI({
    type: 'output_style',
    style,
    turnReminder,
  })
  if (msgs.length === 0) return null
  const content = msgs[0]!.message.content
  return typeof content === 'string' ? content : null
}

describe('densable 2.1.238 #7 s3T/pze output_style', () => {
  test('gFn is 256', () => {
    expect(OUTPUT_STYLE_NAME_MAX).toBe(256)
  })

  test('built-in Concise still renders catalog name + attachment reminder', () => {
    const text = reminderText('Concise', CONCISE_TURN_REMINDER)
    expect(text).toContain(
      `<system-reminder>\nConcise output style is active. ${CONCISE_TURN_REMINDER}\n</system-reminder>`,
    )
  })

  test('custom / plugin catalog name still renders (no OUTPUT_STYLE_CONFIG lookup)', () => {
    const text = reminderText('Acme Review', 'Keep diffs tiny.')
    expect(text).toContain(
      'Acme Review output style is active. Keep diffs tiny.',
    )
  })

  test('empty style suppresses', () => {
    expect(reminderText('')).toBeNull()
  })

  test('name longer than gFn suppresses', () => {
    expect(reminderText('x'.repeat(OUTPUT_STYLE_NAME_MAX + 1))).toBeNull()
    expect(reminderText('x'.repeat(OUTPUT_STYLE_NAME_MAX), 'ok')).toContain(
      `${'x'.repeat(OUTPUT_STYLE_NAME_MAX)} output style is active. ok`,
    )
  })

  test('pze HTML-escapes style name (control → numeric entity)', () => {
    expect(escapeOutputStyleName('A<B&C>')).toBe('A&lt;B&amp;C&gt;')
    expect(escapeOutputStyleName('A\nB')).toBe('A&#10;B')
    const text = reminderText('A<B>', 'ok')
    expect(text).toContain('A&lt;B&gt; output style is active. ok')
    expect(text).not.toContain('A<B>')
  })

  test('fallback reminder when attachment omits turnReminder', () => {
    expect(reminderText('Explanatory')).toContain(
      'Explanatory output style is active. Remember to follow the specific guidelines for this style.',
    )
  })

  test('producer source gold: style is config.name, not settings key', () => {
    const src = readFileSync(join(ROOT, 'src/utils/attachments.ts'), 'utf8')
    expect(src).toContain('style: config.name')
    expect(src).not.toMatch(/style:\s*outputStyle\b/)
  })

  test('renderer source gold: no OUTPUT_STYLE_CONFIG lookup', () => {
    const src = readFileSync(join(ROOT, 'src/utils/messages.ts'), 'utf8')
    const caseIdx = src.indexOf("case 'output_style'")
    expect(caseIdx).toBeGreaterThan(0)
    const nextCase = src.indexOf('case ', caseIdx + 10)
    const block = src.slice(caseIdx, nextCase)
    expect(block).toContain('escapeOutputStyleName(attachment.style)')
    expect(block).toContain('OUTPUT_STYLE_NAME_MAX')
    expect(block).not.toContain('OUTPUT_STYLE_CONFIG[')
  })
})
