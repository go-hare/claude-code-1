import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { RenderableMessage } from '../../types/message.js'
import { collapseBackgroundBashNotifications } from '../collapseBackgroundBashNotifications.js'

const src = readFileSync(
  join(import.meta.dir, '../collapseBackgroundBashNotifications.ts'),
  'utf8',
)

describe('densable 2.1.289 mMr remote+bash coalesce', () => {
  test('vfn prefixes: Background command and Remote task', () => {
    expect(src).toContain('BACKGROUND_BASH_SUMMARY_PREFIX')
    expect(src).toContain("'Remote task \"'")
    expect(src).toContain('remote tasks completed')
    expect(src).toContain('background commands completed')
  })

  test('does not mix bash and remote runs, bash-only brief count', () => {
    expect(src).toContain("kind === 'bash'")
    expect(src).toContain('registerBriefBashNotificationCount')
    expect(src).toContain('=== kind')
    expect(src).not.toContain('export function mMr(')
    expect(src).not.toContain('export function vfn(')
  })

  test('enforces origin.kind, strict task-notification envelope, and rejects < in summary', () => {
    const prevFullscreen = process.env.CLAUDE_CODE_FULLSCREEN
    process.env.CLAUDE_CODE_FULLSCREEN = '1'
    try {
      const makeRow = (
        text: string,
        origin?: { kind: string },
      ): RenderableMessage =>
        ({
          type: 'user',
          uuid: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          ...(origin ? { origin } : {}),
          message: { role: 'user', content: [{ type: 'text', text }] },
        }) as unknown as RenderableMessage

      const cleanXml =
        '<task-notification><status>completed</status><summary>Background command "echo 1" completed (exit code 0)</summary></task-notification>'

      // Non-task-notification origin must not collapse
      const wrongOrigin = collapseBackgroundBashNotifications(
        [
          makeRow(cleanXml, { kind: 'human' }),
          makeRow(cleanXml, { kind: 'human' }),
        ],
        false,
      )
      expect(wrongOrigin).toHaveLength(2)

      // Trailing/leading non-whitespace text outside envelope must not collapse
      const trailingText = collapseBackgroundBashNotifications(
        [makeRow(`${cleanXml} trailing`), makeRow(cleanXml)],
        false,
      )
      expect(trailingText).toHaveLength(2)

      // `<` inside summary must not collapse
      const nestedTagXml =
        '<task-notification><status>completed</status><summary>Background command "echo <tag>" completed</summary></task-notification>'
      const nestedTag = collapseBackgroundBashNotifications(
        [makeRow(nestedTagXml), makeRow(nestedTagXml)],
        false,
      )
      expect(nestedTag).toHaveLength(2)
    } finally {
      if (prevFullscreen === undefined)
        delete process.env.CLAUDE_CODE_FULLSCREEN
      else process.env.CLAUDE_CODE_FULLSCREEN = prevFullscreen
    }
  })
})
