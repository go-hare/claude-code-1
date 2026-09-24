import { afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { ToolPermissionContext } from '../../Tool.js'
import {
  getBootstrapSession,
  resetSessionHostForTests,
} from '../../utils/sessionRoot.js'
import { maybeRequestAutoDefaultNudge } from '../openAutoDefaultNudge.js'
import type { RequestDialog } from '../requestDialog.js'
import { f_, oc, pie, wt } from '../shouldShowAutoDefaultNudge.js'

const ORIGINAL_KIND = process.env.CLAUDE_CODE_SESSION_KIND

function restoreUnattended(): void {
  if (ORIGINAL_KIND === undefined) {
    delete process.env.CLAUDE_CODE_SESSION_KIND
  } else {
    process.env.CLAUDE_CODE_SESSION_KIND = ORIGINAL_KIND
  }
  resetSessionHostForTests()
}

function attendedCtx(): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    isAutoModeAvailable: true,
  } as ToolPermissionContext
}

describe('auto-default nudge skips unattended sessions (2.1.251 #42)', () => {
  afterEach(restoreUnattended)

  test('wt is CLAUDE_CODE_SESSION_KIND === bg', () => {
    delete process.env.CLAUDE_CODE_SESSION_KIND
    expect(wt()).toBe(false)
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    expect(wt()).toBe(true)
    process.env.CLAUDE_CODE_SESSION_KIND = 'daemon'
    expect(wt()).toBe(false)
  })

  test('oc reads n().surfaceCapabilities.replBridgeActive()', () => {
    delete process.env.CLAUDE_CODE_SESSION_KIND
    const caps = getBootstrapSession().surfaceCapabilities
    expect(oc()).toBe(false)
    caps.replaceReplBridgeActive(true)
    expect(oc()).toBe(true)
  })

  test('pie reads n().host.extensionsConfig.teammateAgentId()', () => {
    delete process.env.CLAUDE_CODE_SESSION_KIND
    const ext = getBootstrapSession().host.extensionsConfig
    expect(pie()).toBeUndefined()
    ext.replaceTeammateAgentId('worker')
    expect(pie()).toBe('worker')
  })

  test('f_ is oc() || wt() || pie() !== undefined', () => {
    delete process.env.CLAUDE_CODE_SESSION_KIND
    expect(f_()).toBe(false)

    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    expect(f_()).toBe(true)
    delete process.env.CLAUDE_CODE_SESSION_KIND
    expect(f_()).toBe(false)

    getBootstrapSession().host.extensionsConfig.replaceTeammateAgentId('worker')
    expect(f_()).toBe(true)
    resetSessionHostForTests()
    expect(f_()).toBe(false)

    getBootstrapSession().surfaceCapabilities.replaceReplBridgeActive(true)
    expect(f_()).toBe(true)
  })

  test('maybeRequestAutoDefaultNudge skips before dialog on wt/f_', async () => {
    delete process.env.CLAUDE_CODE_SESSION_KIND
    const requestDialog = mock(() =>
      Promise.resolve('declined'),
    ) as unknown as RequestDialog
    const setAppState = mock(() => {})
    const addNotification = mock(() => {})
    const getContext = () => attendedCtx()

    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    expect(
      await maybeRequestAutoDefaultNudge(
        requestDialog,
        getContext,
        setAppState,
        addNotification,
      ),
    ).toBe('skipped')
    delete process.env.CLAUDE_CODE_SESSION_KIND

    getBootstrapSession().host.extensionsConfig.replaceTeammateAgentId('worker')
    expect(
      await maybeRequestAutoDefaultNudge(
        requestDialog,
        getContext,
        setAppState,
        addNotification,
      ),
    ).toBe('skipped')
    resetSessionHostForTests()

    getBootstrapSession().surfaceCapabilities.replaceReplBridgeActive(true)
    expect(
      await maybeRequestAutoDefaultNudge(
        requestDialog,
        getContext,
        setAppState,
        addNotification,
      ),
    ).toBe('skipped')

    expect(requestDialog).not.toHaveBeenCalled()
  })

  test('the opener consults wt then f_ before the dialog', () => {
    const src = readFileSync(
      join(import.meta.dir, '../openAutoDefaultNudge.ts'),
      'utf8',
    )
    const opener = src.slice(
      src.indexOf('export async function maybeRequestAutoDefaultNudge'),
    )
    const wtGate = opener.indexOf('if (wt()) return')
    const fGate = opener.indexOf('if (f_()) return')
    const dialog = opener.indexOf('shouldShowAutoDefaultNudge(getContext())')
    expect(wtGate).toBeGreaterThan(-1)
    expect(fGate).toBeGreaterThan(wtGate)
    expect(dialog).toBeGreaterThan(fGate)
    expect(opener).not.toContain('isUnattendedAutoDefaultNudgeSession')
    expect(src).not.toContain('getAgentId()')
    // gold `#r` still has `_re` after f_ skip in some arms — body ABSENT
    expect(src).not.toContain('_re(')
  })
})
