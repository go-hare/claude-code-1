/**
 * densable 2.1.283 leftover gold `ko` @202260269 BODY wrap.
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { analyticsMock } from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'

mock.module('../../utils/debug.js', () => debugMock())
mock.module('../../utils/debug.ts', () => debugMock())
mock.module('src/utils/debug.js', () => debugMock())
mock.module('src/utils/debug.ts', () => debugMock())
mock.module('../../services/analytics/index.js', () => analyticsMock())
mock.module('../../services/analytics/index.ts', () => analyticsMock())
mock.module('src/services/analytics/index.js', () => analyticsMock())
mock.module('src/services/analytics/index.ts', () => analyticsMock())

const {
  CLOUD_HOOK_ENTRY_REASON,
  INTERPRETER_HASHBANG_NAMES,
  INTERPRETER_IT_NAMES,
  INTERPRETER_MAY_LOAD_FROM_CHECKOUT,
  INTERPRETER_SANDBOX_WRITE_INLET_COVERS,
  INTERPRETER_UNVOUCHED_RELATIVE_OR_ENV,
  cloudDeviceMarkNotHonouredInCheckoutCopy,
  cloudHookAfterEditNotForwardedCopy,
  cloudHookEntryDeviceAfterEditCopy,
  cloudHookEntryInReachCopy,
  cloudHookEntryInterpreterUnvouchedCopy,
  cloudHookEntrySkipCopy,
  cloudHookEntryUnreadableAtStartupCopy,
  composeExtraReachForCloudHooks,
} = await import('../extraReach.js')
const { classifyCloudHookEntry, offerCloudHookEntry } = await import(
  '../leftoverCloudHookOffer.js'
)
import type {
  CloudHookOfferEntry,
  CloudHookOfferHook,
} from '../leftoverCloudHookOffer.js'

const src = readFileSync(
  join(import.meta.dir, '../leftoverCloudHookOffer.ts'),
  'utf8',
)

function entry(
  partial: Partial<CloudHookOfferEntry> & {
    hook?: Partial<CloudHookOfferHook>
  } = {},
): CloudHookOfferEntry {
  return {
    event: partial.event ?? 'PreToolUse',
    matcher: partial.matcher,
    source: partial.source ?? { source: 'user' },
    hook: {
      type: 'command',
      command: 'fmt',
      ...partial.hook,
    },
  }
}

describe('leftoverCloudHookOffer 283 leftover gold ko BODY', () => {
  test('source-locks gold leftover ko strings; no minify public API', () => {
    expect(src).toContain('gold `ko` @202260269')
    expect(src).toContain('offerCloudHookEntry')
    expect(src).toContain('classifyCloudHookEntry')
    expect(src).toContain('cloudDeviceMarkNotHonouredInCheckoutCopy')
    expect(src).toContain('cloudHookEntrySkipCopy')
    expect(src).toContain('cloudHookEntryDeviceAfterEditCopy')
    expect(src).toContain('cloudHookAfterEditNotForwardedCopy')
    expect(src).toContain('cloudHookEntryUnreadableAtStartupCopy')
    expect(src).toContain('cloudHookEntryInReachCopy')
    expect(src).toContain('INTERPRETER_IT_NAMES')
    expect(src).toContain('INTERPRETER_UNVOUCHED_RELATIVE_OR_ENV')
    expect(src).toContain('INTERPRETER_SANDBOX_WRITE_INLET_COVERS')
    expect(src).toContain('INTERPRETER_MAY_LOAD_FROM_CHECKOUT')
    expect(src).toContain('CLOUD_HOOK_ENTRY_REASON')
    expect(src).toContain('cloudHookOlderCopyNotRunCopy')
    expect(src).toContain('cloudHookMatcherRunsOnCopy')
    expect(src).toContain('cloudHookCannotMoveAfterEditCopy')
    expect(src).not.toMatch(/^export (async )?function ko\b/m)
    expect(src).not.toContain('settings.set(')
    expect(src).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(src).not.toContain('tengu_violin_amati')
    expect(src).not.toContain('new WebSocket')
    expect(src).not.toContain('Far(')
  })

  test('skip / device checkout / after_edit / in_reach 1:1', async () => {
    const skip = await offerCloudHookEntry(
      entry({ hook: { cloud: 'skip', command: 'fmt' } }),
    )
    expect(skip).toEqual({
      kind: 'held',
      reason: CLOUD_HOOK_ENTRY_REASON.author_skip,
      notice: cloudHookEntrySkipCopy('fmt', 'your user settings'),
    })

    const checkoutDevice = await classifyCloudHookEntry(
      entry({
        source: { source: 'local' },
        hook: { cloud: 'device', command: 'fmt' },
      }),
      {
        seams: {
          pin: async () => ({
            kind: 'script_in_reach',
            pinnedTarget: {
              path: '/repo/fmt.sh',
              realPath: '/repo/fmt.sh',
              sha256: 'aa',
            },
            interpreter: 'bash',
          }),
        },
      },
    )
    expect(checkoutDevice.kind).toBe('held')
    expect(checkoutDevice).toMatchObject({
      kind: 'held',
      reason: CLOUD_HOOK_ENTRY_REASON.in_reach,
    })
    if (checkoutDevice.kind === 'held') {
      expect(checkoutDevice.notice).toBe(
        cloudHookEntryInReachCopy(
          'fmt',
          "this checkout's settings.local.json",
          cloudDeviceMarkNotHonouredInCheckoutCopy(),
        ),
      )
    }

    const afterEditDevice = await classifyCloudHookEntry(
      entry({
        event: 'PostToolUse',
        matcher: 'Edit',
        hook: { cloud: 'device', command: 'fmt' },
      }),
      {
        seams: {
          pin: async () => ({
            kind: 'script_outside_reach',
            pinnedTarget: {
              path: '/home/.claude/fmt.sh',
              realPath: '/home/.claude/fmt.sh',
              sha256: 'bb',
            },
            interpreter: 'bash',
          }),
        },
      },
    )
    expect(afterEditDevice).toEqual({
      kind: 'held',
      reason: CLOUD_HOOK_ENTRY_REASON.after_edit,
      notice: cloudHookEntryDeviceAfterEditCopy('fmt', 'your user settings'),
    })

    const afterEditSkip = await classifyCloudHookEntry(
      entry({
        event: 'PostToolUse',
        matcher: 'Write',
        hook: { cloud: 'skip', command: 'fmt' },
      }),
    )
    expect(afterEditSkip).toEqual({
      kind: 'held',
      reason: CLOUD_HOOK_ENTRY_REASON.after_edit,
    })

    const inReach = await classifyCloudHookEntry(entry(), {
      seams: {
        pin: async () => ({
          kind: 'script_in_reach',
          pinnedTarget: {
            path: '/repo/h.sh',
            realPath: '/repo/h.sh',
            sha256: 'cc',
          },
          interpreter: 'bash',
        }),
      },
    })
    expect(inReach).toEqual({
      kind: 'held',
      reason: CLOUD_HOOK_ENTRY_REASON.in_reach,
      notice: cloudHookEntryInReachCopy('fmt', 'your user settings'),
    })
  })

  test('unreadable pin / interpreter unvouched / skipPin 1:1', async () => {
    const unread = await classifyCloudHookEntry(entry(), {
      seams: {
        pin: async () => ({ kind: 'unverifiable', rawPath: '/tmp/h.sh' }),
      },
    })
    expect(unread).toEqual({
      kind: 'held',
      reason: CLOUD_HOOK_ENTRY_REASON.unverifiable_target,
      notice: cloudHookEntryUnreadableAtStartupCopy(
        '/tmp/h.sh',
        'your user settings',
      ),
    })

    const unjudgeable = await classifyCloudHookEntry(
      entry({ hook: { command: '/usr/bin/../tmp/python fmt' } }),
      {
        seams: {
          pin: async () => ({
            kind: 'script_outside_reach',
            pinnedTarget: {
              path: '/home/.claude/fmt.sh',
              realPath: '/home/.claude/fmt.sh',
              sha256: 'dd',
            },
            interpreter: null,
            shebangInterpreter: 'unjudgeable',
          }),
        },
      },
    )
    expect(unjudgeable).toEqual({
      kind: 'held',
      reason: CLOUD_HOOK_ENTRY_REASON.interpreter_unvouched,
      notice: cloudHookEntryInterpreterUnvouchedCopy(
        '/usr/bin/../tmp/python fmt',
        'your user settings',
        INTERPRETER_IT_NAMES,
        INTERPRETER_UNVOUCHED_RELATIVE_OR_ENV,
      ),
    })

    const mayLoad = await classifyCloudHookEntry(entry(), {
      seams: {
        pin: async () => ({
          kind: 'script_outside_reach',
          pinnedTarget: {
            path: '/home/.claude/fmt.sh',
            realPath: '/home/.claude/fmt.sh',
            sha256: 'ee',
          },
          interpreter: null,
          mayLoadFromCheckout: true,
        }),
      },
    })
    expect(mayLoad).toEqual({
      kind: 'held',
      reason: CLOUD_HOOK_ENTRY_REASON.interpreter_unvouched,
      notice: cloudHookEntryInterpreterUnvouchedCopy(
        'fmt',
        'your user settings',
        INTERPRETER_HASHBANG_NAMES,
        INTERPRETER_MAY_LOAD_FROM_CHECKOUT,
      ),
    })

    const inlet = await classifyCloudHookEntry(
      entry({ hook: { command: '/sandbox/bin/python' } }),
      {
        reach: { extraReach: ['/sandbox'] },
        deps: { realpath: async p => p },
        seams: {
          realpath: async p => p,
          pin: async () => ({
            kind: 'script_outside_reach',
            pinnedTarget: {
              path: '/home/.claude/fmt.sh',
              realPath: '/home/.claude/fmt.sh',
              sha256: 'ff',
            },
            interpreter: 'python3',
            site: { form: 'exec', slot: 'arg0' },
          }),
        },
      },
    )
    expect(inlet).toEqual({
      kind: 'held',
      reason: CLOUD_HOOK_ENTRY_REASON.interpreter_unvouched,
      notice: cloudHookEntryInterpreterUnvouchedCopy(
        '/sandbox/bin/python',
        'your user settings',
        '/sandbox/bin/python',
        INTERPRETER_SANDBOX_WRITE_INLET_COVERS,
      ),
    })

    const skipPinAfter = await classifyCloudHookEntry(
      entry({ event: 'PostToolUse', matcher: 'Edit' }),
      {},
      true,
    )
    expect(skipPinAfter).toEqual({
      kind: 'held',
      reason: CLOUD_HOOK_ENTRY_REASON.after_edit,
    })
    const skipPinForward = await classifyCloudHookEntry(entry(), {}, true)
    expect(skipPinForward).toEqual({
      kind: 'forward',
      event: 'PreToolUse',
      hook: { type: 'command', command: 'fmt' },
    })
  })

  test('composeExtraReachForCloudHooks entries additive; bag-only unchanged', async () => {
    const bag = await composeExtraReachForCloudHooks({
      kind: 'forward',
      launchDir: '/l',
      projectDir: '/p',
      configHome: '/c',
      realpath: async p => p,
    })
    expect(bag.pack.held).toEqual([])
    expect(bag.pack.notices).toEqual([])

    const withEntries = await composeExtraReachForCloudHooks({
      kind: 'forward',
      launchDir: '/l',
      projectDir: '/p',
      configHome: '/c',
      realpath: async p => p,
      entries: [entry({ hook: { cloud: 'skip', command: 'fmt' } })],
    })
    expect(withEntries.pack.held).toEqual([
      { reason: CLOUD_HOOK_ENTRY_REASON.author_skip },
    ])
    expect(withEntries.pack.notices).toEqual([
      cloudHookEntrySkipCopy('fmt', 'your user settings'),
    ])
    expect(withEntries.pack.heldCounts.other).toBe(1)
  })

  test('after-edit template refused notice 1:1', async () => {
    const result = await classifyCloudHookEntry(
      entry({
        event: 'PostToolUse',
        matcher: 'Edit',
        hook: { command: 'fmt' },
      }),
      {
        opts: { refusedTemplateIds: ['gh-api-readonly'] },
        seams: {
          pin: async () => ({
            kind: 'script_outside_reach',
            pinnedTarget: {
              path: '/home/.claude/fmt.sh',
              realPath: '/home/.claude/fmt.sh',
              sha256: '11',
            },
            interpreter: 'bash',
          }),
          findTemplateByDigest: () => ({
            template: {
              id: 'gh-api-readonly',
              filename: 'gh.sh',
              event: 'PostToolUse',
              matcher: 'Edit',
            },
            label: 'current',
          }),
        },
      },
    )
    expect(result).toEqual({
      kind: 'held',
      reason: CLOUD_HOOK_ENTRY_REASON.after_edit,
      notice: cloudHookAfterEditNotForwardedCopy('gh.sh'),
    })
  })
})
