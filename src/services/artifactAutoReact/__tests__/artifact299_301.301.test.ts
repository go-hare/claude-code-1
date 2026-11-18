import { describe, expect, test } from 'bun:test'
import { formatDeployHttpError } from '../edit.js'
import { MAX_RECENT_ARTIFACTS, MAX_WATCHED_ARTIFACTS } from '../store.js'
import {
  hasEditOrWritePreToolUseHook,
  shouldOfferPublishEdits,
} from '../../../../packages/builtin-tools/src/tools/ArtifactTool/quickstartRules.js'

describe('#609, #712, #854 ArtifactTool & artifactAutoReact', () => {
  test('#609 formatDeployHttpError distinguishes 403 refusals and advises not to retry', () => {
    const generic403 = formatDeployHttpError(403, null)
    expect(generic403).toContain('HTTP 403')
    expect(generic403).toContain('Do not retry')

    const notOwner403 = formatDeployHttpError(403, { reason: 'not_owner' })
    expect(notOwner403).toContain('not allowed to publish to it')

    const denied403 = formatDeployHttpError(403, {
      reason: 'org_toggle_disabled',
      error: 'Connectors are disabled by org policy',
    })
    expect(denied403).toBe(
      'publish denied: Connectors are disabled by org policy',
    )

    expect(formatDeployHttpError(500, null)).toBe('deploy HTTP 500')
  })

  test('#712 MAX_WATCHED_ARTIFACTS is 25', () => {
    expect(MAX_WATCHED_ARTIFACTS).toBe(25)
    expect(MAX_RECENT_ARTIFACTS).toBe(75)
  })

  test('#854 hasEditOrWritePreToolUseHook blocks publish edits when Edit/Write PreToolUse hook is registered', () => {
    const ctxWithEditHook = {
      agentId: 'a1',
      getAppState: () => ({
        sessionHooks: new Map([
          ['a1', { hooks: { PreToolUse: [{ matcher: 'Edit|Write' }] } }],
        ]),
      }),
    }
    expect(hasEditOrWritePreToolUseHook(ctxWithEditHook)).toBe(true)
    expect(shouldOfferPublishEdits(ctxWithEditHook)).toBe(false)

    const ctxWithBashHook = {
      agentId: 'a2',
      getAppState: () => ({
        sessionHooks: new Map([
          ['a2', { hooks: { PreToolUse: [{ matcher: 'Bash' }] } }],
        ]),
      }),
    }
    expect(hasEditOrWritePreToolUseHook(ctxWithBashHook)).toBe(false)
    expect(shouldOfferPublishEdits(ctxWithBashHook)).toBe(true)
  })
})
