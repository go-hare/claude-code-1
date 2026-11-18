import { afterEach, describe, expect, test } from 'bun:test'
import {
  isClaudeDesktopEntrypoint,
  isPluginAllowedToolsTrusted,
} from '../skillAllowedToolsTrust.js'

describe('2.1.305 skillAllowedToolsTrust (#1057)', () => {
  const origEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT

  afterEach(() => {
    if (origEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
    else process.env.CLAUDE_CODE_ENTRYPOINT = origEntrypoint
  })

  test('#1057: isClaudeDesktopEntrypoint detects claude-desktop, claude-desktop-3p, local-agent', () => {
    expect(isClaudeDesktopEntrypoint('claude-desktop')).toBe(true)
    expect(isClaudeDesktopEntrypoint('claude-desktop-3p')).toBe(true)
    expect(isClaudeDesktopEntrypoint('local-agent')).toBe(true)
    expect(isClaudeDesktopEntrypoint('cli')).toBe(false)
    expect(isClaudeDesktopEntrypoint(undefined)).toBe(false)
  })

  test('#1057: inline plugin trusted in CLI when managed rules not restricting Desktop', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    expect(isPluginAllowedToolsTrusted({ id: 'my-plugin@inline' })).toBe(true)
  })
})
