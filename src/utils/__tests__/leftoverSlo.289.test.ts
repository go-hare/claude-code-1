/**
 * densable 2.1.289 Slo / jee / qle placeholder.
 * Gold Slo @196502604: cwd hash, not lodash sample.
 * Gold qle: `v<1&&!M&&he` — skip Try when hasMessages.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { leftoverJee } from '../exampleCommands.js'

const slo = readFileSync(join(import.meta.dir, '../exampleCommands.ts'), 'utf8')
const qle = readFileSync(
  join(
    import.meta.dir,
    '../../components/PromptInput/usePromptInputPlaceholder.ts',
  ),
  'utf8',
)
const prompt = readFileSync(
  join(import.meta.dir, '../../components/PromptInput/PromptInput.tsx'),
  'utf8',
)
const ye = readFileSync(
  join(import.meta.dir, '../../hooks/renderPlaceholder.ts'),
  'utf8',
)

describe('densable 2.1.289 Slo jee qle Ye', () => {
  test('jee is gold djb2-ish 32-bit seed', () => {
    expect(leftoverJee('')).toBe(0)
    expect(leftoverJee('a')).toBe(97)
    expect(leftoverJee('ab')).toBe(((97 << 5) - 97 + 98) | 0)
  })

  test('Slo uses leftoverJee(getCwd) not lodash sample', () => {
    expect(slo).toContain('leftoverJee(getCwd())')
    expect(slo).toContain('seed >>> 8')
    expect(slo).not.toContain("from 'lodash-es/sample.js'")
    expect(slo).toContain('Try "${commands[')
  })

  test('qle Try only when submitCount<1 and !hasMessages', () => {
    expect(qle).toContain('submitCount < 1')
    expect(qle).toContain('!hasMessages')
    expect(prompt).toContain('hasMessages: messages.length > 0')
  })

  test('qle queue copy is gold EE/UGn/queueEditIndex not fullscreen', () => {
    expect(qle).toContain('queueEditIndex === null')
    expect(qle).toContain('queueEditIndex === 0')
    expect(qle).toContain('isKbCohesionFixesEnabled()')
    expect(qle).toContain('tengu_jiggly_mochi')
    expect(qle).toContain(
      'Press Enter to edit the selected message, or up again for history',
    )
    expect(qle).toContain(
      'Press up to edit queued messages, Enter to send them immediately',
    )
    expect(qle).not.toContain('isFullscreenEnvEnabled')
    expect(qle).toContain('truncate(viewingAgentName, MAX_TEAMMATE_NAME_WIDTH)')
  })

  test('Ye invert placeholder[0] then dim rest', () => {
    expect(ye).toContain('invert(placeholder[0]!)')
    expect(ye).toContain('chalk.dim(placeholder.slice(1))')
    expect(ye).toContain("invert(' ')")
    expect(ye).not.toContain('bgRgb(180, 180, 180)')
  })
})
