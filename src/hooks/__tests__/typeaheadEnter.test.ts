import { describe, expect, test } from 'bun:test'

/**
 * Pure mirrors of useTypeahead handleEnter resolution after densable Me() dig.
 * Full hook needs React/Ink; these lock the swallow-prone branches.
 */

/**
 * densable Me: Er = Et ?? (hoverIdx if match else selected).
 * Fork bare Enter still uses selected -1 → 0 so preventDefault never swallows.
 */
function resolveEnterIndex(
  selectedSuggestion: number,
  length: number,
  opts?: { forcedIndex?: number; hoverIdx?: number },
): number {
  if (length === 0) return -1
  if (opts?.forcedIndex !== undefined) {
    return opts.forcedIndex >= 0 && opts.forcedIndex < length ? opts.forcedIndex : -1
  }
  if (opts?.hoverIdx !== undefined && opts.hoverIdx >= 0) {
    return opts.hoverIdx < length ? opts.hoverIdx : -1
  }
  const index = selectedSuggestion < 0 ? 0 : selectedSuggestion
  if (index >= length) return -1
  return index
}

/**
 * Directory Enter after onKeyDownBefore preventDefault:
 * densable Me uses ne.current (bash-path / command-arg / at-path), then pe()+r.
 * Fork mirrors with directoryContextRef (+ mode / isCommandInput fallback).
 */
function directoryEnterAction(opts: {
  mode: 'prompt' | 'bash'
  input: string
  isCommandInput: (s: string) => boolean
  directoryContext?: 'bash-path' | 'command-arg' | 'at-path' | null
}): 'submit-slash' | 'submit-bash' | 'apply-path' {
  const dirCtx = opts.directoryContext
  if (dirCtx === 'bash-path' || opts.mode === 'bash') return 'submit-bash'
  if (dirCtx === 'command-arg' || opts.isCommandInput(opts.input)) {
    return 'submit-slash'
  }
  return 'apply-path'
}

describe('typeahead Enter resolve index (densable Me)', () => {
  test('selected -1 with items uses first suggestion', () => {
    expect(resolveEnterIndex(-1, 3)).toBe(0)
  })

  test('selected 0 stays 0', () => {
    expect(resolveEnterIndex(0, 3)).toBe(0)
  })

  test('empty list returns -1 (no-op)', () => {
    expect(resolveEnterIndex(-1, 0)).toBe(-1)
    expect(resolveEnterIndex(0, 0)).toBe(-1)
  })

  test('out of range returns -1', () => {
    expect(resolveEnterIndex(5, 2)).toBe(-1)
  })

  test('hover index preferred over selected', () => {
    expect(resolveEnterIndex(0, 3, { hoverIdx: 2 })).toBe(2)
  })

  test('forcedIndex (click) preferred over hover', () => {
    expect(resolveEnterIndex(0, 3, { forcedIndex: 1, hoverIdx: 2 })).toBe(1)
  })
})

describe('directory Enter after preventDefault (densable pe+r)', () => {
  const isCommandInput = (s: string) => s.startsWith('/')

  test('command-arg context (/add-dir …) submits slash command', () => {
    expect(
      directoryEnterAction({
        mode: 'prompt',
        input: '/add-dir /tmp/foo',
        isCommandInput,
        directoryContext: 'command-arg',
      }),
    ).toBe('submit-slash')
  })

  test('command-arg /cd … submits slash command', () => {
    expect(
      directoryEnterAction({
        mode: 'prompt',
        input: '/cd /tmp',
        isCommandInput,
        directoryContext: 'command-arg',
      }),
    ).toBe('submit-slash')
  })

  test('bash-path context submits bash line', () => {
    expect(
      directoryEnterAction({
        mode: 'bash',
        input: 'ls ./src',
        isCommandInput,
        directoryContext: 'bash-path',
      }),
    ).toBe('submit-bash')
  })

  test('mode bash without context still submits bash', () => {
    expect(
      directoryEnterAction({
        mode: 'bash',
        input: 'cd /tmp',
        isCommandInput,
      }),
    ).toBe('submit-bash')
  })

  test('at-path applies path token, not submit', () => {
    expect(
      directoryEnterAction({
        mode: 'prompt',
        input: 'see @src/ho',
        isCommandInput,
        directoryContext: 'at-path',
      }),
    ).toBe('apply-path')
  })

  test('general @ path without context applies path token', () => {
    expect(
      directoryEnterAction({
        mode: 'prompt',
        input: 'see @src/ho',
        isCommandInput,
      }),
    ).toBe('apply-path')
  })
})

