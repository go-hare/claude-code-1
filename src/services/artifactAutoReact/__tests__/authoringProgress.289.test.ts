/**
 * densable 2.1.289 workshop authoringProgress b/P/x.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  deriveAuthoringProgress,
  extractFilePaths,
} from '../authoringProgress.js'

const SRC = join(import.meta.dir, '../authoringProgress.ts')
const HOST = join(import.meta.dir, '../../../utils/sessionHost.ts')
const MESSAGES = join(import.meta.dir, '../../../utils/messages.ts')
const REPL = join(import.meta.dir, '../../../screens/REPL.tsx')

describe('densable 2.1.289 authoringProgress', () => {
  test('P extracts file_path/path; YWt is .workshop.html', () => {
    expect(
      extractFilePaths('{"file_path":"foo.workshop.html","content":"x"}'),
    ).toEqual(['foo.workshop.html'])
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain(".endsWith('.workshop.html')")
  })

  test('b deriveAuthoringProgress design page / figure / decision', () => {
    expect(deriveAuthoringProgress('{"content":"hello"}')).toBe(
      'authoring the design page',
    )
    expect(
      deriveAuthoringProgress('{"content":"<figure class=\\"x\\">"}'),
    ).toBe('drawing figure 1')
    expect(
      deriveAuthoringProgress(
        String.raw`{"content":"data-decision-id=\"abc\""}`,
      ),
    ).toBe('drawing decision 1 — abc')
  })

  test('source never exports N/U/W/G/Rx/yQ; X().authoringProgress on SessionHost', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).not.toContain('export function N(')
    expect(src).not.toContain('export function U(')
    expect(src).not.toContain('export function W(')
    expect(src).not.toContain('export function G(')
    expect(src).not.toContain('export function Rx(')
    expect(src).not.toContain('export function yQ(')
    expect(src).toContain('WRITE_EDIT_BY_NAME')
    expect(src).toContain('getAllBaseTools')
    expect(src).toContain('FileWriteTool')
    expect(src).toContain('FileEditTool')
    expect(src).toContain('getBootstrapSessionHost().authoringProgress')
    expect(src).toContain('isWorkshopArtifactEligible')
    expect(src).toContain('allow_cobalt_plinth')
    expect(src).toContain('tengu_cobalt_plinth')
    expect(src).toContain('switched_off')
    expect(src).toContain('env-quad')
    expect(src).toContain('surface_excluded')
    expect(src).toContain('plan_unreadable')
    expect(src).toContain('org_policy_unverifiable')
    expect(src).toContain('policy_unavailable')
    expect(src).toContain('admin_policy')
    expect(src).toContain('policy_fetch_failed')
    expect(src).toContain('policy_route_missing')
    expect(src).toContain('latched')
    expect(src).toContain('isWorkshopCm')
    expect(src).toContain('isWorkshopOzt')
    expect(src).toContain('isWorkshopGd')
    expect(src).toContain('isWorkshopHnr')
    expect(src).toContain('getConfiguredApiKeyHelper')
    expect(src).toContain('noteImplicitProfileSkippedStoredLogin')
    expect(src).toContain('isPolicyLimitsAllowed')
    expect(src).toContain('artifactPolicyFetchAnswer')
    expect(src).toContain('leftoverPolicyLimitsIe')
    const host = readFileSync(HOST, 'utf8')
    expect(host).toContain('authoringProgress: AuthoringProgressBag')
    expect(host).toContain('artifactPolicyFetchAnswer')
    expect(host).toContain('this.artifactPolicyFetchAnswer = null')
    expect(host).toContain('slotsByBlockIndex: new Map()')
    expect(host).toContain('failureReported: false')
    const messages = readFileSync(MESSAGES, 'utf8')
    expect(messages).toContain('authoringProgressSurface')
    expect(messages).toContain('onToolUseStart')
    expect(messages).toContain('onInputJsonDelta')
    expect(messages).toContain('onToolUseStop')
    const repl = readFileSync(REPL, 'utf8')
    expect(repl).toContain('true, // densable authoringProgressSurface:!0')
  })
})
