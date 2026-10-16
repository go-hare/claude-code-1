/**
 * densable 2.1.289 Artifact permission-rule matching — `a_` / `Ow` / `qR`.
 */
import { describe, expect, test } from 'bun:test'
import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
} from '../../../../Tool.js'
import type {
  PermissionRule,
  ToolPermissionRulesBySource,
} from '../../../../types/permissions.js'
import {
  _r,
  a_,
  artifactAskRuleNote,
  artifactReadDeniedMessage,
  Bte,
  cn,
  mNe,
  Ow,
  qR,
} from '../rules.js'

const SLUG = '0123abcd-4567-89ef-0123-456789abcdef'
const REF = { slug: SLUG, env: 'prod' as const }
const URL = `https://claude.ai/code/artifact/${SLUG}`

function base58(slug: string): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let n = BigInt(`0x${slug.replaceAll('-', '')}`)
  let out = ''
  for (let i = 0; i < 22; i++) {
    out = alphabet[Number(n % 58n)] + out
    n /= 58n
  }
  return out
}

function ctx(rules: {
  deny?: ToolPermissionRulesBySource
  ask?: ToolPermissionRulesBySource
  allow?: ToolPermissionRulesBySource
}): ToolPermissionContext {
  return {
    ...getEmptyToolPermissionContext(),
    alwaysDenyRules: rules.deny ?? {},
    alwaysAskRules: rules.ask ?? {},
    alwaysAllowRules: rules.allow ?? {},
  }
}

function denyUser(...rules: string[]): ToolPermissionContext {
  return ctx({ deny: { userSettings: rules } })
}

function ruleString(rule: PermissionRule | null): string | null {
  if (rule === null) return null
  const { toolName, ruleContent } = rule.ruleValue
  return ruleContent === undefined ? toolName : `${toolName}(${ruleContent})`
}

describe('densable cn / _r', () => {
  test('tool name constants', () => {
    expect(cn).toBe('Artifact')
    expect(_r).toBe('WebFetch')
  })
})

describe('densable a_', () => {
  test('returns null without matching rules', () => {
    expect(a_(ctx({}), REF, URL, 'deny')).toBeNull()
    expect(a_(denyUser('Artifact', 'Bash(ls)'), REF, URL, 'deny')).toBeNull()
  })

  test('Artifact url: rule matches viewer url, glob and artifact parse', () => {
    for (const content of [
      `url:${URL}`,
      'url:https://claude.ai/code/artifact/*',
      `url:https://team.claude.ai/code/artifact/my-page-${SLUG}*`,
      `url:https://claude.ai/artifact/${base58(SLUG)}`,
      `url:https://${SLUG}.frame.claudeusercontent.com/*`,
      `url:HTTP://Claude.AI:443/code/artifact/${SLUG}`,
    ]) {
      const rule = a_(denyUser(`Artifact(${content})`), REF, URL, 'deny')
      expect(ruleString(rule)).toBe(`Artifact(${content})`)
    }
  })

  test('short-id viewer form is a candidate even when not passed', () => {
    const rule = a_(
      denyUser('Artifact(url:https://claude.ai/artifact/*)'),
      REF,
      undefined,
      'deny',
    )
    expect(rule).not.toBeNull()
  })

  test('other artifacts, staging env and non-url fields do not match', () => {
    const other = 'ffffffff-4567-89ef-0123-456789abcdef'
    expect(
      a_(
        denyUser(`Artifact(url:https://claude.ai/code/artifact/${other})`),
        REF,
        URL,
        'deny',
      ),
    ).toBeNull()
    expect(
      a_(
        denyUser(`Artifact(url:https://${SLUG}.frame.claudeusercontent.com)`),
        { slug: SLUG, env: 'staging' },
        undefined,
        'deny',
      ),
    ).toBeNull()
    expect(a_(denyUser(`Artifact(prompt:${URL})`), REF, URL, 'deny')).toBeNull()
  })

  test('behavior selects the rule bucket', () => {
    const c = ctx({ ask: { localSettings: [`Artifact(url:${URL})`] } })
    expect(a_(c, REF, URL, 'deny')).toBeNull()
    expect(a_(c, REF, URL, 'ask')?.source).toBe('localSettings')
  })

  test('WebFetch domain rules cover the viewer and frame hosts', () => {
    for (const content of [
      'domain:claude.ai',
      'domain:Claude.AI.',
      'domain:*.claudeusercontent.com',
      'domain:*',
    ]) {
      const rule = a_(denyUser(`WebFetch(${content})`), REF, URL, 'deny')
      expect(ruleString(rule)).toBe(`WebFetch(${content})`)
    }
    expect(
      a_(denyUser('WebFetch(domain:example.com)'), REF, URL, 'deny'),
    ).toBeNull()
  })

  test('passed url host is checked against WebFetch domain rules', () => {
    const rule = a_(
      denyUser('WebFetch(domain:team.claude.ai)'),
      REF,
      `https://team.claude.ai/code/artifact/${SLUG}`,
      'deny',
    )
    expect(ruleString(rule)).toBe('WebFetch(domain:team.claude.ai)')
  })

  test('WebFetch field rules apply only with read opts', () => {
    const c = denyUser('WebFetch(prompt:*secret*)')
    expect(a_(c, REF, URL, 'deny')).toBeNull()
    expect(
      a_(c, REF, URL, 'deny', { read: { prompt: 'tell me the secret' } }),
    ).not.toBeNull()
    expect(a_(c, REF, URL, 'deny', { read: { prompt: 'summary' } })).toBeNull()
  })

  test('WebFetch match wins over an Artifact match', () => {
    const rule = a_(
      denyUser(`Artifact(url:${URL})`, 'WebFetch(domain:claude.ai)'),
      REF,
      URL,
      'deny',
    )
    expect(rule?.ruleValue.toolName).toBe(_r)
  })

  test('family tool rules apply for the matching action', () => {
    const c = denyUser(`ArtifactComments(url:${URL})`)
    expect(a_(c, REF, URL, 'deny')).toBeNull()
    expect(a_(c, REF, URL, 'deny', { action: 'read' })).toBeNull()
    for (const action of ['comments', 'reply', 'watch', 'resume_replies']) {
      expect(a_(c, REF, URL, 'deny', { action })?.ruleValue.toolName).toBe(
        'ArtifactComments',
      )
    }
    expect(
      a_(denyUser(`ArtifactData(url:${URL})`), REF, URL, 'deny', {
        action: 'write_db',
      }),
    ).not.toBeNull()
    expect(
      a_(denyUser(`ArtifactCheck(url:${URL})`), REF, URL, 'deny', {
        action: 'verify',
      }),
    ).not.toBeNull()
  })

  test('from_url: rules match only for copy sources', () => {
    const c = denyUser(`Artifact(from_url:${URL})`)
    expect(a_(c, REF, URL, 'deny')).toBeNull()
    expect(a_(c, REF, URL, 'deny', { copySource: true })).not.toBeNull()
  })
})

