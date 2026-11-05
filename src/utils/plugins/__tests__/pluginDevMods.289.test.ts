/**
 * densable 2.1.289 J / go / wfr / Ho / bOn — plugin_dev_mods ask.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { DEV_MODS_PLACEHOLDER } from '../pluginDevMods.js'

const root = join(import.meta.dir, '../../../..')

describe('densable 2.1.289 plugin_dev_mods', () => {
  test('placeholder', () => {
    expect(DEV_MODS_PLACEHOLDER).toBe('${CLAUDE_DEV_MODS_DIR}')
  })

  test('source-lock J/go/WKe/bOn', () => {
    const mods = readFileSync(
      join(root, 'src/utils/plugins/pluginDevMods.ts'),
      'utf8',
    )
    expect(mods).toContain("ASK_SOURCE = 'mod_hot_reload'")
    expect(mods).toContain('source: ASK_SOURCE')
    expect(mods).toContain("header: 'Mods'")
    expect(mods).toContain('personOnly: true')
    expect(mods).toContain('export function isDevModsPersonTurn')
    expect(mods).toContain('Enable hot reloading for this session?')
    expect(mods).toContain('How does this work?')
    expect(mods).toContain('Enable for this session')
    expect(mods).toContain('restorePluginDevModsHost')
    expect(mods).toContain('replaceDevModsPlaceholder')
    expect(mods).toContain('const QUIET_MS = 2000')
    expect(mods).toContain(
      "Mod hot-reloading is on; this session's mods load when this turn ends.",
    )
    expect(mods).toContain("loaded from this session's mods folder")
    expect(mods).toContain('on hold: /reload-plugins applies it')
    expect(mods).toContain('function leftoverJsSlot')
    expect(mods).toContain('function leftoverEtSlot')
    expect(mods).toContain('function leftoverWatchDevModsFolder')
    expect(mods).toContain('function leftoverEnableDevMods')
    expect(mods).toContain('function leftoverLoadDevModsAtStart')
    expect(mods).toContain('askedAt = Number.NEGATIVE_INFINITY')
    expect(mods).toContain('setInlinePlugins(')
    expect(mods).toContain(
      "join(getClaudeConfigHomeDir(), 'dev-mods', getSessionId())",
    )
    expect(mods).toContain("refusal: 'hooks_modules_off'")
    expect(mods).toContain("refusal: 'sideload_disabled'")
    expect(mods).toContain("refusal: 'local_dirs_blocked'")
    expect(mods).toContain('saveDevModsFolder')
    expect(mods).toContain('getCurrentSessionDevModsFolder')
    expect(mods).toContain('chokidar.watch')
    expect(mods).toContain('followSymlinks: false')
    expect(mods).toContain('usePolling: true')
    expect(mods).toContain('leftoverModsWatchIgnored')
    expect(mods).toContain('getBlockedMarketplaces')
    expect(mods).toContain('disableSideloadFlags === true')
    expect(mods).not.toContain('return policy?.allowManagedHooksOnly === true')
    expect(mods).toContain('passive: true')
    expect(mods).toContain('agentId: getSessionId()')
    expect(mods).toContain('shouldQuery: false')
    expect(mods).toContain('leftoverPluginDevModsRefusalProbe')
    expect(mods).toContain('leftoverPluginDevModsRefusalDot')
    expect(mods).toContain('function leftoverWae')
    expect(mods).toContain('leftoverWae(name, error)')
    expect(mods).toContain(
      'if (leftoverPluginDevModsRefusalProbe() !== undefined) return',
    )
    expect(mods).toContain('reload failed, the previous version stays loaded:')
    expect(mods).toContain('dev mods: no context to ask in yet:')
    expect(mods).toContain('await leftoverTick(0)')
    expect(mods).not.toContain('leftoverTick(0, undefined, { unref: true })')
    expect(mods).toContain('{ unref: true },')
    expect(mods).not.toContain('enabling ${name} failed')
    expect(mods).not.toContain('loading ${name} failed')
    expect(mods).toContain("stage: 'consented'")
    expect(mods).toContain('leftoverCatchUp')
    expect(mods).toContain('leftoverDevModsCatchUpSlot')
    expect(mods).toContain('leftoverDevModsExpanderSlot')
    expect(mods).toContain('leftoverEnableDevMods(current.folder)')
    expect(mods).toContain(
      'leftoverDevModsExpander.set(replaceDevModsPlaceholder)',
    )
    expect(mods).toContain(
      'resolve(folder) === resolve(sessionDevModsFolder())',
    )
    expect(mods).toContain('saveDevModsFolder(folder, storageV5)')
    expect(mods).toContain('leftoverPinJoinPluginDir')
    expect(mods).toContain('leftoverJoinPluginDir.set')
    expect(mods).toContain('leftoverJoinPluginDir.get()?.joinPluginDir(folder)')
    expect(mods).toContain('function leftoverTick')
    expect(mods).toContain('abort?.aborted')
    expect(mods).toContain('timer.unref')
    expect(mods).toContain('function leftoverTurnSlot')
    expect(mods).toContain('const leftoverZO')
    expect(mods).toContain('function leftoverYmClock')
    expect(mods).toContain('groups.flat()')
    expect(mods).toContain('leftoverBoundTurnId')
    expect(mods).toContain('abortError?: () => Error')
    expect(mods).toContain('{ unref: opts?.unref }')
    expect(mods).toContain('started: Promise.resolve()')
    expect(mods).toContain('cancelled: () => cancelled')
    expect(mods).toContain('leftoverTurnBegin.emit()')
    expect(mods).toContain('turnId: opts.turnId')
    expect(mods).toContain('turnId: seq')
    expect(mods).toContain("opts.startedBy === 'person'")
    expect(mods).toContain('opts.started ?? Promise.resolve()')
    expect(mods).toContain("startedBy: person ? 'person' : 'system'")
    expect(mods).toContain('opts.abort()')
    expect(mods).toContain('abort?: () => void')
    expect(mods).toContain('abort: opts?.abort ?? (() => {})')
    expect(mods).toContain('export function leftoverSideloadDisabled')
    const restoreHost = mods.slice(
      mods.indexOf('export function restorePluginDevModsHost'),
    )
    expect(restoreHost.slice(0, 900)).not.toContain('leftoverPinJoinPluginDir')
    expect(mods).toContain('export function leftoverHooksModulesOn')
    expect(mods).toContain('hooks modules are switched off in this process')
    expect(mods).toContain('nobody could be asked')
    expect(mods).not.toContain('Mods under ')

    const storage = readFileSync(
      join(root, 'src/utils/sessionStorage.ts'),
      'utf8',
    )
    expect(storage).toContain('function leftoverDevModsFolderMatches')
    expect(storage).toContain('resolve(folder) === resolve(expected)')
    expect(storage).toContain(
      'export function saveDevModsFolder(folder: string, storageV5?: unknown)',
    )
    expect(storage).toContain('function leftoverAppendEntryToFileAsync')
    expect(storage).toContain('function leftoverSerialByPath')
    expect(storage).toContain('openAppendRelocationBracket')
    expect(storage).toContain('closeAppendRelocationBracket')
    expect(storage).toContain('function leftoverSkn')
    expect(storage).toContain('leftoverSkn(project.sessionFile ?? currentFile)')
    expect(storage).toContain('async function leftoverPye')
    expect(storage).toContain(
      'await leftoverPye(filePath, data, getPinnedStorageV5())',
    )
    expect(storage).toContain('async function leftoverXr')
    expect(storage).toContain('tornTailSealPending')
    expect(storage).toContain('tornTailSealLanded')
    expect(storage).toContain('sealTornTailOnNextAppend')
    expect(storage).toContain('sealTornTailSync')
    expect(storage).toContain('this.sealTornTailSync(this.sessionFile)')
    expect(storage).toContain('function leftoverWdr')
    expect(storage).not.toContain(
      'if (torn !== undefined) leftoverWdr(filePath)',
    )
    expect(storage).toContain('O_RDWR | fsConstants.O_APPEND')
    expect(storage).toContain('mode: 0o700')
    expect(storage).toContain('async settle()')
    expect(storage).toContain('leftoverAppendSerial.settle()')
    expect(storage).toContain('tornTailEntry')
    expect(storage).toContain('onlyIfExists')
    expect(storage).toContain("recordTranscriptWriteFailure('dev_mods'")
    expect(storage).toContain('bindMainSessionTranscriptPersistence')
    expect(storage).toContain('function leftoverDxr')
    expect(storage).toContain('leftoverDxr(payload)')
    expect(storage).not.toContain('[{ data: payload }]')
    expect(storage).toContain('hasInternalAgentEventReader(): boolean')
    expect(storage).toContain('this.internalAgentEventReader !== null')
    expect(storage).toContain('backend.append(bind.key')
    expect(storage).toContain('project.fireMirror(filePath, [mirrored])')
    expect(storage).toContain(
      'dev mods: dropped a dev-mods entry naming a folder not its own',
    )

    const health = readFileSync(
      join(root, 'src/utils/transcriptWriterHealth.ts'),
      'utf8',
    )
    expect(health).toContain("| 'dev_mods'")
    expect(health).toContain("| 'append'")
    expect(health).toContain("'drain',\n  'materialize',\n  'adopt',\n]")
    expect(health).not.toContain("'append',\n  'dev_mods'")

    const tulipSrc = readFileSync(
      join(root, 'src/cli/leftoverTulip.ts'),
      'utf8',
    )
    expect(tulipSrc).toContain('leftoverRegisterPolicyLimitsVerdict')
    expect(tulipSrc).toContain('function leftoverCer')
    expect(tulipSrc).toContain('complianceTaintsSettled: leftoverCer')
    expect(tulipSrc).toContain('policyDeniedReason: leftoverPolicyLimitsDp')
    expect(tulipSrc).toContain('coreSkills: leftoverHas')
    expect(tulipSrc).toContain('rememberedCoreSkills: leftoverYas')
    expect(tulipSrc).toContain('function leftoverXZn')
    expect(tulipSrc).toContain('function leftoverOrHeader')
    expect(tulipSrc).toContain('function leftoverMxo')
    expect(tulipSrc).toContain('function leftoverCv')
    expect(tulipSrc).toContain('function leftoverNen')
    expect(tulipSrc).toContain('function leftoverPh')
    expect(tulipSrc).toContain('function leftoverGd')
    expect(tulipSrc).toContain('const leftoverSls')
    expect(tulipSrc).toContain('function leftoverYh')
    expect(tulipSrc).toContain('queueMicrotask(() => {')
    expect(tulipSrc).toContain(
      "logEvent('tengu_wif_implicit_profile_skipped_stored_login', {})",
    )
    expect(tulipSrc).toContain('function leftoverQh')
    expect(tulipSrc).toContain(
      'tengu_wif_implicit_profile_skipped_stored_login',
    )
    expect(tulipSrc).toContain(
      'opts?.skipApiKeyHelper ? undefined : leftoverSls',
    )
    expect(tulipSrc).toContain(
      "getAnthropicProfileSource() === 'profile-implicit'",
    )
    expect(tulipSrc).toContain('function leftoverHnr')
    expect(tulipSrc).toContain('function leftoverPr')
    expect(tulipSrc).toContain('CLAUDE_CODE_REMOTE')
    expect(tulipSrc).toContain('leftoverDesktopEntrypoint')
    expect(tulipSrc).toContain("'claude-desktop'")
    expect(tulipSrc).toContain("'claude-desktop-3p'")
    expect(tulipSrc).toContain("'local-agent'")
    expect(tulipSrc).not.toContain(
      'process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION',
    )
    expect(tulipSrc).toContain('n.apiKeyHelper')
    expect(tulipSrc).toContain('function leftoverVgt')
    expect(tulipSrc).toContain('isProfileImplicitUserOauth')
    expect(tulipSrc).toContain('function leftoverCopperKite')
    expect(tulipSrc).toContain('tengu_copper_kite')
    expect(tulipSrc).toContain('function leftoverDw')
    expect(tulipSrc).toContain('function leftoverQt')
    expect(tulipSrc).toContain("leftoverQt() === 'store'")
    expect(tulipSrc).toContain('function leftoverRl')
    expect(tulipSrc).toContain('function leftoverNjo')
    expect(tulipSrc).toContain('function leftoverGas')
    expect(tulipSrc).toContain('commandPolicyGateAllows: leftoverGas')
    expect(tulipSrc).toContain('policyLimitsCacheLoaded: leftoverVk')
    expect(tulipSrc).toContain('autoDefaultVerdictState: leftoverMas')
    expect(tulipSrc).toContain('principalSeenUnderHipaa: leftoverVkr')
    expect(tulipSrc).toContain('leftoverHashPrincipalShort(n) === e')
    expect(tulipSrc).toContain('isPolicyAllowed:')
    expect(tulipSrc).toContain('policyDenyKind:')
    expect(tulipSrc).toContain('leftoverRegisterPolicyLimitsVerdict()')
    expect(tulipSrc).toContain(
      'leftoverPolicyLimitsHost().verdict?.complianceTaintsSettled() ?? false',
    )
    expect(tulipSrc).not.toContain(
      'if (leftoverPolicyLimitsHost().verdict === undefined)',
    )

    const recovery = readFileSync(
      join(root, 'src/utils/conversationRecovery.ts'),
      'utf8',
    )
    expect(recovery).toContain(
      'devModsFolder: log?.devModsFolder ?? devModsFromJsonl',
    )
    expect(recovery).toContain(
      'devModsFolder: sessionId ? devModsFolders.get(sessionId) : undefined',
    )

    const settings = readFileSync(
      join(root, 'src/utils/settings/types.ts'),
      'utf8',
    )
    expect(settings).toContain('disableSideloadFlags:')

    const skill = readFileSync(
      join(root, 'src/skills/bundled/goldOfficialMissingSkills.ts'),
      'utf8',
    )
    expect(skill).toContain('restorePluginDevModsHost')
    expect(skill).toContain('leftoverDevModsExpanderSlot')

    const load = readFileSync(join(root, 'src/skills/loadSkillsDir.ts'), 'utf8')
    expect(load).toContain('leftoverDevModsExpanderSlot')

    const hooks = readFileSync(
      join(root, 'src/utils/plugins/loadPluginHooks.ts'),
      'utf8',
    )
    expect(hooks).toContain('leftoverDevModsCatchUpSlot')

    const tulip = readFileSync(join(root, 'src/cli/leftoverTulip.ts'), 'utf8')
    expect(tulip).toContain('leftoverComplianceTaintsSettled')

    const query = readFileSync(join(root, 'src/query.ts'), 'utf8')
    expect(query).toContain('params.toolUseContext.agentId === undefined')
    expect(query).toContain('isDevModsPersonTurn(params.messages)')
    expect(query).toContain('restorePluginDevModsHost()')
    expect(query).toContain('abort: () => {')
    expect(query).toContain('params.toolUseContext.abortController')

    const main = readFileSync(join(root, 'src/main.tsx'), 'utf8')
    expect(main).toContain('leftoverSideloadDisabled()')
    expect(main).toContain('leftoverSideloadFlagsDisabledMessage')
    expect(main).toContain(
      "disabled by your organization's managed settings (disableSideloadFlags)",
    )
    expect(main).toContain('CLAUDE_CODE_PLUGIN_DIRS')
    expect(main).toContain('plugins (initialize request)')
    expect(main).toContain('appliedInitialize.pluginDirsNoMcp.length')
    expect(main).toContain('Unset CLAUDE_CODE_PLUGIN_DIRS (in the environment')
    expect(main).not.toContain(
      'disableSideloadFlags rejects the --plugin-dir, --plugin-url, --agents, and non-sdk --mcp-config CLI flags at startup.',
    )
  })
})
