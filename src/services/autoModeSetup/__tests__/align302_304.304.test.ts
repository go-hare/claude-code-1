import { afterEach, describe, expect, test } from 'bun:test'
import { resolveAutoModeSetupClassifierModel } from '../classifierModel.js'
import {
  isAutoModeSetupBaseGate,
  isAutoModeSetupEnabled,
  isAutoModeSetupInteractiveEnabled,
} from '../gates.js'

describe('autoModeSetup alignment (#894, #961)', () => {
  const origRemote = process.env.CLAUDE_CODE_REMOTE
  const origAutoModel = process.env.CLAUDE_CODE_AUTO_MODE_MODEL
  const origDisableTelemetry = process.env.DISABLE_TELEMETRY

  afterEach(() => {
    if (origRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
    else process.env.CLAUDE_CODE_REMOTE = origRemote
    if (origAutoModel === undefined)
      delete process.env.CLAUDE_CODE_AUTO_MODE_MODEL
    else process.env.CLAUDE_CODE_AUTO_MODE_MODEL = origAutoModel
    if (origDisableTelemetry === undefined) delete process.env.DISABLE_TELEMETRY
    else process.env.DISABLE_TELEMETRY = origDisableTelemetry
  })

  test('#961 isAutoModeSetupBaseGate returns true when CLAUDE_CODE_REMOTE is unset (not gated by TRANSCRIPT_CLASSIFIER)', () => {
    delete process.env.CLAUDE_CODE_REMOTE
    expect(isAutoModeSetupBaseGate()).toBe(true)
    process.env.CLAUDE_CODE_REMOTE = '1'
    expect(isAutoModeSetupBaseGate()).toBe(false)
  })

  test('#961 isAutoModeSetupEnabled and isAutoModeSetupInteractiveEnabled work with baked envOnboarding: true', () => {
    delete process.env.CLAUDE_CODE_REMOTE
    process.env.DISABLE_TELEMETRY = '1'
    expect(isAutoModeSetupEnabled()).toBe(true)
    expect(isAutoModeSetupInteractiveEnabled()).toBe(true)
  })

  test('#894 resolveAutoModeSetupClassifierModel delegates to getClassifierModel()', () => {
    const model = resolveAutoModeSetupClassifierModel()
    expect(typeof model).toBe('string')
    expect(model.length).toBeGreaterThan(0)
  })
})
