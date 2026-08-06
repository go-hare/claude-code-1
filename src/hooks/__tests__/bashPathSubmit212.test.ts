/**
 * densable 2.1.212 #12:
 * shell mode `!` path autocomplete open must still allow Enter to run a
 * command that contains a path token.
 *
 * densable Ye bash-path bare Enter: Ee() + r(q1e(), !0)
 * PromptInput onSubmit gate:
 *   $0 = every(description === "directory")
 *   early return if suggestions.length && !bn && !$0
 * densable lKs (getPathCompletions) items have NO description field, so $0 is
 * false while the popup is open — bn must be true to submit.
 */
import { describe, expect, test } from 'bun:test'

/** densable PromptInput onSubmit early-return predicate (bn = 2nd arg). */
function shouldBlockSubmitForSuggestions(opts: {
  suggestions: Array<{ description?: string | undefined }>
  isSubmittingSlashCommand: boolean
}): boolean {
  const hasDirectorySuggestions =
    opts.suggestions.length > 0 &&
    opts.suggestions.every(s => s.description === 'directory')
  return (
    opts.suggestions.length > 0 &&
    !opts.isSubmittingSlashCommand &&
    !hasDirectorySuggestions
  )
}

type SuggestionProbe = {
  id: string
  displayText: string
  description?: string
  metadata: { type: 'file' | 'directory' }
}

/** densable lKs map shape — id/displayText/metadata only. */
function lKsItem(path: string, type: 'file' | 'directory'): SuggestionProbe {
  return {
    id: path,
    displayText: type === 'directory' ? `${path}/` : path,
    metadata: { type },
  }
}

/** densable getDirectoryCompletions map — includes description:"directory". */
function dirOnlyItem(path: string): SuggestionProbe {
  return {
    id: path,
    displayText: `${path}/`,
    description: 'directory',
    metadata: { type: 'directory' },
  }
}

/**
 * densable Ye bash-path bare Enter (Lt === void 0):
 * clear + onSubmit(live, true) once (ie guard).
 */
function bashPathBareEnterSubmit(
  input: string,
  guard: { current: boolean },
  onSubmit: (value: string, bn?: boolean) => void,
): void {
  if (!guard.current) {
    guard.current = true
    onSubmit(input, true)
  }
}

/** densable return-key: trailing `\` or Apple_Terminal+shift → do not intercept. */
function shouldDeferBashPathReturnToTextInput(opts: {
  cursorPrevChar: string | undefined
  appleTerminalShift: boolean
}): boolean {
  return opts.cursorPrevChar === '\\' || opts.appleTerminalShift
}

describe('densable #12 bash-path submit while path popup open', () => {
  test('lKs path suggestions lack description → gate blocks when bn=false', () => {
    const suggestions = [
      lKsItem('src/cli', 'directory'),
      lKsItem('src/cli.tsx', 'file'),
    ]
    expect(
      shouldBlockSubmitForSuggestions({
        suggestions,
        isSubmittingSlashCommand: false,
      }),
    ).toBe(true)
  })

  test('densable Ye bash-path bare Enter passes bn=true → gate allows submit', () => {
    const suggestions = [
      lKsItem('src/cli', 'directory'),
      lKsItem('src/cli.tsx', 'file'),
    ]
    expect(
      shouldBlockSubmitForSuggestions({
        suggestions,
        isSubmittingSlashCommand: true,
      }),
    ).toBe(false)
  })

  test('directory-only (command-arg) suggestions allow submit with bn=false via $0', () => {
    const suggestions = [dirOnlyItem('/tmp/foo'), dirOnlyItem('/tmp/bar')]
    expect(
      shouldBlockSubmitForSuggestions({
        suggestions,
        isSubmittingSlashCommand: false,
      }),
    ).toBe(false)
  })

  test('mixed description fails every() → still needs bn=true', () => {
    const suggestions = [dirOnlyItem('a'), lKsItem('b', 'file')]
    expect(
      shouldBlockSubmitForSuggestions({
        suggestions,
        isSubmittingSlashCommand: false,
      }),
    ).toBe(true)
    expect(
      shouldBlockSubmitForSuggestions({
        suggestions,
        isSubmittingSlashCommand: true,
      }),
    ).toBe(false)
  })

  test('ie.current double-submit guard fires onSubmit once', () => {
    const calls: Array<{ value: string; bn?: boolean }> = []
    const guard = { current: false }
    bashPathBareEnterSubmit('cat ./src/a.ts', guard, (value, bn) => {
      calls.push({ value, bn })
    })
    bashPathBareEnterSubmit('cat ./src/a.ts', guard, (value, bn) => {
      calls.push({ value, bn })
    })
    expect(calls).toEqual([{ value: 'cat ./src/a.ts', bn: true }])
    expect(guard.current).toBe(true)
  })

  test('return-key defers to TextInput for backslash-newline and Apple shift', () => {
    expect(
      shouldDeferBashPathReturnToTextInput({
        cursorPrevChar: '\\',
        appleTerminalShift: false,
      }),
    ).toBe(true)
    expect(
      shouldDeferBashPathReturnToTextInput({
        cursorPrevChar: 'c',
        appleTerminalShift: true,
      }),
    ).toBe(true)
    expect(
      shouldDeferBashPathReturnToTextInput({
        cursorPrevChar: 'c',
        appleTerminalShift: false,
      }),
    ).toBe(false)
  })
})
