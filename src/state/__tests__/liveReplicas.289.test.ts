/**
 * densable 2.1.289 AppState.liveReplicas — DualInk store shape (void 0 hosts).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  createEmptyLiveReplicas,
  getDefaultAppState,
} from '../AppStateStore.js'

describe('densable 2.1.289 liveReplicas', () => {
  test('gold slots exist; host functions stay undefined', () => {
    const live = getDefaultAppState().liveReplicas
    expect(live.replicas).toBeInstanceOf(Map)
    expect(live.unanswered).toBeInstanceOf(Map)
    expect(live.unavailable).toBeInstanceOf(Map)
    expect(live.tooOld).toBeInstanceOf(Set)
    expect(live.cloudUnserved).toBeInstanceOf(Set)
    expect(live.opening).toBeInstanceOf(Map)
    expect(live.binding).toBeInstanceOf(Map)
    expect(live.transport).toBeUndefined()
    expect(live.engine).toBeUndefined()
    expect(live.renderLevel).toBeUndefined()
    expect(live.headMoved).toBeUndefined()
    expect(live.workingCopyPath).toBeUndefined()
    expect(live.settleFileChange).toBeUndefined()
    expect(live.liveFileEnded).toBeUndefined()
    expect(live.pushHeldSaves).toBeUndefined()
    expect(live.heldSavesExitCleanup).toBeUndefined()
  })

  test('DualInk se/also never assign workingCopyPath hosts', () => {
    const src = readFileSync(
      join(import.meta.dir, '../AppStateStore.ts'),
      'utf8',
    )
    expect(src).toContain('workingCopyPath: undefined')
    expect(src).toContain('settleFileChange: undefined')
    expect(src).toContain('liveFileEnded: undefined')
    const tool = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/ArtifactTool/ArtifactTool.ts',
      ),
      'utf8',
    )
    expect(tool).not.toContain('workingCopyPath =')
    expect(tool).not.toContain('settleFileChange =')
    expect(tool).not.toContain('liveFileEnded =')
  })

  test('createEmptyLiveReplicas matches default AppState', () => {
    const a = createEmptyLiveReplicas()
    const b = getDefaultAppState().liveReplicas
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort())
  })
})
