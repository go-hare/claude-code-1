/**
 * densable 2.1.289 Artifact read-branch rule lookups — `a_` / `Ow` / `qR` /
 * `de` as called from Artifact.checkPermissions list/read actions.
 */
import { describe, expect, test } from 'bun:test'
import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
  type ToolUseContext,
} from '../../../Tool.js'
import type { AppState } from '../../../state/AppState.js'
import type { ToolPermissionRulesBySource } from '../../../types/permissions.js'
import {
  _r,
  a_,
  ARTIFACT_TOOL_NAME,
  artifactAskRuleNote,
  artifactCallReadRule,
  artifactReadRule,
  artifactReadRuleDenial,
  cn,
  de,
  getToolPermissionContext,
  Ow,
  qR,
  WEB_FETCH_TOOL_NAME,
} from '../readPerm/rules.js'

const SLUG = '0123abcd-4567-89ef-0123-456789abcdef'
const PARSED = { slug: SLUG, env: 'prod' as const }
const URL = `https://claude.ai/code/artifact/${SLUG}`

function permCtx(
  rules: {
    deny?: ToolPermissionRulesBySource
    ask?: ToolPermissionRulesBySource
    allow?: ToolPermissionRulesBySource
  } = {},
  extra: Partial<ToolPermissionContext> & Record<string, unknown> = {},
): ToolPermissionContext {
  return {
    ...getEmptyToolPermissionContext(),
    alwaysDenyRules: rules.deny ?? {},
    alwaysAskRules: rules.ask ?? {},
    alwaysAllowRules: rules.allow ?? {},
    ...extra,
  }
}

function toolUse(
  toolPermissionContext: ToolPermissionContext,
  extra: Partial<
    Pick<ToolUseContext, 'permissionLayers' | 'forRemoteExecution'>
  > = {},
): Pick<
  ToolUseContext,
  'getAppState' | 'permissionLayers' | 'forRemoteExecution'
> {
  return {
    getAppState: () => ({ toolPermissionContext }) as unknown as AppState,
    ...extra,
  }
}

describe('read-branch tool names', () => {
  test('_r / cn', () => {
    expect(WEB_FETCH_TOOL_NAME).toBe('WebFetch')
    expect(ARTIFACT_TOOL_NAME).toBe('Artifact')
    expect(_r).toBe(WEB_FETCH_TOOL_NAME)
    expect(cn).toBe(ARTIFACT_TOOL_NAME)
  })

  test('aliases are the descriptive exports', () => {
    expect(a_).toBe(artifactReadRule)
    expect(Ow).toBe(artifactCallReadRule)
    expect(qR).toBe(artifactReadRuleDenial)
    expect(de).toBe(getToolPermissionContext)
  })
})

describe('read branch: a_ deny → qR', () => {
  test('Artifact url deny rule denies with the rule as reason', () => {
    const ctx = permCtx({ deny: { userSettings: [`Artifact(url:${URL})`] } })
    const rule = artifactReadRule(ctx, PARSED, URL, 'deny')
    expect(rule?.ruleValue.toolName).toBe('Artifact')
    expect(artifactReadRuleDenial(rule!)).toEqual({
      behavior: 'deny',
      message: `Reading this artifact is blocked by the Artifact(url:${URL}) deny rule from user settings.`,
      decisionReason: { type: 'rule', rule: rule! },
    })
  })

  test('WebFetch domain deny rule covers artifact reads', () => {
    const ctx = permCtx({
      deny: { projectSettings: ['WebFetch(domain:*.claudeusercontent.com)'] },
    })
    const rule = artifactReadRule(ctx, PARSED, URL, 'deny')
    expect(artifactReadRuleDenial(rule!).message).toBe(
      'Artifact reads are blocked by the WebFetch(domain:*.claudeusercontent.com) deny rule from shared project settings.',
    )
  })
})

describe('read branch: Ow deny with {action}', () => {
  test('action-scoped Artifact deny', () => {
    const ctx = permCtx({
      deny: { localSettings: ['Artifact(action:read_file)'] },
    })
    for (const action of ['read_file', 'list_files', 'read_asset']) {
      const rule = artifactCallReadRule(ctx, PARSED, URL, 'deny', { action })
      expect(rule === null).toBe(action !== 'read_file')
    }
  })

  test('list/read actions route no family tool', () => {
    const ctx = permCtx({ deny: { userSettings: ['ArtifactComments'] } })
    for (const action of [
      'list_assets',
      'read_asset',
      'list_files',
      'read_file',
    ]) {
      expect(
        artifactCallReadRule(ctx, PARSED, URL, 'deny', { action }),
      ).toBeNull()
    }
  })
})

