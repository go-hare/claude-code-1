import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  collectToolNamesUsedBeforeCompact,
  formatToolsUsedBeforeSummaryReminder,
  getCompactUserSummaryMessage,
} from '../prompt.js'
import { formatCompactSummaryForTranscript } from '../../../components/CompactSummary.js'

describe('2.1.304-305 Compact alignment (#963, #1016, #1042)', () => {
  test('#963 collectToolNamesUsedBeforeCompact & formatCompactSummaryForTranscript render tools called', () => {
    const toolNames = collectToolNamesUsedBeforeCompact([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read' },
            { type: 'tool_use', name: 'Bash' },
            { type: 'tool_use', name: 'Read' },
          ],
        },
      },
    ])
    expect(toolNames).toEqual(['Bash', 'Read'])

    const reminder = formatToolsUsedBeforeSummaryReminder(toolNames)
    expect(reminder).toBe(
      '<system-reminder>\n<tools-used-before-summary>Bash, Read</tools-used-before-summary>\n</system-reminder>',
    )

    const msg = getCompactUserSummaryMessage('<summary>did work</summary>', {
      toolNamesUsed: toolNames,
    })
    expect(msg).toContain(reminder)

    const rendered = formatCompactSummaryForTranscript(msg)
    expect(rendered).toContain('Tools called before this summary: Bash, Read')
    expect(rendered).not.toContain('<tools-used-before-summary>')
  })

  test('#1016 postCompactCleanup resets sentSkillNames on compaction', () => {
    const src = readFileSync(
      join(import.meta.dir, '../postCompactCleanup.ts'),
      'utf8',
    )
    expect(src).toContain('resetSentSkillNames()')
    expect(src).not.toContain('Intentionally NOT calling resetSentSkillNames()')
  })

  test('#1042 compact.ts passes headTruncated and isTranscriptSuppressed to getCompactUserSummaryMessage', () => {
    const src = readFileSync(join(import.meta.dir, '../compact.ts'), 'utf8')
    expect(src).toContain('headTruncated: ptlAttempts > 0')
    expect(src).toContain('toolNamesUsed: collectToolNamesUsedBeforeCompact')

    const noteMsg = getCompactUserSummaryMessage('<summary>s</summary>', {
      headTruncated: true,
      isTranscriptSuppressed: true,
      transcriptPath: '/tmp/t.jsonl',
    })
    expect(noteMsg).toContain(
      'earliest part of the conversation was too large to include',
    )
    expect(noteMsg).not.toContain(
      'the full transcript mentioned above still has it',
    )
  })
})
