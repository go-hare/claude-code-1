import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const generalSrc = readFileSync(join(import.meta.dir, '../General.tsx'), 'utf8')
const helpSrc = readFileSync(join(import.meta.dir, '../HelpV2.tsx'), 'utf8')

describe('Permission dialog footer hints', () => {
  test('bash permission footer says "reject" instead of "cancel"', () => {
    const footer = 'Esc to reject'
    expect(footer).toContain('reject')
    expect(footer).not.toContain('cancel')
  })

  test('bash permission footer tab hint says "add feedback"', () => {
    const tabHint = 'Tab to add feedback'
    expect(tabHint).toContain('feedback')
    expect(tabHint).not.toContain('amend')
  })

  test('file permission footer matches bash footer language', () => {
    const bashFooter = 'Esc to reject'
    const fileFooter = 'Esc to reject'
    expect(bashFooter).toBe(fileFooter)
  })
})

describe('Permission option labels', () => {
  test('.claude/ folder option is under 60 chars', () => {
    const label = 'Yes, allow edits to .claude/ config for this session'
    expect(label.length).toBeLessThan(60)
    expect(label).toContain('.claude/')
  })

  test('accept-once option has simple label', () => {
    const label = 'Yes'
    expect(label).toBe('Yes')
  })

  test('reject option has simple label', () => {
    const label = 'No'
    expect(label).toBe('No')
  })
})

describe('densable 2.1.289 Help General T', () => {
  test('has Shortcuts heading and PromptInputHelpMenu', () => {
    expect(generalSrc).toContain('Shortcuts')
    expect(generalSrc).toContain('PromptInputHelpMenu')
  })

  test('does not have Getting started section', () => {
    expect(generalSrc).not.toContain('Getting started')
  })

  test('tagline matches gold T copy', () => {
    expect(generalSrc).toContain(
      'Claude understands your codebase, makes edits with your permission, and executes commands',
    )
  })
})

describe('densable 2.1.289 Help I chrome', () => {
  test('outer title is Help with capitalized tab titles', () => {
    expect(helpSrc).toContain('title="Help"')
    expect(helpSrc).toContain('title="General"')
    expect(helpSrc).toContain('title="Commands"')
    expect(helpSrc).toContain('title="Custom commands"')
    expect(helpSrc).not.toContain('title="general"')
    expect(helpSrc).not.toMatch(/Claude Code v\$\{MACRO\.VERSION\}/)
  })

  test('command browse titles have no colon', () => {
    expect(helpSrc).toContain('title="Browse default commands"')
    expect(helpSrc).toContain('title="Browse custom commands"')
    expect(helpSrc).not.toContain('Browse default commands:')
    expect(helpSrc).not.toContain('Browse custom commands:')
  })

  test('footer has docs link, optional feedback, esc to cancel', () => {
    expect(helpSrc).toContain('For more help:')
    expect(helpSrc).toContain('https://code.claude.com/docs/en/overview')
    expect(helpSrc).toContain(
      'Something else? Use /feedback to report bugs or request features.',
    )
    expect(helpSrc).toContain('to cancel')
    expect(helpSrc).toContain('defaultTab="general"')
    expect(helpSrc).toContain('color="professionalBlue"')
  })
})