describe('read branch: a_ ask → note', () => {
  test('ask rule bucket and note text', () => {
    const webFetch = artifactReadRule(
      permCtx({ ask: { userSettings: ['WebFetch(domain:claude.ai)'] } }),
      PARSED,
      URL,
      'ask',
    )
    expect(artifactAskRuleNote(webFetch!)).toBe(
      'Your WebFetch ask rule covers artifact reads.',
    )
    const artifact = artifactReadRule(
      permCtx({
        ask: { userSettings: ['Artifact(url:https://claude.ai/code/*)'] },
      }),
      PARSED,
      URL,
      'ask',
    )
    expect(artifactAskRuleNote(artifact!)).toBe(
      'Your Artifact ask rule covers this link.',
    )
    expect(
      artifactReadRule(
        permCtx({ deny: { userSettings: ['WebFetch(domain:claude.ai)'] } }),
        PARSED,
        URL,
        'ask',
      ),
    ).toBeNull()
  })
})

describe('densable de', () => {
  test('no layers, no guard: appState context unchanged', () => {
    const ctx = permCtx({ allow: { userSettings: ['Skill'] } })
    expect(getToolPermissionContext(toolUse(ctx))).toBe(ctx)
  })

  test('permissionLayers apply last-wins', () => {
    const ctx = permCtx()
    const out = getToolPermissionContext(
      toolUse(ctx, {
        permissionLayers: [
          { kind: 'permission_mode', mode: 'plan' },
          { kind: 'allowed_tools', allowedTools: ['Read'] },
          { kind: 'disallowed_tools', disallowedTools: ['Bash'] },
          { kind: 'avoid_prompts' },
        ],
      }),
    )
    expect(out.mode).toBe('plan')
    expect(out.alwaysAllowRules.command).toEqual(['Read'])
    expect(out.alwaysDenyRules.command).toEqual(['Bash'])
    expect(out.shouldAvoidPermissionPrompts).toBe(true)
  })

  test('pollEventDeliveryGuard parks Skill allow rules and skips allowed_tools', () => {
    const ctx = permCtx(
      {
        allow: {
          userSettings: ['Skill', 'Skill(deploy)', 'skill__x', 'Read'],
          session: ['Bash(ls)'],
        },
      },
      {
        pollEventDeliveryGuard: true,
        strippedDangerousRules: { userSettings: ['Skill'] },
      },
    )
    const out = getToolPermissionContext(
      toolUse(ctx, {
        permissionLayers: [
          { kind: 'allowed_tools', allowedTools: ['Skill'] },
          { kind: 'disallowed_tools', disallowedTools: ['Bash'] },
        ],
      }),
    )
    expect(out.alwaysAllowRules).toEqual({
      userSettings: ['Read'],
      session: ['Bash(ls)'],
    })
    expect(out.strippedDangerousRules).toEqual({
      userSettings: ['Skill', 'Skill(deploy)', 'skill__x'],
    })
    expect(out.alwaysDenyRules.command).toEqual(['Bash'])
  })

  test('pollEventDeliveryGuard without Skill rules keeps the context', () => {
    const ctx = permCtx(
      { allow: { userSettings: ['Read'] } },
      { pollEventDeliveryGuard: true },
    )
    expect(getToolPermissionContext(toolUse(ctx))).toBe(ctx)
  })

  test('forRemoteExecution drops outside-read blocking and demotes elevated modes', () => {
    for (const mode of ['acceptEdits', 'bypassPermissions'] as const) {
      const out = getToolPermissionContext(
        toolUse(
          permCtx({}, { mode, blockReadsOutsideWorkingDirectories: true }),
          { forRemoteExecution: true },
        ),
      )
      expect(out.mode).toBe('default')
      expect(out.modeBeforeRewrite).toBe(mode)
      expect('blockReadsOutsideWorkingDirectories' in out).toBe(false)
    }
    const plan = getToolPermissionContext(
      toolUse(permCtx({}, { mode: 'plan' }), { forRemoteExecution: true }),
    )
    expect(plan.mode).toBe('plan')
    expect(plan.modeBeforeRewrite).toBeUndefined()
  })

  test('remote rewrite applies after the layer walk', () => {
    const out = getToolPermissionContext(
      toolUse(permCtx({}, { mode: 'default' }), {
        forRemoteExecution: true,
        permissionLayers: [{ kind: 'permission_mode', mode: 'acceptEdits' }],
      }),
    )
    expect(out.mode).toBe('default')
    expect(out.modeBeforeRewrite).toBe('acceptEdits')
  })
})
