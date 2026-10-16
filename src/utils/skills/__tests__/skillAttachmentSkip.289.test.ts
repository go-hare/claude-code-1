import { describe, expect, test } from 'bun:test'
import {
  shouldSkipSkillAttachments,
  isUntrustedSkillAttachmentSource,
} from '../skillAttachmentSkip.js'

describe('densable 2.1.289 Lje attachment skip', () => {
  test('syncedSkills skip on local machine, not REMOTE/COWORK/remote_cowork', () => {
    expect(shouldSkipSkillAttachments({ loadedFrom: 'syncedSkills' }, {})).toBe(
      true,
    )
    expect(
      shouldSkipSkillAttachments(
        { loadedFrom: 'syncedSkills' },
        { CLAUDE_CODE_REMOTE: '1' },
      ),
    ).toBe(false)
    expect(
      shouldSkipSkillAttachments(
        { loadedFrom: 'syncedSkills' },
        { CLAUDE_CODE_REMOTE: '0' },
      ),
    ).toBe(false)
    expect(
      shouldSkipSkillAttachments(
        { loadedFrom: 'syncedSkills' },
        {
          CLAUDE_CODE_ENTRYPOINT: 'remote_cowork',
        },
      ),
    ).toBe(false)
  })

  test('k3r: mcp/memoryStore/attachedFolder skip; plugin/bundled do not', () => {
    expect(isUntrustedSkillAttachmentSource({ loadedFrom: 'mcp' })).toBe(true)
    expect(
      isUntrustedSkillAttachmentSource({ loadedFrom: 'memoryStore' }),
    ).toBe(true)
    expect(
      isUntrustedSkillAttachmentSource({ loadedFrom: 'attachedFolder' }),
    ).toBe(true)
    expect(isUntrustedSkillAttachmentSource({ loadedFrom: 'plugin' })).toBe(
      false,
    )
    expect(isUntrustedSkillAttachmentSource({ loadedFrom: 'bundled' })).toBe(
      false,
    )
  })

  test('k3r loadedFrom undefined → Boolean(isMcp)', () => {
    expect(isUntrustedSkillAttachmentSource({})).toBe(false)
    expect(isUntrustedSkillAttachmentSource({ isMcp: true })).toBe(true)
  })
})
