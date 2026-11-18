import { describe, expect, test } from 'bun:test'
import {
  activatePlanFileCache,
  getPlan,
  getPlanFilePath,
  hydratePlanFromBackend,
  notePlanFileForgotten,
  notePlanFileWritten,
  resetPlanFileCacheForTests,
} from './plans.js'

describe('#92 planFileCache persistence across container restarts', () => {
  test('getPlan falls back to planFileCache on ENOENT and hydratePlanFromBackend restores from backend', async () => {
    resetPlanFileCacheForTests()
    const path = getPlanFilePath()
    notePlanFileWritten(path, '# My Plan\n1. Step one')
    expect(getPlan()).toBe('# My Plan\n1. Step one')

    notePlanFileForgotten(path)
    activatePlanFileCache({
      readText: async () => '# Restored Plan',
    })
    const hydrated = await hydratePlanFromBackend()
    expect(hydrated).toBe('# Restored Plan')
    expect(getPlan()).toBe('# Restored Plan')
    resetPlanFileCacheForTests()
  })
})
