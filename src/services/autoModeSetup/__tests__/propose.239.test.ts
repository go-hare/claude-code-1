/**
 * densable Hqi — auto-mode-setup proposal parsing and validation.
 */
import { describe, expect, test } from 'bun:test'
import { AUTO_MODE_DEFAULTS_SENTINEL } from '../write.js'
import { parseAutoModeSetupProposal } from '../propose.js'

function proposal(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    environment: [
      '### Org-wide',
      '**Organization**: example',
      '### User-specific',
      '**Primary use of Claude Code**: development',
    ],
    allow: [],
    soft_deny: [],
    hard_deny: [],
    remove_from_permissions_allow: [],
    notes: [],
    ...overrides,
  })
}

describe('parseAutoModeSetupProposal (densable Hqi)', () => {
  test('parses raw JSON and normalizes variation selectors', () => {
    const result = parseAutoModeSetupProposal(
      proposal({
        environment: [
          '### Org-wide\uFE0F',
          '**Organization**: example',
          '### User-specific',
          '**Primary use of Claude Code**: development',
        ],
        allow: [AUTO_MODE_DEFAULTS_SENTINEL, 'Bash(gh pr view:*)'],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposal.environment[0]).toBe('### Org-wide')
    expect(result.proposal.allow).toEqual([
      AUTO_MODE_DEFAULTS_SENTINEL,
      'Bash(gh pr view:*)',
    ])
    expect(result.droppedUnsafeAllowCount).toBe(0)
  })

  test('fenced JSON is parse_failed (Hqi has no fence strip)', () => {
    const result = parseAutoModeSetupProposal(
      `\`\`\`json\n${proposal()}\n\`\`\``,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('parse_failed')
  })

  test('rejects a non-empty rule array missing $defaults', () => {
    const result = parseAutoModeSetupProposal(
      proposal({ soft_deny: ['Bash(kubectl delete:*)'] }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('invalid_proposal')
    expect(result.reason).toContain('missing the literal entry "$defaults"')
  })

  test('drops an unsafe broad Bash allow rule', () => {
    const result = parseAutoModeSetupProposal(
      proposal({
        allow: [
          AUTO_MODE_DEFAULTS_SENTINEL,
          'Bash(sudo:*)',
          'Bash(gh pr view:*)',
        ],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposal.allow).toEqual([
      AUTO_MODE_DEFAULTS_SENTINEL,
      'Bash(gh pr view:*)',
    ])
    expect(result.droppedUnsafeAllowCount).toBe(1)
    expect(result.proposal.notes).toContain(
      'Dropped 1 proposed allow entry — too broad for auto mode to honor safely.',
    )
  })

  test('tGw keeps apply-file mode and scope; defaults mode to append', () => {
    const withExtras = parseAutoModeSetupProposal(
      proposal({ mode: 'replace', scope: 'project' }),
    )
    expect(withExtras.ok).toBe(true)
    if (!withExtras.ok) return
    expect(withExtras.proposal.mode).toBe('replace')
    expect(withExtras.proposal.scope).toBe('project')

    const defaults = parseAutoModeSetupProposal(proposal())
    expect(defaults.ok).toBe(true)
    if (!defaults.ok) return
    expect(defaults.proposal.mode).toBe('append')
    expect(defaults.proposal.scope).toBeUndefined()
  })
})
