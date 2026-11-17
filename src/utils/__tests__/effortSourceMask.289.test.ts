import { expect, test } from 'bun:test'

// All module mocks live in the child: Bun mock.module is process-global.
test('org effort source masking and legacy launch pins reach hook, UI and API consumers', () => {
  const child = Bun.spawnSync(
    [
      process.execPath,
      '-e',
      `
import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { logMock } from './tests/mocks/log.ts'
import { debugMock } from './tests/mocks/debug.ts'
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)
globalThis.MACRO = { VERSION: '2.1.289' }
for (const key of Object.keys(process.env)) {
  if (key.startsWith('CLAUDE_CODE_USE_') || key.startsWith('ANTHROPIC_DEFAULT_')) delete process.env[key]
}
delete process.env.CLAUDE_CODE_EFFORT_LEVEL
delete process.env.USER_TYPE
const realConfig = { ...await import('src/utils/config.ts') }
let config = { oauthAccount: { organizationUuid: 'org-a' }, firstStartVersion: '2.1.289' }
mock.module('src/utils/config.ts', () => ({
  ...realConfig,
  getGlobalConfig: () => config,
  saveGlobalConfig: update => { config = update(config) },
}))
const settings = { ...await import('src/utils/settings/settings.ts') }
let modelType = 'anthropic'
mock.module('src/utils/settings/settings.ts', () => ({
  ...settings,
  getInitialSettings: () => ({ modelType }),
  getSettingsForSource: () => ({}),
}))
const effort = await import('src/utils/effort.ts')
const org = await import('src/utils/model/orgDefaultModel.ts')
const catalog = await import('src/utils/model/effortCatalog.ts')
const model = 'claude-sonnet-4-6'
const cache = {
  name: 'Claude-Sonnet-4-6-20250514', updated_at: 'now', data_source: 'bootstrap',
  override_user_selection: false, default_effort_level: 'medium',
  override_user_effort: true, orgUuid: 'org-a',
}
const realAuth = { ...await import('src/utils/auth.ts') }
mock.module('src/utils/auth.ts', () => ({
  ...realAuth,
  getAnthropicApiKey: () => 'test-bootstrap-key',
  getClaudeAIOAuthTokens: () => null,
  hasProfileScope: () => false,
}))
const axios = await import('axios')
let responseData = { org_model_default: cache }
let bootstrapRequests = 0
mock.module('axios', () => ({
  ...axios,
  default: { ...axios.default, get: async () => {
    bootstrapRequests++
    return { data: responseData }
  } },
}))
delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
delete process.env.ANTHROPIC_UNIX_SOCKET
const { fetchBootstrapData } = await import('src/services/api/bootstrap.ts')
await fetchBootstrapData()
assert.equal(bootstrapRequests, 1)
assert.equal(config.orgModelDefaultCache.default_effort_level, 'medium')
assert.equal(config.orgModelDefaultCache.override_user_effort, true)
assert.equal(config.orgModelDefaultCache.orgUuid, 'org-a')
// Retain a mutable cache fixture after verifying the actual schema/write path.
config.orgModelDefaultCache = cache
const user = { source: 'userSettings', settings: { effortLevel: 'low', modelSettings: { [model]: { effortLevel: 'low' } } } }
const project = { source: 'projectSettings', settings: { effortLevel: 'xhigh', modelSettings: { [model]: { effortLevel: 'high' } } } }
function read(entries, target = model) {
  const table = effort.teSettingsEffortTable(entries)
  assert.ok(table)
  return { table, pd: effort.pdSessionEffort({ settingsEffortTable: table }, target) }
}
assert.equal(org.getOrgDefaultEffort(model), 'medium')
assert.equal(org.getOrgDefaultEffort('claude-opus-4-6'), null)
assert.equal(org.shouldOrgDefaultOverrideUserEffort(model), true)
let { table, pd } = read([user, project])
assert.equal(Object.hasOwn(table.byModel, model), true)
assert.equal(pd, undefined)
assert.equal(table.default, 'xhigh')
assert.equal(effort.pdSessionEffort({ settingsEffortTable: table }, 'claude-opus-4-6'), 'xhigh')
assert.equal(effort.resolveHookStdinEffort(model, pd), 'medium')
assert.equal(effort.resolveAppliedEffort(model, pd), 'medium')
assert.equal(effort.getDisplayedEffortLevel(model, pd), 'medium')
assert.equal(effort.resolveHookStdinEffort(model, pd, 'low'), 'low')
assert.equal(read([user, project, { source: 'policySettings', settings: { effortLevel: 'high' } }]).pd, 'high')
assert.equal(read([user, { source: 'flagSettings', settings: { modelSettings: { [model]: { effortLevel: 'low' } } } }]).pd, 'low')
assert.equal(read([{ source: 'policySettings', settings: { effortLevel: 'high' } }, project]).pd, 'high')
assert.equal(read([user, { source: 'policySettings', settings: { modelSettings: { [model]: { effortLevel: 'invalid' } } } }]).pd, undefined)
cache.override_user_effort = false
assert.equal(read([user, project]).pd, 'high')
assert.equal(effort.getDefaultEffortForModel(model), 'medium')
cache.override_user_effort = true
cache.default_effort_level = 'invalid'
assert.equal(org.getOrgDefaultEffort(model), null)
assert.equal(read([user]).pd, 'low')
cache.default_effort_level = 'medium'
modelType = 'openai'
assert.equal(org.getOrgDefaultEffort(model), null)
assert.equal(read([user]).pd, 'low')
modelType = 'anthropic'
config.oauthAccount.organizationUuid = 'org-b'
assert.equal(org.getOrgModelDefaultCache(), null)
assert.equal(read([user]).pd, 'low')
config.oauthAccount = undefined
assert.equal(org.getOrgDefaultEffort(model), 'medium')
config.oauthAccount = { organizationUuid: 'org-a' }
delete cache.orgUuid
assert.equal(org.getOrgDefaultEffort(model), 'medium')
config.orgModelDefaultCache = null
delete config.firstStartVersion
let pinned = read([{ source: 'userSettings', settings: { effortLevel: 'low' } }], 'claude-opus-4-7')
assert.equal(pinned.pd, undefined)
assert.equal(Object.hasOwn(pinned.table.byModel, 'claude-opus-4-7'), true)
assert.equal(effort.resolveHookStdinEffort('claude-opus-4-7', pinned.pd), 'xhigh')
assert.equal(effort.resolveAppliedEffort('claude-opus-4-7', pinned.pd), 'xhigh')
assert.equal(read([{ source: 'userSettings', settings: { effortLevel: 'low' } }], model).pd, 'low')
assert.equal(read([{ source: 'userSettings', settings: { effortLevel: 'low', modelSettings: { 'claude-opus-4-7': { effortLevel: 'medium' } } } }], 'claude-opus-4-7').pd, 'medium')
config.unpinOpus47LaunchEffort = true
assert.equal(read([{ source: 'userSettings', settings: { effortLevel: 'low' } }], 'claude-opus-4-7').pd, 'low')
config.unpinOpus47LaunchEffort = false
config.firstStartVersion = '2.1.289'
assert.equal(read([{ source: 'userSettings', settings: { effortLevel: 'low' } }], 'claude-opus-4-7').pd, 'low')
delete config.firstStartVersion
process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'custom-reasoning'
assert.equal(catalog.launchPinModels().includes('custom-reasoning'), true)
assert.equal(read([{ source: 'userSettings', settings: { effortLevel: 'low' } }], 'custom-reasoning').pd, undefined)
// Model-only selection preserves the tagged effort; each consumer resolves
// inherit against the new model instead of reusing the old scalar snapshot.
const { getEffortValueFromLayers } = await import('src/engine/permissionLayerReaders.ts')
const { buildStatusLineCommandInput } = await import('src/components/StatusLine.tsx')
config.firstStartVersion = '2.1.289'
const secondModel = 'claude-opus-4-6'
const switchTable = effort.teSettingsEffortTable([{ source: 'userSettings', settings: {
  modelSettings: { [model]: { effortLevel: 'low' }, [secondModel]: { effortLevel: 'high' } },
} }])
let state = { mainLoopModel: model, mainLoopModelForSession: null,
  effortValue: 'low', sessionEffort: { kind: 'inherit' }, settingsEffortTable: switchTable }
const context = { getAppState: () => state, options: { mainLoopModel: model }, permissionLayers: [] }
function checkConsumers(target, expected) {
  const pd = effort.pdSessionEffort(state, target)
  assert.equal(effort.getDisplayedEffortLevel(target, pd), expected)
  assert.equal(effort.resolveAppliedEffort(target, getEffortValueFromLayers(context)), expected)
  assert.equal(effort.resolveHookStdinEffort(target, pd), expected)
  const status = buildStatusLineCommandInput('default', false, {}, [], [], target,
    undefined, false, state.effortValue, true, undefined, state.sessionEffort, state.settingsEffortTable)
  assert.equal(status.effort.level, expected)
}
checkConsumers(model, 'low')
state = { ...state, mainLoopModel: secondModel }
context.options.mainLoopModel = secondModel
assert.equal(state.effortValue, 'low') // intentionally stale compatibility scalar
checkConsumers(secondModel, 'high')
state = { ...state, mainLoopModel: model }
context.options.mainLoopModel = model
checkConsumers(model, 'low')
context.permissionLayers = [{ kind: 'model', mainLoopModel: secondModel }]
assert.equal(getEffortValueFromLayers(context), 'high')
context.permissionLayers.push({ kind: 'effort', effort: 'medium' })
assert.equal(getEffortValueFromLayers(context), 'medium')
context.permissionLayers.push({ kind: 'effort', effort: undefined })
assert.equal(getEffortValueFromLayers(context), undefined)
context.permissionLayers = []
state.sessionEffort = { kind: 'default' }
assert.equal(getEffortValueFromLayers(context), undefined)
state.sessionEffort = { kind: 'level', value: 'medium' }
state = { ...state, mainLoopModel: secondModel }
context.options.mainLoopModel = secondModel
checkConsumers(secondModel, 'medium')
console.log('org/source/pin consumer assertions passed')
`,
    ],
    { cwd: new URL('../../../', import.meta.url).pathname },
  )
  expect(child.stderr.toString()).toBe('')
  expect(child.exitCode).toBe(0)
  expect(child.stdout.toString()).toContain(
    'org/source/pin consumer assertions passed',
  )
})
