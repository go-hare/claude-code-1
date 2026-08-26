/**
 * densable phn / recordExternalIncludesDecision — flags + source event.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { recordExternalIncludesDecision } from '../ClaudeMdExternalIncludesDialog.js'
import { getCurrentProjectConfig } from '../../utils/config.js'

describe('densable phn recordExternalIncludesDecision', () => {
  const prevApproved =
    getCurrentProjectConfig().hasClaudeMdExternalIncludesApproved
  const prevShown =
    getCurrentProjectConfig().hasClaudeMdExternalIncludesWarningShown

  afterEach(() => {
    const cfg = getCurrentProjectConfig()
    cfg.hasClaudeMdExternalIncludesApproved = prevApproved
    cfg.hasClaudeMdExternalIncludesWarningShown = prevShown
  })

  test('writes both flags and accepts dialog source', () => {
    recordExternalIncludesDecision(true, 'dialog')
    const cfg = getCurrentProjectConfig()
    expect(cfg.hasClaudeMdExternalIncludesApproved).toBe(true)
    expect(cfg.hasClaudeMdExternalIncludesWarningShown).toBe(true)
  })

  test('config_toggle decline clears approval', () => {
    recordExternalIncludesDecision(false, 'config_toggle')
    const cfg = getCurrentProjectConfig()
    expect(cfg.hasClaudeMdExternalIncludesApproved).toBe(false)
    expect(cfg.hasClaudeMdExternalIncludesWarningShown).toBe(true)
  })
})
