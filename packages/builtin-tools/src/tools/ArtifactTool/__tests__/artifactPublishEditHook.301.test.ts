import { describe, expect, test } from 'bun:test'
import { ArtifactTool } from '../ArtifactTool.js'

describe('2.1.301 #854 ArtifactTool checkPermissions with Edit/Write PreToolUse hook', () => {
  test('denies publish with inline edits when an Edit/Write PreToolUse hook is active in sessionHooks', async () => {
    const context = {
      sessionId: 's1',
      getAppState: () => ({
        sessionHooks: new Map([
          [
            's1',
            {
              hooks: {
                PreToolUse: [
                  {
                    matcher: 'Edit|Write',
                    hooks: [{ type: 'command', command: 'echo check' }],
                  },
                ],
              },
            },
          ],
        ]),
      }),
    }

    const result = await ArtifactTool.checkPermissions!(
      {
        file_path: 'demo.html',
        edits: [{ old_string: 'a', new_string: 'b' }],
      } as never,
      context as never,
    )

    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toContain(
        "a hook is configured for file edits in this session, so a publish can't apply edits here. Edit the file, then publish it without edits.",
      )
      expect(result.decisionReason).toEqual({
        type: 'other',
        reason: 'PreToolUse hook for file edits',
      })
    }
  })
})