/**
 * densable onSubmit xU: every suggestion description==="directory" allows
 * submit without isSubmittingSlashCommand. densable g8s bash-path omits
 * description — fork treats path metadata the same so Me pe()+r is not
 * swallowed.
 */
function allowSubmitWithSuggestions(opts: {
  suggestions: Array<{
    description?: string
    metadata?: { type?: string }
  }>
  isSubmittingSlashCommand: boolean
}): boolean {
  if (opts.suggestions.length === 0) return true
  if (opts.isSubmittingSlashCommand) return true
  const hasPathOnly = opts.suggestions.every(s => {
    if (s.description === 'directory') return true
    const meta = s.metadata
    return meta?.type === 'directory' || meta?.type === 'file'
  })
  return hasPathOnly
}

describe('onSubmit path-suggestion allow (densable xU + g8s fix)', () => {
  test('pure directory description allows submit', () => {
    expect(
      allowSubmitWithSuggestions({
        suggestions: [
          { description: 'directory', metadata: { type: 'directory' } },
        ],
        isSubmittingSlashCommand: false,
      }),
    ).toBe(true)
  })

  test('bash-path file+dir metadata without description allows submit', () => {
    expect(
      allowSubmitWithSuggestions({
        suggestions: [
          { metadata: { type: 'directory' } },
          { metadata: { type: 'file' } },
        ],
        isSubmittingSlashCommand: false,
      }),
    ).toBe(true)
  })

  test('command suggestions still block submit', () => {
    expect(
      allowSubmitWithSuggestions({
        suggestions: [{ description: 'cmd', metadata: { type: 'local' } }],
        isSubmittingSlashCommand: false,
      }),
    ).toBe(false)
  })

  test('isSubmittingSlashCommand bypasses block', () => {
    expect(
      allowSubmitWithSuggestions({
        suggestions: [{ description: 'cmd', metadata: { type: 'local' } }],
        isSubmittingSlashCommand: true,
      }),
    ).toBe(true)
  })
})

/**
 * densable Me directory: Et===void 0 (Enter) vs Et set (click).
 * bash-path / command-arg Enter submit; click applies path token.
 */
function directoryAcceptAction(opts: {
  mode: 'prompt' | 'bash'
  input: string
  isCommandInput: (s: string) => boolean
  directoryContext?: 'bash-path' | 'command-arg' | 'at-path' | null
  /** densable Et — undefined = bare Enter, set = click/selectSuggestion */
  forcedIndex?: number
}): 'submit-slash' | 'submit-bash' | 'apply-path' {
  const isEnter = opts.forcedIndex === undefined
  const dirCtx = opts.directoryContext
  if (dirCtx === 'bash-path' || opts.mode === 'bash') {
    return isEnter ? 'submit-bash' : 'apply-path'
  }
  if (dirCtx === 'command-arg' || opts.isCommandInput(opts.input)) {
    return isEnter ? 'submit-slash' : 'apply-path'
  }
  return 'apply-path'
}

describe('directory Me Enter vs click (densable Et)', () => {
  const isCommandInput = (s: string) => s.startsWith('/')

  test('bash-path Enter submits bash', () => {
    expect(
      directoryAcceptAction({
        mode: 'bash',
        input: 'ls ./src',
        isCommandInput,
        directoryContext: 'bash-path',
      }),
    ).toBe('submit-bash')
  })

  test('bash-path click applies path', () => {
    expect(
      directoryAcceptAction({
        mode: 'bash',
        input: 'ls ./src',
        isCommandInput,
        directoryContext: 'bash-path',
        forcedIndex: 0,
      }),
    ).toBe('apply-path')
  })

  test('command-arg Enter submits slash', () => {
    expect(
      directoryAcceptAction({
        mode: 'prompt',
        input: '/cd /tmp',
        isCommandInput,
        directoryContext: 'command-arg',
      }),
    ).toBe('submit-slash')
  })

  test('command-arg click applies path', () => {
    expect(
      directoryAcceptAction({
        mode: 'prompt',
        input: '/cd /tm',
        isCommandInput,
        directoryContext: 'command-arg',
        forcedIndex: 1,
      }),
    ).toBe('apply-path')
  })

  test('at-path Enter and click both apply path', () => {
    expect(
      directoryAcceptAction({
        mode: 'prompt',
        input: 'see @src/ho',
        isCommandInput,
        directoryContext: 'at-path',
      }),
    ).toBe('apply-path')
    expect(
      directoryAcceptAction({
        mode: 'prompt',
        input: 'see @src/ho',
        isCommandInput,
        directoryContext: 'at-path',
        forcedIndex: 0,
      }),
    ).toBe('apply-path')
  })
})
