/**
 * densable 2.1.289 Artifact read consent ruling.
 * Gold: md / E7 / Sb / Doe / dD·yNe / vm / ztn / xAr / jtn / NPe / Pbe / Yw,
 * marker keys Wu·qm·OP·TE·eH·$tn.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../../../tests/mocks/settings.js'

const flags: Record<string, unknown> = {}
const events: Array<{ name: string; metadata: unknown }> = []

const realAnalytics = await import('src/services/analytics/index.js')
const analyticsSnap = snapshotModuleExports(realAnalytics)
const realGrowthbook = await import('src/services/analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)
mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: (name: string, metadata: unknown) => {
    events.push({ name, metadata })
  },
}))
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: (name: string, fallback: unknown) =>
    name in flags ? flags[name] : fallback,
}))
afterAll(() => {
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

const consent = await import('../consent.js')
const {
  $A,
  Doe,
  E7,
  Gtn,
  Iat,
  NPe,
  OP,
  Ozr,
  PAr,
  Sb,
  TE,
  Wu,
  Yw,
  dD,
  eH,
  getConsentStateForTests,
  jtn,
  md,
  qBe,
  qm,
  resetConsentStateForTests,
  vm,
  xAr,
  ztn,
} = consent

const SLUG = '0123abcd-0123-4567-89ab-0123456789ab'
const parsed = { slug: SLUG, env: 'prod' as const }
const URL = `https://claude.ai/code/artifact/${SLUG}`

function ctx(opts: {
  toolUseId?: string
  mode?: string
  avoidPrompts?: boolean
  frameUrls?: Record<string, { url: string; title?: string }>
}): any {
  return {
    toolUseId: opts.toolUseId,
    getAppState: () => ({
      toolPermissionContext: {
        mode: opts.mode ?? 'default',
        isBypassPermissionsModeAvailable: false,
        ...(opts.avoidPrompts && { shouldAvoidPermissionPrompts: true }),
      },
      ...(opts.frameUrls && { frameUrls: opts.frameUrls }),
    }),
  }
}

const ENV_KEYS = [
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_COWORK_FRAME_ARTIFACTS',
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
]
const savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

beforeEach(() => {
  resetConsentStateForTests()
  events.length = 0
  for (const k of Object.keys(flags)) delete flags[k]
  for (const k of ENV_KEYS) delete process.env[k]
})

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('marker keys', () => {
  test('gold string values', () => {
    expect(Wu).toBe('__artifactConsentAskCanReachUser')
    expect(qm).toBe('__artifactPlanConsentAsk')
    expect(OP).toBe('__artifactUserOnlyConsentAsk')
    expect(TE).toBe('__artifactDisplayTarget')
    expect(eH).toBe('__artifactAssetTargetPin')
    expect(consent.Rat).toBe('__artifactDeleteTarget')
    expect(consent.gNe).toBe('__artifactAssetUploadPin')
    expect(consent.v).toBe('__artifactConsentPin')
    expect(consent.$tn).toBe('__artifactAsk')
  })
})

describe('Izr / Jrs / mp / c1n', () => {
  test('Izr: private writes do not ask; public and unknown do', () => {
    expect(consent.Izr({ public: false })).toEqual({
      ask: false,
      foreignRead: false,
    })
    expect(consent.Izr({ public: true })).toEqual({
      ask: true,
      class: 'public_change',
      answeredBy: 'classifier',
      remember: 'this_call',
      basis: 'known',
    })
    expect(consent.Izr({})).toEqual({
      ask: true,
      class: 'public_change',
      answeredBy: 'classifier',
      remember: 'this_call',
      basis: 'facts_missing',
      missing: 'public',
    })
  })

  test('Jrs maps share modes', () => {
    expect(consent.Jrs(undefined)).toBe('private to the user')
    expect(consent.Jrs({ mode: 'owner' })).toBe('private to the user')
    expect(consent.Jrs({ mode: 'unknown' })).toBe(
      'shared, audience unrecognized',
    )
    expect(consent.Jrs({ mode: 'org' })).toBe('shared with your organization')
    expect(consent.Jrs({ mode: 'public' })).toBe(
      'shared with anyone with the link',
    )
  })

  test('mp prefers sessionMinted and ignores opened/attached', () => {
    const frames = {
      'opened:x': { url: URL, title: 'opened' },
      'attached:x': { url: URL, title: 'attached' },
      a: { url: URL, title: 'first' },
      b: { url: URL, title: 'minted', sessionMinted: true },
    }
    expect(consent.mp(frames, SLUG)?.title).toBe('minted')
    expect(consent.mp({ 'opened:x': { url: URL } }, SLUG)).toBeUndefined()
  })

  test('c1n defaults off', () => {
    expect(consent.c1n()).toBe(false)
    flags.tengu_ochre_plover = true
    expect(consent.c1n()).toBe(true)
  })
})

describe('md', () => {
  test('latches the GrowthBook gate once and logs it', () => {
    flags.tengu_cobalt_plinth_bryony = true
    expect(md()).toBe(true)
    flags.tengu_cobalt_plinth_bryony = false
    expect(md()).toBe(true)
    expect(events).toEqual([
      { name: 'tengu_artifact_five_class_asks', metadata: { on: true } },
    ])
  })

  test('defaults off', () => {
    expect(md()).toBe(false)
  })
})

describe('Sb / E7', () => {
  const human = { networkOff: false, turnStartedByHuman: true }

  test('own artifact reads never ask', () => {
    expect(Sb({ operation: 'read', owned: true })).toEqual({
      ask: false,
      foreignRead: false,
    })
  })

  test('outside-org read asks the person, remembered per artifact on a human turn', () => {
    expect(
      Sb({ operation: 'read', outsideOrg: true, turnStartedByHuman: true }),
    ).toEqual({
      ask: true,
      class: 'foreign_read',
      answeredBy: 'person',
      remember: 'artifact',
      basis: 'known',
      about: 'outside_org',
    })
  })

  test('missing ownership asks the classifier for this call', () => {
    expect(Sb({ operation: 'read', networkOff: false })).toEqual({
      ask: true,
      class: 'foreign_read',
      answeredBy: 'classifier',
      remember: 'this_call',
      basis: 'facts_missing',
      missing: 'owned',
    })
  })

  test('someone else\u2019s read with network on is an unasked foreign read', () => {
    expect(Sb({ operation: 'read', owned: false, networkOff: false })).toEqual({
      ask: false,
      foreignRead: true,
    })
  })

  test('E7 uses probe facts only when the probe was this call', () => {
    const status = { role: 'reader', mode: 'org', lastProbeToolUseId: 't1' }
    expect(
      E7(parsed, { toolUseId: 't1' }, { ...human, status, attested: false }),
    ).toEqual({
      ask: false,
      foreignRead: true,
    })
    expect(
      E7(parsed, { toolUseId: 't2' }, { ...human, status, attested: false }),
    ).toMatchObject({
      ask: true,
      missing: 'owned',
    })
  })

  test('E7 attested read short-circuits', () => {
    expect(
      E7(parsed, {}, { ...human, status: undefined, attested: true }),
    ).toEqual({
      ask: false,
      foreignRead: true,
      attested: true,
    })
  })

  test('$A / Iat carry canWrite for owner and writer', () => {
    expect(Iat({ role: 'writer', mode: 'public' })).toEqual({
      owned: false,
      public: true,
      outsideOrg: false,
      invitedByOtherOrg: false,
      canWrite: true,
    })
    const facts = $A(
      'write',
      parsed,
      { toolUseId: 'p' },
      { role: 'owner', lastProbeToolUseId: 'p' },
      human,
    )
    expect(facts).toMatchObject({
      operation: 'write',
      artifactId: SLUG,
      owned: true,
      canWrite: true,
    })
  })

  test('outsideOrg is unknown (not false) while Yw is on', () => {
    flags.tengu_cobalt_plinth_sedge = true
    expect(Yw()).toBe(true)
    expect(Iat(undefined).outsideOrg).toBeUndefined()
    expect(Iat({ probeFailed: true, outsideOrgReader: true }).outsideOrg).toBe(
      true,
    )
  })
})

describe('Doe', () => {
  const ruling = {
    ask: true as const,
    class: 'foreign_read' as const,
    answeredBy: 'classifier' as const,
    remember: 'artifact' as const,
    basis: 'known' as const,
  }

  test('classifier yes stands; person-only needs a person yes', () => {
    expect(Doe(ruling, SLUG)).toBe(false)
    Ozr('foreign_read', SLUG)
    expect(Doe(ruling, SLUG)).toBe(true)
    expect(Doe(ruling, SLUG, true)).toBe(false)
    Ozr('foreign_read', SLUG, true)
    expect(Doe(ruling, SLUG, true)).toBe(true)
  })

  test('endpoint rulings key separately', () => {
    Ozr('foreign_read', SLUG)
    expect(Doe({ ...ruling, endpoint: true }, SLUG)).toBe(false)
  })
})

describe('ztn / xAr', () => {
  test('provenance sentences', () => {
    expect(ztn('someone_else', 'Plan')).toBe(
      '"Plan" was made by someone else. Let Claude read it?',
    )
    expect(ztn('unknown', undefined)).toBe(
      "Claude couldn't check who made this artifact. Let Claude read it?",
    )
    expect(ztn('cowritten', 'Plan', 'save a file to "out"')).toBe(
      'Other people can edit "Plan". Let Claude read it and save a file to "out"?',
    )
    expect(ztn('from_type', undefined)).toBe(
      "This artifact was made from someone else's artifact type. Let Claude read it?",
    )
  })

  test('card titles are sanitized and truncated', () => {
    expect(ztn('someone_else', 'a "b"\u0007 c')).toBe(
      '"a \'b\' c" was made by someone else. Let Claude read it?',
    )
    expect(ztn('someone_else', 'see https://x.test')).toBe(
      '"see https:\u2215\u2215x.test" was made by someone else. Let Claude read it?',
    )
    const long = ztn('someone_else', 'x'.repeat(100))
    expect(long.startsWith(`"${'x'.repeat(80)}\u2026"`)).toBe(true)
  })

  test('coverage sentence', () => {
    expect(xAr(false)).toBe(
      'Approving covers its files for the rest of the conversation.',
    )
    expect(xAr(true)).toBe(
      'Approving covers its files, and copying them into other artifacts, for the rest of the conversation.',
    )
  })
})

describe('vm', () => {
  test('share title wins; frame title is the fallback', () => {
    expect(vm(parsed, ctx({}), 'Shared')).toEqual({ url: URL, title: 'Shared' })
    const frames = {
      [`opened:${SLUG}`]: { url: URL, title: 'Opened' },
      a: { url: URL, title: 'Framed' },
    }
    expect(vm(parsed, ctx({ frameUrls: frames }))).toEqual({
      url: URL,
      title: 'Framed',
    })
    expect(vm(parsed, ctx({}))).toEqual({ url: URL })
  })
})

describe('jtn', () => {
  test('jtn needs a must-deny surface and a user-only read (outside Cowork)', () => {
    expect(jtn(ctx({ mode: 'bypassPermissions' }), true)).toBe(true)
    expect(jtn(ctx({ mode: 'bypassPermissions' }), false)).toBe(false)
    expect(jtn(ctx({}), true)).toBe(false)
    expect(jtn(ctx({ avoidPrompts: true }), true)).toBe(true)
  })

  test('jtn: Cowork frame sessions have no answerer for any foreign read', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'local-agent'
    process.env.CLAUDE_CODE_COWORK_FRAME_ARTIFACTS = '1'
    expect(jtn(ctx({ avoidPrompts: true }), false)).toBe(true)
  })
})

describe('NPe', () => {
  test('keeps only slugs named by every reachable ask on the call', () => {
    const c = { toolUseId: 't' }
    NPe(c, ['a', 'b'], true)
    expect(qBe(c, 'a')).toBe(true)
    NPe(c, ['b', 'c'], true)
    expect(getConsentStateForTests().askNamedOtherOrg.get('t')).toEqual(['b'])
    NPe(c, ['b'], false)
    expect(qBe(c, 'b')).toBe(false)
  })
})

describe('dD', () => {
  const display = { url: URL, title: 'Plan' }
  const foreign = {
    ask: true as const,
    class: 'foreign_read' as const,
    answeredBy: 'classifier' as const,
    remember: 'artifact' as const,
    basis: 'known' as const,
  }

  test('no ask allows and clears the reach marker; unasked foreign read is logged', () => {
    const result = dD({
      ruling: { ask: false, foreignRead: true, attested: true },
      input: { action: 'read_file' },
      context: ctx({ toolUseId: 't' }),
      slug: SLUG,
      display,
      action: 'read_file',
    })
    expect(result as unknown).toEqual({
      behavior: 'allow',
      updatedInput: { action: 'read_file', [Wu]: false },
    })
    expect(events).toEqual([
      {
        name: 'tengu_artifact_foreign_read_unasked',
        metadata: { action: 'read_file', artifact_id: SLUG, attested: true },
      },
    ])
  })

  test('remembered ask with a held yes allows', () => {
    Ozr('foreign_read', SLUG)
    const result = dD({
      ruling: foreign,
      input: {},
      context: ctx({ toolUseId: 't' }),
      slug: SLUG,
      display,
      action: 'read_file',
    })
    expect(result.behavior).toBe('allow')
  })

  test('ask carries the remembered question and pending target', () => {
    const result = dD({
      ruling: foreign,
      input: { action: 'read_file' },
      context: ctx({ toolUseId: 't' }),
      slug: SLUG,
      display,
      action: 'read_file',
    })
    const message =
      '"Plan" was made by someone else. Let Claude read it for the rest of this conversation?'
    expect(result as unknown).toEqual({
      behavior: 'ask',
      message,
      updatedInput: {
        action: 'read_file',
        [Wu]: false,
        __artifactAsk: {
          class: 'foreign_read',
          remember: 'artifact',
          slug: SLUG,
          url: URL,
          title: 'Plan',
          reachable: true,
          askedIn: '0:0',
        },
      },
      suppressAlwaysAllowRule: true,
      localDisplayOnly: true,
      decisionReason: {
        type: 'safetyCheck',
        reason: message,
        classifierApprovable: true,
      },
    })
    const s = getConsentStateForTests()
    expect(s.askClassPending.get('t')).toHaveLength(1)
    expect(s.askClassNoClassifier.get('t')).toBe(true)
    expect(s.askClassPersonAsked.has('t')).toBe(false)
    expect(s.askClassCards.get('t')?.parts).toEqual([message, URL])
  })

  test('person-only ask with no reachable person denies', () => {
    const result = dD({
      ruling: { ...foreign, answeredBy: 'person', about: 'outside_org' },
      input: {},
      context: ctx({ toolUseId: 't', avoidPrompts: true }),
      slug: SLUG,
      display: { url: URL },
      action: 'read_file',
    })
    expect(result).toEqual({
      behavior: 'deny',
      message:
        'Nothing was done. This needs a yes to: This artifact was made by someone else. Let Claude read it for the rest of this conversation? No one can answer in this session.',
      decisionReason: {
        type: 'safetyCheck',
        reason: 'Artifact foreign_read ask has no one to answer it',
        classifierApprovable: false,
      },
    })
  })

  test('delete and access_change default to no; access_change is person-only', () => {
    const result = dD({
      ruling: {
        ask: true,
        class: 'access_change',
        answeredBy: 'person',
        remember: 'this_call',
        basis: 'known',
      },
      input: {},
      context: ctx({ toolUseId: 't' }),
      slug: SLUG,
      display,
      action: 'share',
    })
    expect(result).toMatchObject({
      behavior: 'ask',
      message: 'Allow Claude to change who can open or comment on "Plan"?',
      defaultToNo: true,
      personOnly: true,
      decisionReason: { classifierApprovable: false },
    })
    expect(getConsentStateForTests().askClassPersonAsked.get('t')).toBe(true)
  })

  test('outside-org note joins the card, and the slug is named for the call', () => {
    dD({
      ruling: { ...foreign, answeredBy: 'person', about: 'outside_org' },
      input: {},
      context: ctx({ toolUseId: 't' }),
      slug: SLUG,
      display,
      action: 'read_file',
    })
    expect(getConsentStateForTests().askClassCards.get('t')?.parts).toEqual([
      '"Plan" was made by someone else. Let Claude read it for the rest of this conversation?',
      Gtn,
      URL,
    ])
    expect(qBe({ toolUseId: 't' }, SLUG)).toBe(true)
  })

  test('remote cowork sessions remember for the task', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'remote_cowork'
    const result = dD({
      ruling: foreign,
      input: {},
      context: ctx({}),
      slug: SLUG,
      display,
      action: 'read_file',
    })
    expect(result.behavior === 'ask' && result.message).toBe(
      '"Plan" was made by someone else. Let Claude read it for the rest of this task?',
    )
  })
})

describe('PAr', () => {
  const display = { url: URL, title: 'Plan' }
  const foreign = {
    ask: true as const,
    class: 'foreign_read' as const,
    answeredBy: 'classifier' as const,
    remember: 'artifact' as const,
    basis: 'known' as const,
  }

  function approved(toolUseId: string, source: string, extra = {}) {
    return {
      ...ctx({ toolUseId, ...extra }),
      toolDecisions: new Map([
        [toolUseId, { source, decision: 'accept', timestamp: 0 }],
      ]),
    }
  }

  function askOnce(toolUseId: string, ruling = foreign) {
    return dD({
      ruling,
      input: {},
      context: ctx({ toolUseId }),
      slug: SLUG,
      display,
      action: 'read_file',
    })
  }

  test('a user yes to a remembered ask stops the next call asking', () => {
    expect(askOnce('t1').behavior).toBe('ask')
    PAr(approved('t1', 'user_temporary'))
    const s = getConsentStateForTests()
    expect(s.askClassPending.has('t1')).toBe(false)
    expect(s.askClassTaken.get('t1')).toHaveLength(1)
    expect(s.askClassTakenByPerson.get('t1')).toBe(true)
    expect(Doe(foreign, SLUG)).toBe(true)
    expect(Doe({ ...foreign, answeredBy: 'person' }, SLUG)).toBe(true)
    expect(askOnce('t2').behavior).toBe('allow')
  })

  test('a classifier yes remembers without person consent', () => {
    askOnce('t1')
    PAr(approved('t1', 'classifier', { mode: 'auto' }))
    expect(Doe(foreign, SLUG)).toBe(true)
    expect(Doe({ ...foreign, answeredBy: 'person' }, SLUG)).toBe(false)
    expect(getConsentStateForTests().askClassTakenByPerson.has('t1')).toBe(
      false,
    )
  })

  test('this_call asks are taken but not remembered', () => {
    askOnce('t1', { ...foreign, remember: 'this_call' as never })
    PAr(approved('t1', 'user_temporary'))
    expect(getConsentStateForTests().askClassTaken.get('t1')).toHaveLength(1)
    expect(Doe(foreign, SLUG)).toBe(false)
  })

  test('an ask from before an account switch is dropped', async () => {
    const { un } = await import('../../store.js')
    askOnce('t1')
    un().accountEpoch += 1
    try {
      PAr(approved('t1', 'user_temporary'))
      expect(getConsentStateForTests().askClassTaken.has('t1')).toBe(false)
      expect(Doe(foreign, SLUG)).toBe(false)
    } finally {
      un().accountEpoch -= 1
    }
  })

  test('an outside-org slug named by the ask lands outside-org consent', () => {
    dD({
      ruling: { ...foreign, answeredBy: 'person', about: 'outside_org' },
      input: {},
      context: ctx({ toolUseId: 't1' }),
      slug: SLUG,
      display,
      action: 'read_file',
    })
    PAr(approved('t1', 'user_permanent'))
    expect(Doe({ ...foreign, informedOnly: true }, SLUG)).toBe(true)
  })
})