describe('densable Ow', () => {
  test('whole-tool Artifact deny rule', () => {
    const rule = Ow(denyUser('Artifact'), REF, URL, 'deny', {
      action: 'read_file',
    })
    expect(ruleString(rule)).toBe('Artifact')
  })

  test('whole-tool glob names match', () => {
    const rule = Ow(denyUser('Artifact*'), REF, URL, 'deny', {
      action: 'comments',
    })
    expect(ruleString(rule)).toBe('Artifact*')
  })

  test('toolsNarrowing / command whole-tool denies are ignored', () => {
    for (const source of ['toolsNarrowing', 'command'] as const) {
      const c = ctx({ deny: { [source]: ['Artifact'] } })
      expect(Ow(c, REF, URL, 'deny', { action: 'read_file' })).toBeNull()
    }
  })

  test('action: rules match the requested action', () => {
    const c = denyUser('Artifact(action:read_*)')
    expect(ruleString(Ow(c, REF, URL, 'deny', { action: 'read_file' }))).toBe(
      'Artifact(action:read_*)',
    )
    expect(Ow(c, REF, URL, 'deny', { action: 'list_files' })).toBeNull()
  })

  test('action: rules from narrowing sources are ignored', () => {
    const c = ctx({ deny: { toolsNarrowing: ['Artifact(action:read_file)'] } })
    expect(Ow(c, REF, URL, 'deny', { action: 'read_file' })).toBeNull()
  })

  test('non-action field rules keep narrowing sources', () => {
    const c = ctx({ deny: { toolsNarrowing: ['Artifact(path:*.env)'] } })
    expect(
      Ow(c, REF, URL, 'deny', {
        action: 'read_file',
        fields: { path: 'config/.env' },
      }),
    ).not.toBeNull()
  })

  test('url field is the artifact viewer url', () => {
    const rule = Ow(
      denyUser('Artifact(url:https://claude.ai/code/artifact/*)'),
      REF,
      `https://team.claude.ai/code/artifact/x-${SLUG}`,
      'deny',
      { action: 'list_files' },
    )
    expect(rule).not.toBeNull()
  })

  test('file_path rule contents are not field-matched', () => {
    const c = denyUser('Artifact(file_path:*)')
    expect(
      Ow(c, REF, URL, 'deny', {
        action: 'publish',
        fields: { file_path: '/tmp/a.html' },
      }),
    ).toBeNull()
  })

  test('read opts build the read input', () => {
    const c = denyUser('Artifact(prompt:*secret*)')
    expect(
      Ow(c, REF, URL, 'deny', { read: { prompt: 'the secret part' } }),
    ).not.toBeNull()
    expect(
      Ow(denyUser('Artifact(action:read)'), REF, URL, 'deny', { read: {} }),
    ).not.toBeNull()
  })

  test('family tool whole-tool and field rules', () => {
    expect(
      ruleString(
        Ow(denyUser('ArtifactComments'), REF, URL, 'deny', {
          action: 'reply',
        }),
      ),
    ).toBe('ArtifactComments')
    expect(
      ruleString(
        Ow(denyUser('ArtifactComments(action:watch)'), REF, URL, 'deny', {
          action: 'unwatch',
        }),
      ),
    ).toBe('ArtifactComments(action:watch)')
    expect(
      ruleString(
        Ow(denyUser('ArtifactData(action:delete)'), REF, URL, 'deny', {
          action: 'write_db',
          fields: { db_op: 'delete' },
        }),
      ),
    ).toBe('ArtifactData(action:delete)')
  })

  test('wholeToolAskAnswered skips only the whole-tool Artifact ask', () => {
    const c = ctx({ ask: { userSettings: ['Artifact'] } })
    expect(Ow(c, REF, URL, 'ask', { action: 'read_file' })).not.toBeNull()
    expect(
      Ow(c, REF, URL, 'ask', {
        action: 'read_file',
        wholeToolAskAnswered: true,
      }),
    ).toBeNull()
    const family = ctx({ ask: { userSettings: ['ArtifactComments'] } })
    expect(
      Ow(family, REF, URL, 'ask', {
        action: 'comments',
        wholeToolAskAnswered: true,
      }),
    ).not.toBeNull()
  })

  test('falls through to a_', () => {
    const rule = Ow(denyUser('WebFetch(domain:claude.ai)'), REF, URL, 'deny', {
      action: 'read_file',
    })
    expect(ruleString(rule)).toBe('WebFetch(domain:claude.ai)')
  })
})

