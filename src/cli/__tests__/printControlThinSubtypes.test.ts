/**
 * densable print control thin subtypes residual (#78 + #79 + #80 + #81):
 * get_binary_version, list_models, get_session_cost, get_usage, get_plan,
 * file_suggestions, interrupt still_queued.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SDKControlFileSuggestionsRequestSchema,
  SDKControlGetBinaryVersionRequestSchema,
  SDKControlGetPlanRequestSchema,
  SDKControlGetSessionCostRequestSchema,
  SDKControlGetSettingsRequestSchema,
  SDKControlGetSettingsResponseSchema,
  SDKControlGetUsageRequestSchema,
  SDKControlInitializeRequestSchema,
  SDKControlInterruptRequestSchema,
  SDKControlInterruptResponseSchema,
  SDKControlListModelsRequestSchema,
  SDKControlBackgroundTasksRequestSchema,
  SDKControlBackgroundTasksResponseSchema,
  SDKControlMessageRatedRequestSchema,
  SDKControlReloadSkillsRequestSchema,
  SDKControlReloadSkillsResponseSchema,
  SDKControlRenameSessionRequestSchema,
  SDKControlRequestInnerSchema,
} from '../../entrypoints/sdk/controlSchemas.js'

describe('print.ts densable thin control subtypes', () => {
  const src = readFileSync(join(import.meta.dir, '../print.ts'), 'utf8')

  test('handlers for get_binary_version / list_models / get_session_cost / get_usage', () => {
    expect(src).toContain("subtype === 'get_binary_version'")
    expect(src).toContain("subtype === 'list_models'")
    expect(src).toContain("subtype === 'get_session_cost'")
    expect(src).toContain("subtype === 'get_usage'")
    // densable version stamp
    expect(src).toContain('MACRO.VERSION')
    expect(src).toContain('MACRO.BUILD_TIME')
    // densable list_models → _4e(UQe()) portable = modelInfos
    expect(src).toContain('models: modelInfos')
    // densable zi(V5e())
    expect(src).toContain('stripAnsi(formatTotalCost())')
    // densable xJr session slice
    expect(src).toContain('buildGetUsageControlResponse')
    expect(src).toContain('isClaudeAISubscriber() && hasProfileScope()')
  })

  test('get_plan uses peekPlanSlug and never-create semantics', () => {
    expect(src).toContain("subtype === 'get_plan'")
    expect(src).toContain('peekPlanSlug')
    expect(src).toContain('exists: true')
    expect(src).toContain('exists: false')
    expect(src).toContain('getPlanFilePath()')
  })

  test('file_suggestions maps displayText → path with showOnEmpty true', () => {
    expect(src).toContain("subtype === 'file_suggestions'")
    expect(src).toContain('generateFileSuggestions')
    expect(src).toContain('path: item.displayText')
    // densable third arg true → local showOnEmpty true
    expect(src).toContain('generateFileSuggestions(query, true)')
  })

  test('interrupt still_queued densable j+Xtt.AL receipt', () => {
    expect(src).toContain("subtype === 'interrupt'")
    expect(src).toContain('buildInterruptStillQueued')
    expect(src).toContain('inFlightDrainBatchUuids')
    expect(src).toContain('still_queued')
    expect(src).toContain(
      'sendControlResponseSuccess(msg, { still_queued })',
    )
  })

  test('cancel_async_message densable fold + markCancelPending + lifecycle', () => {
    expect(src).toContain("subtype === 'cancel_async_message'")
    expect(src).toContain('isFoldInFlight')
    expect(src).toContain('markCancelPending')
    expect(src).toContain('consumeCancelPending')
    expect(src).toContain("notifyCommandLifecycle(cmd.uuid, 'cancelled')")
    expect(src).toContain('cancelled: removed.length > 0')
  })

  test('rename_session densable qL? saveCustomTitle : cacheSessionTitle', () => {
    expect(src).toContain("subtype === 'rename_session'")
    expect(src).toContain('getActiveSessionFilePath')
    expect(src).toContain('saveCustomTitle')
    expect(src).toContain('cacheSessionTitle')
    expect(src).toContain('title must be non-empty')
  })

  test('background_tasks densable Yto/WLe via tool_use_id branch', () => {
    expect(src).toContain("subtype === 'background_tasks'")
    expect(src).toContain('backgroundByToolUseId')
    expect(src).toContain('backgroundAll')
    expect(src).toContain('backgrounded')
  })

  test('message_rated densable Fzo + allow_product_feedback + tengu_message_rated', () => {
    expect(src).toContain("subtype === 'message_rated'")
    expect(src).toContain('SDKControlMessageRatedRequestSchema')
    expect(src).toContain("isPolicyAllowed('allow_product_feedback')")
    expect(src).toContain("logEvent('tengu_message_rated'")
    expect(src).toContain('nonconforming')
  })

  test('reload_skills densable clearCommandsCache + getSkillToolCommands map', () => {
    expect(src).toContain("subtype === 'reload_skills'")
    expect(src).toContain('clearCommandsCache')
    expect(src).toContain('getSkillToolCommands')
    expect(src).toContain('skills')
    expect(src).toContain('argumentHint')
  })

  test('get_settings densable applied advisor/ultracode + errors', () => {
    expect(src).toContain("subtype === 'get_settings'")
    expect(src).toContain('resolveAppliedAdvisorModel')
    expect(src).toContain('isUltraEffortSessionActive')
    expect(src).toContain('getSettingsWithAllErrors')
    expect(src).toContain('advisor')
    expect(src).toContain('ultracode')
  })

  test('initialize densable title trim + cacheSessionTitle', () => {
    expect(src).toContain("subtype === 'initialize'")
    // densable: title.trim() → cPt; empty/absent skips
    expect(src).toContain('cacheSessionTitle')
    expect(src).toContain('initTitle')
  })

  test('initialize densable type validation residual', () => {
    expect(src).toContain(
      'initialize: sdkMcpServers and webSearchIsolationExemptMcpServers must be arrays of strings',
    )
    expect(src).toContain(
      'initialize: hooks must map hook events to arrays of matchers carrying hookCallbackIds arrays and string matchers',
    )
    expect(src).toContain('initialize: skills must be an array of strings')
    expect(src).toContain('excludeDynamicSections')
  })

  test('initialize densable ErT field apply + kQo skill allowlist', () => {
    expect(src).toContain('setSessionSkillAllowlist')
    expect(src).toContain('request.planModeInstructions')
    expect(src).toContain('request.appendSubagentSystemPrompt')
    expect(src).toContain('request.toolAliases')
    expect(src).toContain('request.forwardSubagentText')
    expect(src).toContain('request.excludeDynamicSections')
    expect(src).toContain('request.skills !== undefined')
  })

  test('initialize densable toolAliases AppState + options (Tc/sDn/b5t)', () => {
    // densable: c.toolAliases=e.toolAliases, p(_=>({...toolPermissionContext:{toolAliases}}))
    expect(src).toContain('options.toolAliases = request.toolAliases')
    expect(src).toContain('toolAliases: request.toolAliases')
    expect(src).toContain('toolPermissionContext')
    // ask() plumbed
    expect(src).toContain('toolAliases: (')
  })

  test('excludeDynamicSections densable TSo/lor/xEs consumers', () => {
    // densable get_context_usage passes d.excludeDynamicSections into lor
    expect(src).toContain("subtype === 'get_context_usage'")
    expect(src).toContain('excludeDynamicSections')
    // densable side_question xEs + main ask() QueryEngine path
    expect(src).toContain("subtype === 'side_question'")
    expect(src).toContain('buildSideQuestionFallbackParams')
    // densable QueryEngine ask options cast
    expect(src).toContain(
      'options as { excludeDynamicSections?: boolean }',
    )
  })

  test('end_session densable UFf stale archived + mcp_set_servers validation', () => {
    expect(src).toContain("subtype === 'end_session'")
    expect(src).toContain('isStaleArchivedEndSession')
    expect(src).toContain(
      "stale 'archived' end_session ignored on epoch>1 — from prior lifecycle",
    )
    expect(src).toContain("subtype === 'mcp_set_servers'")
    expect(src).toContain(
      'mcp_set_servers: servers must be an object of config objects',
    )
  })

  test('auto-title densable dt skip + first-prompt generate + soft FS log', () => {
    // densable dt flag: init title / generate persist / rename suppress auto-title
    expect(src).toContain('skipAutoSessionTitle')
    expect(src).toContain('shouldSkipAutoSessionTitle')
    // densable first-prompt path (Kce/Dye/l8e/kye)
    expect(src).toContain('extractTitleSourceText')
    expect(src).toContain('isAutoTitleExcludedPrompt')
    expect(src).toContain('getCurrentSessionTitle')
    // densable Xo soft-log on saveAiGeneratedTitle FS errors
    expect(src).toContain('isFsInaccessible')
    expect(src).toContain('saveAiGeneratedTitle failed')
    // generate_session_title persist flips skip flag
    expect(src).toContain('if (persist)')
    // rename_session flips skip after success
    expect(src).toContain('skipAutoSessionTitle = true')
  })

  test('apply_flag_settings densable effortLevel/ultracode AppState', () => {
    expect(src).toContain("subtype === 'apply_flag_settings'")
    expect(src).toContain('effortLevel')
    expect(src).toContain('ultracode')
    expect(src).toContain('parseEffortUltracodeAlias')
    expect(src).toContain("effort_level")
  })

  test('set_max_thinking_tokens densable thinking_display + OFf resolve', () => {
    expect(src).toContain("subtype === 'set_max_thinking_tokens'")
    expect(src).toContain('thinking_display')
    expect(src).toContain('resolveControlThinkingConfig')
    expect(src).toContain('sessionThinkingDisplay')
    expect(src).toContain(
      'max_thinking_tokens must be an integer or null and thinking_display must be "summarized", "omitted", or null',
    )
  })

  test('set_model densable type/default/allowlist + session AppState', () => {
    expect(src).toContain("subtype === 'set_model'")
    expect(src).toContain('set_model: model must be a string')
    expect(src).toContain("trim().toLowerCase() === 'default'")
    expect(src).toContain('isModelAllowed')
    expect(src).toContain('mainLoopModelForSession')
    expect(src).toContain('formatRestrictedModelError')
    expect(src).toContain('notifySessionMetadataChanged({ model })')
  })

  test('schemas accept densable request subtypes', () => {
    expect(
      SDKControlGetBinaryVersionRequestSchema().parse({
        subtype: 'get_binary_version',
      }).subtype,
    ).toBe('get_binary_version')
    expect(
      SDKControlListModelsRequestSchema().parse({ subtype: 'list_models' })
        .subtype,
    ).toBe('list_models')
    expect(
      SDKControlGetSessionCostRequestSchema().parse({
        subtype: 'get_session_cost',
      }).subtype,
    ).toBe('get_session_cost')
    expect(
      SDKControlGetUsageRequestSchema().parse({ subtype: 'get_usage' }).subtype,
    ).toBe('get_usage')
    expect(
      SDKControlGetPlanRequestSchema().parse({ subtype: 'get_plan' }).subtype,
    ).toBe('get_plan')
    expect(
      SDKControlFileSuggestionsRequestSchema().parse({
        subtype: 'file_suggestions',
        query: 'src/',
      }).query,
    ).toBe('src/')

    // union membership
    for (const subtype of [
      'get_binary_version',
      'list_models',
      'get_session_cost',
      'get_usage',
      'get_plan',
    ] as const) {
      expect(
        SDKControlRequestInnerSchema().safeParse({ subtype }).success,
      ).toBe(true)
    }
    expect(
      SDKControlRequestInnerSchema().safeParse({
        subtype: 'file_suggestions',
        query: '',
      }).success,
    ).toBe(true)

    expect(
      SDKControlInterruptRequestSchema().parse({ subtype: 'interrupt' })
        .subtype,
    ).toBe('interrupt')
    expect(
      SDKControlInterruptResponseSchema().parse({
        still_queued: ['uuid-a', 'uuid-b'],
      }).still_queued,
    ).toEqual(['uuid-a', 'uuid-b'])
    expect(
      SDKControlInterruptResponseSchema().parse({ still_queued: [] })
        .still_queued,
    ).toEqual([])
    expect(
      SDKControlRenameSessionRequestSchema().parse({
        subtype: 'rename_session',
        title: 'My session',
      }).title,
    ).toBe('My session')
    expect(
      SDKControlRequestInnerSchema().safeParse({
        subtype: 'rename_session',
        title: 'x',
      }).success,
    ).toBe(true)
    expect(
      SDKControlBackgroundTasksRequestSchema().parse({
        subtype: 'background_tasks',
      }).subtype,
    ).toBe('background_tasks')
    expect(
      SDKControlBackgroundTasksRequestSchema().parse({
        subtype: 'background_tasks',
        tool_use_id: 'tu_1',
      }).tool_use_id,
    ).toBe('tu_1')
    expect(
      SDKControlBackgroundTasksResponseSchema().parse({ backgrounded: true })
        .backgrounded,
    ).toBe(true)
    expect(
      SDKControlRequestInnerSchema().safeParse({
        subtype: 'background_tasks',
      }).success,
    ).toBe(true)
    expect(
      SDKControlMessageRatedRequestSchema().parse({
        subtype: 'message_rated',
        messageUuid: 'u-1',
        sentiment: 'positive',
      }).sentiment,
    ).toBe('positive')
    expect(
      SDKControlRequestInnerSchema().safeParse({
        subtype: 'message_rated',
        messageUuid: 'u-1',
        sentiment: 'negative',
        surface: 'assistant_text',
        cleared: true,
      }).success,
    ).toBe(true)
    expect(
      SDKControlMessageRatedRequestSchema().safeParse({
        subtype: 'message_rated',
        messageUuid: 'u-1',
        sentiment: 'meh',
      }).success,
    ).toBe(false)
    expect(
      SDKControlReloadSkillsRequestSchema().parse({
        subtype: 'reload_skills',
      }).subtype,
    ).toBe('reload_skills')
    expect(
      SDKControlReloadSkillsResponseSchema().parse({
        skills: [
          {
            name: 'foo',
            description: 'bar',
            argumentHint: '',
            aliases: ['f'],
          },
        ],
      }).skills[0]?.name,
    ).toBe('foo')
    expect(
      SDKControlRequestInnerSchema().safeParse({
        subtype: 'reload_skills',
      }).success,
    ).toBe(true)

    // densable initialize title optional + skills/excludeDynamicSections
    expect(
      SDKControlInitializeRequestSchema().parse({
        subtype: 'initialize',
        title: '  My session  ',
      }).title,
    ).toBe('  My session  ')
    expect(
      SDKControlRequestInnerSchema().safeParse({
        subtype: 'initialize',
        title: 'x',
      }).success,
    ).toBe(true)
    expect(
      SDKControlInitializeRequestSchema().parse({ subtype: 'initialize' })
        .title,
    ).toBeUndefined()
    expect(
      SDKControlInitializeRequestSchema().parse({
        subtype: 'initialize',
        skills: ['foo', 'bar'],
        excludeDynamicSections: true,
        webSearchIsolationExemptMcpServers: ['infra'],
      }).skills,
    ).toEqual(['foo', 'bar'])
    expect(
      SDKControlInitializeRequestSchema().safeParse({
        subtype: 'initialize',
        skills: [1],
      }).success,
    ).toBe(false)
    expect(
      SDKControlInitializeRequestSchema().safeParse({
        subtype: 'initialize',
        sdkMcpServers: 'not-array',
      }).success,
    ).toBe(false)
    expect(
      SDKControlRequestInnerSchema().safeParse({
        subtype: 'initialize',
        skills: ['x'],
        excludeDynamicSections: false,
      }).success,
    ).toBe(true)

    // densable AJk — applied.advisor / applied.ultracode + optional errors
    expect(
      SDKControlGetSettingsRequestSchema().parse({ subtype: 'get_settings' })
        .subtype,
    ).toBe('get_settings')
    expect(
      SDKControlRequestInnerSchema().safeParse({ subtype: 'get_settings' })
        .success,
    ).toBe(true)
    const getSettingsResp = SDKControlGetSettingsResponseSchema().parse({
      effective: {},
      sources: [],
      applied: {
        model: 'claude-opus-4-7',
        effort: 'xhigh',
        advisor: 'claude-opus-4-7',
        ultracode: true,
      },
      errors: [{ file: 'settings.json', path: 'env.X', message: 'bad' }],
    })
    expect(getSettingsResp.applied?.advisor).toBe('claude-opus-4-7')
    expect(getSettingsResp.applied?.ultracode).toBe(true)
    expect(getSettingsResp.errors?.[0]?.message).toBe('bad')
    expect(
      SDKControlGetSettingsResponseSchema().parse({
        effective: {},
        sources: [],
        applied: { model: 'claude-sonnet-4-6', effort: null, advisor: null },
      }).applied?.advisor,
    ).toBe(null)
  })
})
