/**
 * densable 2.1.235 B7S Edit/Write contentWithhold (adversarial C1).
 */
import { describe, expect, test } from 'bun:test'
import { GFt } from '../../NotebookEditPermissionRequest/notebookPermissionPreview.js'
import {
  PROPOSED_CONTENT_TOO_LARGE_MESSAGE,
  PROPOSED_EDIT_TOO_LARGE_MESSAGE,
  evaluateEditContentWithhold,
  evaluateWriteContentWithhold,
  existingFileTooLargeOverwriteMessage,
  networkPathWriteWithholdMessage,
} from '../filePermissionPreviewWithhold.js'

describe('evaluateEditContentWithhold (B7S Edit)', () => {
  test('oversized new_string → withheld + exact SEA message', () => {
    const result = evaluateEditContentWithhold('small', 'x'.repeat(GFt + 1))
    expect(result).toEqual({
      contentWithheld: true,
      message: PROPOSED_EDIT_TOO_LARGE_MESSAGE,
    })
  })

  test('oversized old_string → withheld', () => {
    const result = evaluateEditContentWithhold('y'.repeat(GFt + 1), 'small')
    expect(result.contentWithheld).toBe(true)
    expect(result.message).toBe(PROPOSED_EDIT_TOO_LARGE_MESSAGE)
  })

  test('under GFt → not withheld', () => {
    expect(evaluateEditContentWithhold('old', 'new')).toEqual({
      contentWithheld: false,
    })
  })
})

describe('evaluateWriteContentWithhold (B7S Write)', () => {
  test('proposed content oversized → withheld + exact SEA message', () => {
    const result = evaluateWriteContentWithhold({
      content: 'z'.repeat(GFt + 1),
      filePath: '/tmp/example.ts',
      fileExists: false,
      oldContent: '',
    })
    expect(result).toEqual({
      contentWithheld: true,
      message: PROPOSED_CONTENT_TOO_LARGE_MESSAGE,
    })
  })

  test('existing file oversized → overwrite withhold message', () => {
    const filePath = '/tmp/big.ts'
    const result = evaluateWriteContentWithhold({
      content: 'small',
      filePath,
      fileExists: true,
      oldContent: 'a'.repeat(GFt + 2),
    })
    expect(result).toEqual({
      contentWithheld: true,
      message: existingFileTooLargeOverwriteMessage(filePath),
    })
  })

  test('network UNC path → network withhold message (Windows path mode)', () => {
    // containsVulnerableUncPath(..., true) is Windows-only; on non-Windows this
    // still documents the SEA message helper + non-withhold when gate is false.
    const filePath = '\\\\server\\share\\file.ts'
    const result = evaluateWriteContentWithhold({
      content: 'small',
      filePath,
      fileExists: false,
      oldContent: '',
    })
    if (process.platform === 'win32') {
      expect(result).toEqual({
        contentWithheld: true,
        message: networkPathWriteWithholdMessage(filePath),
      })
    } else {
      expect(result.contentWithheld).toBe(false)
    }
  })

  test('normal create → not withheld', () => {
    expect(
      evaluateWriteContentWithhold({
        content: 'hello',
        filePath: '/tmp/ok.ts',
        fileExists: false,
        oldContent: '',
      }),
    ).toEqual({ contentWithheld: false })
  })
})