describe('densable qR / mNe', () => {
  const artifactRule: PermissionRule = {
    source: 'userSettings',
    ruleBehavior: 'deny',
    ruleValue: { toolName: 'Artifact', ruleContent: `url:${URL}` },
  }
  const webFetchRule: PermissionRule = {
    source: 'policySettings',
    ruleBehavior: 'deny',
    ruleValue: { toolName: 'WebFetch', ruleContent: 'domain:claude.ai' },
  }

  test('qR deny result carries the rule', () => {
    expect(qR(artifactRule)).toEqual({
      behavior: 'deny',
      message: `Reading this artifact is blocked by the Artifact(url:${URL}) deny rule from user settings.`,
      decisionReason: { type: 'rule', rule: artifactRule },
    })
  })

  test('WebFetch rule subject and source label', () => {
    expect(qR(webFetchRule).message).toBe(
      'Artifact reads are blocked by the WebFetch(domain:claude.ai) deny rule from enterprise managed settings.',
    )
  })

  test('detail suffix and copy source subject', () => {
    expect(
      artifactReadDeniedMessage(artifactRule, 'nothing was copied', true),
    ).toBe(
      `Copying from this artifact is blocked by the Artifact(url:${URL}) deny rule from user settings \u2014 nothing was copied`,
    )
  })

  test('mNe escapes rule content and labels sources', () => {
    expect(
      mNe({
        source: 'toolsNarrowing',
        ruleBehavior: 'deny',
        ruleValue: { toolName: 'Artifact', ruleContent: 'prompt:a(b)' },
      }),
    ).toBe('the Artifact(prompt:a\\(b\\)) deny rule from CLI tool narrowing')
    expect(
      mNe({
        source: 'session',
        ruleBehavior: 'deny',
        ruleValue: { toolName: 'Artifact' },
      }),
    ).toBe('the Artifact deny rule from current session')
  })

  test('ask-rule notes', () => {
    expect(artifactAskRuleNote(webFetchRule)).toBe(
      'Your WebFetch ask rule covers artifact reads.',
    )
    expect(artifactAskRuleNote(artifactRule)).toBe(
      'Your Artifact ask rule covers this link.',
    )
    expect(Bte(webFetchRule)).toBe(
      ' (your WebFetch ask rule covers artifact reads)',
    )
    expect(
      Bte({
        ...artifactRule,
        ruleValue: { toolName: 'ArtifactData', ruleContent: 'url:x' },
      }),
    ).toBe(' (your ArtifactData ask rule covers this url)')
  })
})
