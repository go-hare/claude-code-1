/**
 * Official 2.1.x: SessionStart reloadSkills/sessionTitle and UPS sessionTitle schema.
 */
import { describe, expect, test } from 'bun:test'
import { hookJSONOutputSchema } from '../hooks.js'

describe('SessionStart hookSpecificOutput schema', () => {
  test('accepts reloadSkills and sessionTitle', () => {
    const r = hookJSONOutputSchema().safeParse({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'ctx',
        initialUserMessage: 'hi',
        sessionTitle: 'From hook',
        reloadSkills: true,
        watchPaths: ['/tmp/skills'],
      },
    })
    expect(r.success).toBe(true)
    if (!r.success || !('hookSpecificOutput' in r.data)) return
    const out = r.data.hookSpecificOutput
    expect(out?.hookEventName).toBe('SessionStart')
    if (out?.hookEventName === 'SessionStart') {
      expect(out.sessionTitle).toBe('From hook')
      expect(out.reloadSkills).toBe(true)
      expect(out.watchPaths).toEqual(['/tmp/skills'])
    }
  })
})

describe('UserPromptSubmit hookSpecificOutput schema', () => {
  test('accepts sessionTitle and suppressOriginalPrompt', () => {
    const r = hookJSONOutputSchema().safeParse({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'ctx',
        sessionTitle: 'UPS title',
        suppressOriginalPrompt: true,
      },
    })
    expect(r.success).toBe(true)
    if (!r.success || !('hookSpecificOutput' in r.data)) return
    const out = r.data.hookSpecificOutput
    expect(out?.hookEventName).toBe('UserPromptSubmit')
    if (out?.hookEventName === 'UserPromptSubmit') {
      expect(out.sessionTitle).toBe('UPS title')
      expect(out.suppressOriginalPrompt).toBe(true)
    }
  })
})
