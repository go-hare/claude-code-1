import { describe, expect, test } from 'bun:test'
import * as fs from 'fs'
import * as path from 'path'
import { computeNfcInsertResult, orderToastsForStack } from '../utils.js'

describe('PromptInput alignment #226, #397, #464', () => {
  test('#397 computeNfcInsertResult keeps cursor aligned after pasting macOS NFD accented text', () => {
    // NFD "cafe\u0301" (5 code units) folds to NFC "caf\u00e9" (4 code units)
    const nfd = 'cafe\u0301'
    const res = computeNfcInsertResult('hello world', 6, nfd)
    expect(res.newInput).toBe('hello caf\u00e9world')
    expect(res.newOffset).toBe(6 + 4) // right before 'world', not 1 char into 'world'
  })

  test('#226 PromptInput clears footerSelection on ! and uses live refs + NFC in footerItemSelected handler', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dir, '../PromptInput.tsx'),
      'utf8',
    )
    expect(src).toContain('const liveVal = liveInputRef.current;')
    expect(src).toContain('const liveOff = cursorOffsetRef.current;')
    expect(src).toContain(
      'const { newInput, newOffset } = computeNfcInsertResult(liveVal, liveOff, char);',
    )
    expect(src).toContain(
      'setAppState(prev => (prev.footerSelection === null ? prev : { ...prev, footerSelection: null }));',
    )
  })

  test('#464 orderToastsForStack puts managed mods toasts ahead of other mods', () => {
    const ordered = orderToastsForStack([
      { id: '1', owner: 'user-mod', isManaged: false },
      { id: '2', owner: 'org-mod', isManaged: true },
      { id: '3', owner: 'other-mod', isManaged: false },
    ])
    // In ToastBoxes, .slice(-shownCount) takes from the end, so managed toasts sort last (front of stack)
    expect(ordered.map(t => t.id)).toEqual(['1', '3', '2'])
  })
})
