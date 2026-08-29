/**
 * densable hGw / w$m — headless arg parse.
 */
import { describe, expect, test } from 'bun:test'
import {
  AUTO_MODE_SETUP_USAGE,
  parseAutoModeSetupHeadlessArgs,
} from '../headlessArgs.js'

describe('parseAutoModeSetupHeadlessArgs', () => {
  test('usage on empty / help', () => {
    expect(parseAutoModeSetupHeadlessArgs('').mode).toBe('usage')
    const help = parseAutoModeSetupHeadlessArgs('--help')
    expect(help.mode).toBe('usage')
    if (help.mode === 'usage') {
      expect(help.message).toBe(AUTO_MODE_SETUP_USAGE)
    }
  })

  test('propose wizard flags', () => {
    const parsed = parseAutoModeSetupHeadlessArgs(
      '--wizard posture=mixed scope=project depth=both --propose',
    )
    expect(parsed).toEqual({
      mode: 'propose',
      answers: { posture: 'mixed', scope: 'project', depth: 'both' },
    })
  })

  test('request-id prefix + propose', () => {
    const parsed = parseAutoModeSetupHeadlessArgs(
      '--request-id 550e8400-e29b-41d4-a716-446655440000 --wizard posture=personal scope=all depth=shell --propose',
    )
    expect(parsed.mode).toBe('propose')
    expect(parsed.requestId).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  test('apply-file requires hash-before-path order', () => {
    const parsed = parseAutoModeSetupHeadlessArgs(
      '--expect-sha256 ' + 'a'.repeat(64) + ' --apply-file /tmp/proposal.json',
    )
    expect(parsed).toEqual({
      mode: 'apply-file',
      path: '/tmp/proposal.json',
      expectedSha256: 'a'.repeat(64),
    })
  })

  test('rejects one-shot --apply', () => {
    const parsed = parseAutoModeSetupHeadlessArgs('--apply')
    expect(parsed.mode).toBe('usage')
    if (parsed.mode === 'usage') {
      expect(parsed.message).toContain('One-shot --apply')
    }
  })

  test('apply-target before expect-sha256', () => {
    const parsed = parseAutoModeSetupHeadlessArgs(
      `--apply-target project --expect-sha256 ${'b'.repeat(64)} --apply-file '/tmp/x.json'`,
    )
    expect(parsed).toEqual({
      mode: 'apply-file',
      path: '/tmp/x.json',
      target: 'project',
      expectedSha256: 'b'.repeat(64),
    })
  })
})
