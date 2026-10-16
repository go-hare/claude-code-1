/**
 * densable 2.1.289 `_o` / DY / Flt — AskUser isEngineConfirm payload.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  applyEngineConfirmDisplay,
  normalizeAskQuestions,
  splitEngineConfirmQuestion,
} from '../permissionAsk.js'
import {
  CONFIRM_TOOL_USE_ID_PREFIX,
  isEngineConfirmAsk,
  isEngineConfirmToolUseId,
} from '../../utils/permissions/confirmWithUser.js'

const root = join(import.meta.dir, '../..')

describe('densable 2.1.289 isEngineConfirm', () => {
  test('ko: confirm_ prefix is engine confirm toolUseID', () => {
    expect(isEngineConfirmToolUseId(`${CONFIRM_TOOL_USE_ID_PREFIX}abc`)).toBe(
      true,
    )
    expect(isEngineConfirmToolUseId('toolu_abc')).toBe(false)
    expect(isEngineConfirmToolUseId(undefined)).toBe(false)
  })

  test('_o: forcedByCaller && no requestSource && confirm_ id', () => {
    expect(
      isEngineConfirmAsk({
        forcedByCaller: true,
        requestSource: undefined,
        toolUseID: `${CONFIRM_TOOL_USE_ID_PREFIX}uuid`,
      }),
    ).toBe(true)
    expect(
      isEngineConfirmAsk({
        forcedByCaller: true,
        requestSource: { type: 'subagent' },
        toolUseID: `${CONFIRM_TOOL_USE_ID_PREFIX}uuid`,
      }),
    ).toBe(false)
    expect(
      isEngineConfirmAsk({
        forcedByCaller: false,
        toolUseID: `${CONFIRM_TOOL_USE_ID_PREFIX}uuid`,
      }),
    ).toBe(false)
  })

  test('jyo: split on first blank line; file:// body links', () => {
    const split = splitEngineConfirmQuestion(
      'Keep going?\n\nSee [notes](file:///tmp/notes.md)',
    )
    expect(split.title).toBe('Keep going?')
    expect(split.body).toEqual([
      { kind: 'text', text: 'See ' },
      {
        kind: 'fileLink',
        label: 'notes',
        url: 'file:///tmp/notes.md',
        path: '/tmp/notes.md',
      },
    ])
  })

  test('DY: isEngineConfirm fills displayQuestion; answer key stays question', () => {
    const mapped = applyEngineConfirmDisplay(
      normalizeAskQuestions([
        {
          question: 'Title?\n\nBody',
          options: [
            { label: 'Yes', description: 'y' },
            { label: 'No', description: 'n' },
          ],
        },
      ]),
      true,
    )
    expect(mapped[0]?.question).toBe('Title?\n\nBody')
    expect(mapped[0]?.displayQuestion).toBe('Title?')
    expect(mapped[0]?.displayBody).toEqual([{ kind: 'text', text: 'Body' }])
  })

  test('descriptor and DualInk payload wire isEngineConfirm', () => {
    const descriptor = readFileSync(
      join(root, 'dialog/permissionDescriptor.ts'),
      'utf8',
    )
    expect(descriptor).toContain('isEngineConfirm')
    expect(descriptor).toContain('isEngineConfirmAsk')
    const payload = readFileSync(join(root, 'dialog/permissionAsk.ts'), 'utf8')
    expect(payload).toContain('isEngineConfirm?: boolean')
    const confirm = readFileSync(
      join(root, 'utils/permissions/confirmWithUser.ts'),
      'utf8',
    )
    expect(confirm).toContain("CONFIRM_TOOL_USE_ID_PREFIX = 'confirm_'")
    expect(confirm).toContain('forcedByCaller: true')
    expect(confirm).toContain('export async function confirmWithUser')
    const dualInk = readFileSync(
      join(
        root,
        'components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx',
      ),
      'utf8',
    )
    expect(dualInk).toContain('applyEngineConfirmDisplay')
    expect(dualInk).not.toContain('export function Qge')
  })
})
