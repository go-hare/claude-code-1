/**
 * densable 2.1.283 Obe leftover: noise-filter / preSession toggle / file detail.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { DOMElement } from '@anthropic/ink'
import { shouldRequeueOnPreempt } from '../../context/notifications.js'
import type { AppState } from '../../state/AppStateStore.js'
import { isGeneratedFile, isTestFile } from '../generatedFiles.js'
import {
  clampedScrollTop,
  hideDiffPanelLatch,
  notificationsHoldToasts,
  parseSgrWheel,
  resolveDiffFileAtY,
  showDiffPanelLatch,
} from '../replDiffMouseHost.js'
import {
  REPL_DIFF_EMPTY_SESSION,
  REPL_DIFF_EMPTY_UNCOMMITTED,
  REPL_DIFF_LIST_WINDOW,
  REPL_DIFF_NO_COMMITS_HEADLINE,
  REPL_DIFF_PRESESSION_HUNKS_CAP,
  REPL_DIFF_TOO_MANY_HEADLINE,
  REPL_DIFF_UNAVAILABLE_HEADLINE,
  partitionReplDiffFiles,
  replDiffEmptyCopy,
  replDiffHiddenEmptyCopy,
  replDiffRequestedModeLabel,
} from '../replDiffTab.js'

const panel = readFileSync(
  join(import.meta.dir, '../../components/diff/ReplDiffPanel.tsx'),
  'utf8',
)
const detail = readFileSync(
  join(import.meta.dir, '../../components/diff/DiffDetailView.tsx'),
  'utf8',
)
const bindings = readFileSync(
  join(import.meta.dir, '../../keybindings/defaultBindings.ts'),
  'utf8',
)
const schema = readFileSync(
  join(import.meta.dir, '../../keybindings/schema.ts'),
  'utf8',
)

describe('densable 2.1.283 Obe leftover', () => {
  test('bX=8 / kX=20 windows', () => {
    expect(REPL_DIFF_LIST_WINDOW).toBe(8)
    expect(REPL_DIFF_PRESESSION_HUNKS_CAP).toBe(20)
  })

  test('WUn / LTr classify generated + test paths', () => {
    expect(isGeneratedFile('dist/bundle.js')).toBe(true)
    expect(isGeneratedFile('src/app.ts')).toBe(false)
    expect(isTestFile('src/__tests__/foo.ts')).toBe(true)
    expect(isTestFile('foo.spec.ts')).toBe(true)
    expect(isTestFile('src/app.ts')).toBe(false)
  })

  test('partition: deny then preSession then noise', () => {
    const files = [
      { path: 'src/a.ts', linesAdded: 1, linesRemoved: 0 },
      { path: 'src/b.spec.ts', linesAdded: 2, linesRemoved: 0 },
      { path: 'old.ts', linesAdded: 9, linesRemoved: 1, preSession: true },
      { path: 'secret.ts', linesAdded: 3, linesRemoved: 0 },
    ]
    const hidden = partitionReplDiffFiles(
      files,
      path => path === 'secret.ts',
      false,
    )
    expect(hidden.files.map(f => f.path)).toEqual(['src/a.ts'])
    expect(hidden.preSessionFiles.map(f => f.path)).toEqual(['old.ts'])
    expect(hidden.noiseCount).toBe(1)
    expect(hidden.deniedHidden).toBe(1)
    const shown = partitionReplDiffFiles(
      files,
      path => path === 'secret.ts',
      true,
    )
    expect(shown.files.map(f => f.path)).toEqual(['src/a.ts', 'src/b.spec.ts'])
    expect(shown.noiseCount).toBe(1)
  })

  test('Obe empty / hidden / Rtt copy', () => {
    expect(replDiffEmptyCopy('uncommitted', { kind: 'working-tree' })).toEqual({
      headline: REPL_DIFF_EMPTY_UNCOMMITTED,
      hint: null,
    })
    expect(replDiffEmptyCopy('session', { kind: 'working-tree' })).toEqual({
      headline: REPL_DIFF_EMPTY_SESSION,
      hint: null,
    })
    expect(
      replDiffEmptyCopy('uncommitted', { kind: 'working-tree' }, true).headline,
    ).toBe(REPL_DIFF_NO_COMMITS_HEADLINE)
    expect(replDiffHiddenEmptyCopy(1, 1).headline).toBe(
      'Only hidden files changed',
    )
    expect(replDiffHiddenEmptyCopy(1, 0).headline).toBe(
      'Only read-denied files changed',
    )
    expect(replDiffHiddenEmptyCopy(0, 2).headline).toBe(
      'Only tests and generated files changed',
    )
    expect(
      replDiffRequestedModeLabel('session', { kind: 'working-tree' }, false),
    ).toBe('this session')
    expect(
      replDiffRequestedModeLabel('uncommitted', { kind: 'working-tree' }, true),
    ).toBe('uncommitted (vs HEAD)…')
    expect(
      replDiffRequestedModeLabel(
        'branch',
        { kind: 'branch', baseBranch: 'main' },
        false,
      ),
    ).toBe('branch vs main')
    expect(REPL_DIFF_UNAVAILABLE_HEADLINE).toBe('Diff unavailable')
    expect(REPL_DIFF_TOO_MANY_HEADLINE).toBe(
      'Too many changed files to show diff',
    )
  })

  test('panel hosts noise/preSession/list keys + TU/Lbe/Fbe copy', () => {
    expect(panel).toContain('app:toggleDiffNoiseFilter')
    expect(panel).toContain('app:toggleDiffPreSession')
    expect(panel).toContain('app:diffFileListUp')
    expect(panel).toContain('app:diffFileListDown')
    expect(panel).toContain("context: 'DiffPanel'")
    expect(panel).toContain('edited before this session')
    expect(panel).toContain('/generated (')
    expect(panel).toContain('REPL_DIFF_LIST_WINDOW')
    expect(schema).toContain("'DiffPanel'")
    expect(schema).toContain("'app:toggleDiffNoiseFilter'")
    expect(schema).toContain("'app:toggleDiffPreSession'")
    expect(bindings).toContain("'ctrl+up': 'app:diffFileListUp'")
    expect(bindings).toContain("'ctrl+x b': 'app:cycleDiffBase'")
    expect(bindings).toContain("context: 'DiffPanel'")
    expect(bindings).toContain("'ctrl+l': 'chat:clearInput'")
  })

  test('sPe file-detail copy', () => {
    expect(detail).toContain('Content restricted by read-permission rules')
    expect(detail).toContain('New file not yet staged.')
    expect(detail).toContain('Run `git add :/')
    expect(detail).toContain('Binary file - cannot display diff')
    expect(detail).toContain('Large file - diff exceeds 1 MB limit')
    expect(detail).toContain('Diff too large to display.')
    expect(detail).toContain('isRestricted')
  })
})

describe('densable 2.1.283 Obe mouse host', () => {
  const store = readFileSync(
    join(import.meta.dir, '../../state/AppStateStore.ts'),
    'utf8',
  )
  const handlers = readFileSync(
    join(
      import.meta.dir,
      '../../../packages/@ant/ink/src/core/events/event-handlers.ts',
    ),
    'utf8',
  )
  const sidebar = readFileSync(
    join(
      import.meta.dir,
      '../../components/diff/ReplDiffSidebarController.tsx',
    ),
    'utf8',
  )

  test('QSe click-Y maps to file path (yoga tops + zJ scroll)', () => {
    const root = fakeBox({ top: 0, height: 40 })
    const body = fakeBox({ top: 10, height: 20, parent: root })
    const fileA = fakeBox({ top: 2, height: 5, parent: body })
    const fileB = fakeBox({ top: 7, height: 4, parent: body })
    const files = new Map([
      ['a.ts', fileA],
      ['b.ts', fileB],
    ])
    // containerTop=10; a.ts screen 12..17; b.ts 17..21
    expect(resolveDiffFileAtY(9, body, files)).toBeUndefined()
    expect(resolveDiffFileAtY(12, body, files)).toBe('a.ts')
    expect(resolveDiffFileAtY(16, body, files)).toBe('a.ts')
    expect(resolveDiffFileAtY(17, body, files)).toBe('b.ts')
    expect(resolveDiffFileAtY(21, body, files)).toBeUndefined()

    body.scrollTop = 3
    body.scrollHeight = 40
    body.scrollViewportHeight = 20
    // gold QSe: container yoga top is not scroll-adjusted, so y < 10 is out.
    // a.ts after zJ: 9..14; visible-in-container is 10..14
    expect(resolveDiffFileAtY(9, body, files)).toBeUndefined()
    expect(resolveDiffFileAtY(10, body, files)).toBe('a.ts')
    expect(resolveDiffFileAtY(14, body, files)).toBe('b.ts')
  })

  test('zJ clamps scrollTop to content max', () => {
    const node = fakeBox({
      top: 0,
      height: 10,
      scrollTop: 100,
      scrollHeight: 50,
      scrollViewportHeight: 20,
    })
    expect(clampedScrollTop(node)).toBe(30)
    const unbounded = fakeBox({ top: 0, height: 10, scrollTop: 4 })
    expect(clampedScrollTop(unbounded)).toBe(4)
  })

  test('SGR wheel deltaY + 0-indexed row; Ink EventHandlerProps has onWheel', () => {
    expect(parseSgrWheel('\x1b[<64;10;20M', { wheelUp: true })).toEqual({
      deltaY: -1,
      row: 19,
    })
    expect(parseSgrWheel('\x1b[<65;3;8m', { wheelDown: true })).toEqual({
      deltaY: 1,
      row: 7,
    })
    expect(parseSgrWheel(undefined, { wheelDown: true })).toEqual({
      deltaY: 1,
      row: null,
    })
    expect(parseSgrWheel('\x1b[<64;1;1M', {})).toBeNull()
    // densable Wd — EventHandlerProps now includes onWheel (pane host uses it).
    expect(handlers).toContain('onWheel?: WheelEventHandler')
    expect(panel).toContain('useReplDiffSelectionAttach')
    expect(panel).toContain('parseSgrWheel')
    expect(panel).toContain('scrollBy(deltaY * 3)')
    expect(panel).toContain('ref={stripRef}')
    expect(panel).toContain('scrollToFile')
    expect(sidebar).toContain('minCol={Math.max(0, columns - width)}')
  })

  test('ruo/auo diffPanelVisible is a separate AppState latch', () => {
    expect(store).toContain('diffPanelVisible: boolean')
    expect(store).toContain('diffPanelVisible: false')
    // densable paneHoldsToasts + Pte OR with diffPanelVisible.
    expect(store).toContain('paneHoldsToasts: boolean')
    expect(store).toContain('paneHoldsToasts: false')
    const closed = {
      diffPanelVisible: false,
      paneHoldsToasts: false,
    } as AppState
    const opened = showDiffPanelLatch(closed)
    expect(opened.diffPanelVisible).toBe(true)
    expect(opened).not.toBe(closed)
    expect(showDiffPanelLatch(opened)).toBe(opened)
    expect(hideDiffPanelLatch(opened).diffPanelVisible).toBe(false)
    expect(hideDiffPanelLatch(closed)).toBe(closed)
    expect(notificationsHoldToasts(opened)).toBe(true)
    expect(notificationsHoldToasts(closed)).toBe(false)
    expect(
      notificationsHoldToasts({
        diffPanelVisible: false,
        paneHoldsToasts: true,
      } as AppState),
    ).toBe(true)
    expect(panel).toContain('showDiffPanelLatch')
    expect(panel).toContain('hideDiffPanelLatch')
    expect(sidebar).toContain(
      'onAskAboutSelection?: (payload: DiffSelectionAttach) => void',
    )
    expect(sidebar).toContain('onAskAboutSelection={onAskAboutSelection}')
    const repl = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(repl).toContain(
      'onAskAboutSelection={kZt ? undefined : setIDESelection}',
    )
    expect(
      shouldRequeueOnPreempt(
        {
          key: 'x',
          priority: 'immediate',
          text: 'a',
          heldDuringDiffPanel: true,
        },
        { key: 'y', priority: 'immediate', text: 'b' },
      ),
    ).toBe(true)
  })
})

function fakeBox(opts: {
  top: number
  height: number
  parent?: DOMElement
  scrollTop?: number
  scrollHeight?: number
  scrollViewportHeight?: number
}): DOMElement {
  return {
    nodeName: 'ink-box',
    attributes: {},
    childNodes: [],
    style: {},
    dirty: false,
    parentNode: opts.parent,
    yogaNode: {
      getComputedTop: () => opts.top,
      getComputedHeight: () => opts.height,
    },
    scrollTop: opts.scrollTop,
    scrollHeight: opts.scrollHeight,
    scrollViewportHeight: opts.scrollViewportHeight,
  } as unknown as DOMElement
}
