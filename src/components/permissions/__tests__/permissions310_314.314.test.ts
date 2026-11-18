import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { formatScreenReaderQuestionsList } from '../AskUserQuestionPermissionRequest/QuestionNavigationBar.js'
import {
  allocateExplanationRowBudget,
  capExplanationRows,
} from '../PermissionRuleExplanation.js'
import { getRecentlyBlockedEscHint } from '../rules/PermissionRuleList.js'
import {
  formatDenialRefusal,
  isDenialBodyOnScreen,
} from '../rules/RecentDenialsTab.js'

const ROOT = join(import.meta.dir, '../../..')

describe('v2.1.310–314 permissions alignment', () => {
  test('#1201 FilePermissionDialog resolves symlinkTarget for read operations and formats read/modify warning', () => {
    const src = readFileSync(
      join(
        ROOT,
        'components/permissions/FilePermissionDialog/FilePermissionDialog.tsx',
      ),
      'utf8',
    )
    expect(src).not.toContain("if (!path || operationType === 'read')")
    expect(src).toContain("operationType === 'read' ? 'read' : 'modify'")
  })

  test('#1202 AskUserQuestion external editor resets AFK clock on close', () => {
    const qv = readFileSync(
      join(
        ROOT,
        'components/permissions/AskUserQuestionPermissionRequest/QuestionView.tsx',
      ),
      'utf8',
    )
    const pqv = readFileSync(
      join(
        ROOT,
        'components/permissions/AskUserQuestionPermissionRequest/PreviewQuestionView.tsx',
      ),
      'utf8',
    )
    const req = readFileSync(
      join(
        ROOT,
        'components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx',
      ),
      'utf8',
    )
    expect(qv).toContain('updateLastInteractionTime(true)')
    expect(qv).toContain('onExternalEditorClose?.()')
    expect(pqv).toContain('updateLastInteractionTime(true)')
    expect(pqv).toContain('onExternalEditorClose?.()')
    expect(req).toContain('<AfkCountdown key={afkResetCount}')
  })

  test('#1286 formatScreenReaderQuestionsList renders plain text without arrows or symbols', () => {
    const questions = [
      {
        question: 'Pick color?',
        header: 'Color',
        options: [],
        multiSelect: false,
      },
      {
        question: 'How many pages?',
        header: 'Pages',
        options: [],
        multiSelect: false,
      },
    ]
    expect(
      formatScreenReaderQuestionsList(questions, { 'Pick color?': 'Blue' }),
    ).toBe('Questions: Color (answered), Pages')
    expect(formatScreenReaderQuestionsList([questions[0]!], {})).toBe(
      'Question: Color',
    )
    // Quotes headers containing commas or "answered"
    expect(
      formatScreenReaderQuestionsList(
        [{ question: 'q', header: 'A, B', options: [], multiSelect: false }],
        {},
      ),
    ).toBe('Question: "A, B"')
  })

  test('#1404 QuestionView sets takesPasteFromOtherRows on Other input option', () => {
    const qv = readFileSync(
      join(
        ROOT,
        'components/permissions/AskUserQuestionPermissionRequest/QuestionView.tsx',
      ),
      'utf8',
    )
    expect(qv).toContain('takesPasteFromOtherRows: true')
  })

  test('#1283 PermissionRuleList announces Deleted rule to screen reader immediately', () => {
    const src = readFileSync(
      join(ROOT, 'components/permissions/rules/PermissionRuleList.tsx'),
      'utf8',
    )
    expect(src).toContain(
      'announceForScreenReader(`[Deleted ${deletedRuleBehavior} rule ${deletedRuleText}]`, true)',
    )
  })

  test('#1425 Recently blocked tab rename and Esc footer hints', () => {
    const src = readFileSync(
      join(ROOT, 'components/permissions/rules/PermissionRuleList.tsx'),
      'utf8',
    )
    expect(src).toContain('title="Recently blocked"')
    expect(src).not.toContain('title="Recently denied"')
    expect(getRecentlyBlockedEscHint(0, 0, false)).toBeUndefined()
    expect(getRecentlyBlockedEscHint(2, 0, false)).toBe(
      'Esc to approve 2 blocked',
    )
    expect(getRecentlyBlockedEscHint(1, 1, false)).toBe(
      'Esc to retry 1 blocked',
    )
    expect(getRecentlyBlockedEscHint(0, 1, true)).toBe(
      'Esc to tell Claude next prompt',
    )
  })

  test('#1441 RecentDenialsTab refuses approving rows when terminal is too short', () => {
    expect(formatDenialRefusal('this terminal is too short to show it')).toBe(
      "This row can't be approved here: this terminal is too short to show it",
    )
    // 10-row terminal with 2 listed items has 0 body rows available -> too short for any command
    expect(isDenialBodyOnScreen('echo hello', 10, 80, 2)).toBe(false)
    // 30-row terminal with 2 listed items has 20 body rows available -> fits
    expect(isDenialBodyOnScreen('echo hello', 30, 80, 2)).toBe(true)
  })

  test('#1427 PermissionRuleExplanation caps long reason rows within budget', () => {
    const longReason = Array.from(
      { length: 20 },
      (_, i) => `Line ${i + 1} of reason`,
    ).join('\n')
    const alloc = allocateExplanationRowBudget(
      longReason,
      undefined,
      60,
      8,
      false,
    )
    expect(alloc.shouldCap).toBe(true)
    expect(alloc.consentRows).toBe(8)
    const capped = capExplanationRows(
      longReason,
      alloc.consentRows,
      60,
      alloc.shouldCap,
    )
    const lines = capped.split('\n')
    expect(lines.length).toBe(8)
    expect(lines[7]).toBe('… (+13 more lines)')
  })
})
