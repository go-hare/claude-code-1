import { describe, expect, test } from 'bun:test'
import {
  ACP_ALLOW_ONCE,
  ACP_ALLOW_SKILL_EXACT,
  ACP_ALLOW_SKILL_PREFIX,
  ACP_ALLOW_WITH_UPDATES,
  ACP_EXIT_PLAN_ACCEPT_EDITS,
  ACP_EXIT_PLAN_AUTO,
  ACP_EXIT_PLAN_BYPASS,
  ACP_EXIT_PLAN_DEFAULT,
  ACP_REJECT,
  buildExitPlanPermissionOptions,
  buildStandardPermissionOptions,
  decodeStandardPermissionOption,
  durableUpdatesForAllow,
} from '../permissionOptions.js'

describe('buildStandardPermissionOptions', () => {
  test('Bash without suggestions is Yes / No only', () => {
    expect(
      buildStandardPermissionOptions({
        toolName: 'Bash',
        input: { command: 'ls' },
        allowPersistent: true,
      }).map(option => option.optionId),
    ).toEqual([ACP_ALLOW_ONCE, ACP_REJECT])
  })

  test('Bash with suggestions offers allow-with-updates', () => {
    const options = buildStandardPermissionOptions({
      toolName: 'Bash',
      input: { command: 'npm test' },
      allowPersistent: true,
      suggestions: [
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }],
          behavior: 'allow',
          destination: 'session',
        },
      ],
    })
    expect(options.map(option => option.optionId)).toEqual([
      ACP_ALLOW_ONCE,
      ACP_ALLOW_WITH_UPDATES,
      ACP_REJECT,
    ])
    expect(options[1]?.name).toBe(
      "Yes, and don't ask again for npm test commands",
    )
  })

  test('Write session-scoped Edit grant uses during-this-session label', () => {
    const options = buildStandardPermissionOptions({
      toolName: 'Write',
      input: { file_path: 'src/a.ts' },
      allowPersistent: true,
      cwd: '/proj',
      durableChangeSet: {
        updates: [
          {
            type: 'addRules',
            rules: [{ toolName: 'Edit' }],
            behavior: 'allow',
            destination: 'session',
          },
        ],
      },
    })
    expect(options[1]).toMatchObject({
      optionId: ACP_ALLOW_WITH_UPDATES,
      name: 'Yes, allow all edits during this session',
    })
  })

  test('WebSearch fallback generates a durable whole-tool option', () => {
    const options = buildStandardPermissionOptions({
      toolName: 'WebSearch',
      input: {},
      allowPersistent: true,
    })
    expect(options.map(option => option.name)).toEqual([
      'Yes',
      "Yes, and don't ask again for WebSearch commands",
      'No',
    ])
  })

  test('WebFetch durable uses the URL hostname', () => {
    const options = buildStandardPermissionOptions({
      toolName: 'WebFetch',
      input: { url: 'https://example.com/a' },
      allowPersistent: true,
    })
    expect(options[1]).toMatchObject({
      optionId: ACP_ALLOW_WITH_UPDATES,
      name: "Yes, and don't ask again for example.com",
    })
    expect(
      durableUpdatesForAllow('WebFetch', undefined, {
        url: 'https://example.com/a',
      }),
    ).toEqual([
      {
        type: 'addRules',
        rules: [{ toolName: 'WebFetch', ruleContent: 'domain:example.com' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ])
  })

  test('Skill offers exact and prefix durable ids', () => {
    const options = buildStandardPermissionOptions({
      toolName: 'Skill',
      input: { skill: 'deploy prod' },
      allowPersistent: true,
    })
    expect(options.map(option => option.optionId)).toEqual([
      ACP_ALLOW_ONCE,
      ACP_ALLOW_SKILL_EXACT,
      ACP_ALLOW_SKILL_PREFIX,
      ACP_REJECT,
    ])
    expect(options[1]?.name).toBe("Yes, and don't ask again for deploy prod")
    expect(options[2]?.name).toBe(
      "Yes, and don't ask again for deploy:* commands",
    )
  })

  test('EnterPlanMode is two one-time choices', () => {
    expect(
      buildStandardPermissionOptions({
        toolName: 'EnterPlanMode',
        input: {},
        allowPersistent: true,
      }),
    ).toMatchObject([
      { optionId: ACP_ALLOW_ONCE, name: 'Yes, enter plan mode' },
      { optionId: ACP_REJECT, name: 'No, start implementing now' },
    ])
  })

  test('dishonest Bash suggestion bundles omit allow-with-updates', () => {
    expect(
      buildStandardPermissionOptions({
        toolName: 'Bash',
        input: { command: 'ls' },
        allowPersistent: true,
        suggestions: [
          {
            type: 'addRules',
            rules: [{ toolName: 'Bash' }],
            behavior: 'allow',
            destination: 'session',
          },
        ],
      }).map(option => option.optionId),
    ).toEqual([ACP_ALLOW_ONCE, ACP_REJECT])
  })

  test('legacy aliases are not decoded', () => {
    expect(decodeStandardPermissionOption('allow')).toBeUndefined()
    expect(decodeStandardPermissionOption('allow_always')).toBeUndefined()
  })
})

describe('buildExitPlanPermissionOptions', () => {
  test('offers only the highest-priority elevated choice', () => {
    expect(
      buildExitPlanPermissionOptions([
        'auto',
        'default',
        'acceptEdits',
        'bypassPermissions',
      ]),
    ).toMatchObject([
      {
        optionId: ACP_EXIT_PLAN_DEFAULT,
        name: 'Yes, manually approve edits',
      },
      { optionId: ACP_EXIT_PLAN_AUTO, name: 'Yes, and use auto mode' },
      { optionId: ACP_REJECT, name: 'No, keep planning' },
    ])
  })

  test('falls back through auto > bypass > acceptEdits', () => {
    expect(
      buildExitPlanPermissionOptions(['bypassPermissions', 'acceptEdits']),
    ).toMatchObject([
      { optionId: ACP_EXIT_PLAN_DEFAULT },
      {
        optionId: ACP_EXIT_PLAN_BYPASS,
        name: 'Yes, and bypass permissions',
      },
      { optionId: ACP_REJECT },
    ])
    expect(buildExitPlanPermissionOptions(['acceptEdits'])).toMatchObject([
      { optionId: ACP_EXIT_PLAN_DEFAULT },
      {
        optionId: ACP_EXIT_PLAN_ACCEPT_EDITS,
        name: 'Yes, auto-accept edits',
      },
      { optionId: ACP_REJECT },
    ])
    expect(buildExitPlanPermissionOptions([])).toMatchObject([
      { optionId: ACP_EXIT_PLAN_DEFAULT },
      { optionId: ACP_EXIT_PLAN_ACCEPT_EDITS },
      { optionId: ACP_REJECT },
    ])
    expect(
      buildExitPlanPermissionOptions(['default', 'plan']).map(
        option => option.optionId,
      ),
    ).toEqual([ACP_EXIT_PLAN_DEFAULT, ACP_REJECT])
  })
})
