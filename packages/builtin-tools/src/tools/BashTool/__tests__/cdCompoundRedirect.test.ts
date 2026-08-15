/**
 * Official 2.1.207: compound `cd` + redirect only prompts when some target is
 * not `/dev/null`. Pure discards must not spuriously require approval.
 * Also covers bashMissKind tokens on compound-cd write/redirect paths.
 */
import { describe, expect, test } from 'bun:test'
import type { ToolPermissionContext } from 'src/Tool.js'
import { getPlatform } from 'src/utils/platform.js'
import {
  createPathChecker,
  isDiscardOutputRedirectTarget,
  validateOutputRedirections,
} from '../pathValidation.js'

function makeCtx(): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  }
}

describe('validateOutputRedirections cd-compound-redirect (2.1.207)', () => {
  test('cd + redirect to /dev/null only is passthrough', () => {
    const result = validateOutputRedirections(
      [{ target: '/dev/null', operator: '>' }],
      process.cwd(),
      makeCtx(),
      true,
    )
    expect(result.behavior).toBe('passthrough')
  })

  // densable 2.1.233 #20 — NUL is discard only on Windows; on Unix it is a real file
  test('cd + redirect to NUL is platform-gated', () => {
    for (const target of ['NUL', 'nul', '\\\\.\\NUL']) {
      const result = validateOutputRedirections(
        [{ target, operator: '>' }],
        process.cwd(),
        makeCtx(),
        true,
      )
      if (getPlatform() === 'windows') {
        expect(result.behavior).toBe('passthrough')
        expect(isDiscardOutputRedirectTarget(target)).toBe(true)
      } else {
        // Unix/WSL: `> nul` creates a real file — still cd-compound-redirect
        expect(isDiscardOutputRedirectTarget(target)).toBe(false)
        expect(result.behavior).toBe('ask')
        if (result.behavior === 'ask') {
          expect(result.decisionReason).toMatchObject({
            type: 'other',
            bashMissKind: 'cd-compound-redirect',
          })
        }
      }
    }
  })

  test('/dev/null is always discard on every platform', () => {
    expect(isDiscardOutputRedirectTarget('/dev/null')).toBe(true)
  })

  test('cd + redirect to a real file asks with bashMissKind', () => {
    const result = validateOutputRedirections(
      [{ target: 'settings.json', operator: '>' }],
      process.cwd(),
      makeCtx(),
      true,
    )
    expect(result.behavior).toBe('ask')
    if (result.behavior === 'ask') {
      expect(result.message).toContain(
        'change directories and write via output redirection',
      )
      expect(result.decisionReason).toMatchObject({
        type: 'other',
        bashMissKind: 'cd-compound-redirect',
      })
    }
  })

  test('cd + mixed /dev/null and real file still asks', () => {
    const result = validateOutputRedirections(
      [
        { target: '/dev/null', operator: '>' },
        { target: 'out.txt', operator: '>>' },
      ],
      process.cwd(),
      makeCtx(),
      true,
    )
    expect(result.behavior).toBe('ask')
    if (result.behavior === 'ask') {
      expect(result.message).toContain(
        'change directories and write via output redirection',
      )
      expect(result.decisionReason).toMatchObject({
        bashMissKind: 'cd-compound-redirect',
      })
    }
  })

  test('without cd, /dev/null and files still validate (passthrough for null)', () => {
    const result = validateOutputRedirections(
      [{ target: '/dev/null', operator: '>' }],
      process.cwd(),
      makeCtx(),
      false,
    )
    expect(result.behavior).toBe('passthrough')
  })
})

describe('cd-compound-write / cd-multi-positional bashMissKind (2.1.207)', () => {
  // Call createPathChecker directly so full-suite mock.module pollution of
  // shell-quote / splitCommand cannot skip the path-validation branch.
  test('compound cd + write emits cd-compound-write', () => {
    const result = createPathChecker('mv')(
      ['a', 'b'],
      process.cwd(),
      makeCtx(),
      true,
    )
    expect(result.behavior).toBe('ask')
    expect(result.decisionReason).toMatchObject({
      type: 'other',
      bashMissKind: 'cd-compound-write',
    })
  })

  test('cd OLD NEW emits cd-multi-positional', () => {
    const result = createPathChecker('cd')(
      ['old', 'new'],
      process.cwd(),
      makeCtx(),
      false,
    )
    expect(result.behavior).toBe('ask')
    expect(result.decisionReason).toMatchObject({
      type: 'other',
      bashMissKind: 'cd-multi-positional',
    })
  })
})
