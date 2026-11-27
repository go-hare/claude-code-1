/**
 * Function hooks submodule: hostOp
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { logForDebugging } from '../../debug.js'
import { isProjectScopeBlockedEnvVar } from '../../managedEnvConstants.js'
import { getPromptInputCursorState } from '../../promptInputCursorStore.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import {
  FS_BYTE_LIMIT,
  PROMPT_MEDIA_ABSENT,
  UI_HOST_TEXT_MAX,
  UI_TOAST_COOLDOWN_MS,
  UI_TOAST_TIMEOUT_MS_MAX,
  configValueCheck,
  firstRecord,
  hostCheck,
  hostTextCheck,
  isEventRecord,
  mapUiNotifyChannel,
  pathFrom,
  sessionSendCheck,
  stringArg,
  uiLogToCheck,
  validateNotifyKey,
  validateUiNotifyInput,
  waitClockMs,
} from './constants.js'
import { notifyDrawingReadersOfKeys } from './faultRender.js'
import { dispatchTelemetryLog, runFunctionHookChain } from './hookChain.js'
import {
  fetchHttp,
  refusePluginFsNetworkPath,
  resolvePluginFsBaseCwd,
  runAudioPlay,
  runAudioSpeak,
  runFsAncestors,
  runProcess,
  spawnProcessStream,
  validateProcessSpawnRequest,
} from './processAndIo.js'
import {
  countSessionTurns,
  listPluginCommands,
  listSessionMessages,
  readPromptMediaById,
  registerPluginCommand,
  runPluginCommand,
  runPromptFill,
  runPromptSubmit,
  runSessionCompact,
  runSessionSend,
  runTurnAbort,
} from './promptAndSession.js'
import {
  beginPersonalEnvSetTrack,
  clearPersonalEnvSetTrack,
  runPluginStore,
  runSessionAuthorize,
  runSettingsRead,
} from './settingsAndEnv.js'
import {
  activeHookModuleAls,
  activeHookServingAls,
  checkPluginInputRefusal,
  fhState,
  noteStateRead,
  readStateRef,
  resolveHookCallOrigin,
  stateKey,
  withSessionStartDedup,
} from './state.js'
import { runThemeClear, runThemeSet, themeSetCheck } from './theme.js'
import {
  listPluginAgents,
  registerPluginAgent,
  runAgentSpawn,
  runMcpCall,
  runMcpConnect,
  runModelClassify,
  runModelComplete,
  runModelFork,
  runPluginRegister,
  runToolCall,
  runToolCheck,
  runToolList,
  runToolRegister,
} from './toolsAndAgents.js'
import type { ConfigOverlayValue, HookServingContext } from './types.js'
import {
  attachedClientAnswering,
  runInterfaceCall,
  runUiAsk,
  runUiHost,
  runUiStatus,
} from './uiRender.js'
import {
  sessionCompactMessagesCheck,
  validatePromptDecorations,
} from './uiValidation.js'

export async function handleHostOp(
  op: string,
  args: unknown[],
  plugin?: string,
): Promise<unknown> {
  const serving = activeHookServingAls.getStore()
  const pauseBudget =
    serving?.budgetTracker !== undefined && serving.isDispatching?.() === false
  serving?.budgetTracker && pauseBudget && serving.budgetTracker.pause()
  try {
    return await handleHostOpInner(op, args, plugin, serving)
  } finally {
    if (pauseBudget) serving?.budgetTracker?.resume()
  }
}

async function handleHostOpInner(
  op: string,
  args: unknown[],
  plugin?: string,
  serving?: HookServingContext,
): Promise<unknown> {
  const [namespace, method] = op.split('.')
  fhState().pluginHostCalls.push({
    namespace: namespace ?? op,
    method: method ?? op,
    args,
  })
  const rec = firstRecord(args)
  if (op === 'session.cwd') {
    const servingCwd = activeHookServingAls.getStore()?.cwd
    if (typeof servingCwd === 'string' && servingCwd !== '') {
      return servingCwd
    }
    try {
      const { getCwd } = await import('../../cwd.js')
      return getCwd()
    } catch {
      return process.cwd()
    }
  }
  if (op === 'session.root') {
    try {
      const { getProjectRoot } = await import('../../../bootstrap/state.js')
      return getProjectRoot()
    } catch {
      return process.cwd()
    }
  }
  if (op === 'session.id') {
    try {
      const { getSessionId } = await import('../../../bootstrap/state.js')
      return getSessionId()
    } catch {
      return process.env.CLAUDE_CODE_SESSION_ID ?? ''
    }
  }
  if (op === 'session.model') {
    try {
      const { getMainLoopModel } = await import('../../model/model.js')
      return getMainLoopModel()
    } catch {
      return process.env.ANTHROPIC_MODEL ?? ''
    }
  }
  if (op === 'session.surface') return 'terminal'
  if (op === 'session.surfaces') return ['terminal']
  if (op === 'session.version') {
    const version = typeof MACRO !== 'undefined' ? MACRO.VERSION : ''
    const base = version.match(/^\d+\.\d+\.\d+(?:-[a-z]+)?/)?.[0]
    const builtAt = typeof MACRO !== 'undefined' ? (MACRO.BUILD_TIME ?? '') : ''
    return {
      version,
      ...(base !== undefined && { base }),
      builtAt,
    }
  }
  if (op === 'session.turns') {
    return countSessionTurns()
  }
  if (op === 'session.messages') {
    return listSessionMessages(rec ?? {}, plugin)
  }
  if (op === 'session.repo') return null
  if (op === 'session.authorize') {
    return runSessionAuthorize(plugin)
  }
  if (op === 'session.usage') {
    const extra = rec
      ? Object.keys(rec).filter(key => key !== 'breakdown' && key !== 'columns')
      : []
    if (rec !== undefined && extra.length > 0) {
      hostCheck(
        op,
        `takes { breakdown, columns } or nothing (not ${extra.join(', ')})`,
        plugin,
      )
    }
    if (
      rec?.breakdown !== undefined &&
      rec.breakdown !== 'summary' &&
      rec.breakdown !== 'full'
    ) {
      hostCheck(
        op,
        `takes breakdown "summary" or "full" (got ${String(rec.breakdown)})`,
        plugin,
      )
    }
    if (
      rec?.columns !== undefined &&
      !(
        typeof rec.columns === 'number' &&
        Number.isInteger(rec.columns) &&
        rec.columns > 0
      )
    ) {
      hostCheck(
        op,
        `takes columns, a positive whole number (got ${String(rec.columns)})`,
        plugin,
      )
    }
    return {}
  }
  if (op === 'session.compact') {
    const instructions = rec?.instructions
    if (instructions !== undefined && typeof instructions !== 'string') {
      hostCheck(op, 'takes { instructions } (a string)', plugin)
    }
    if (rec !== undefined && Object.hasOwn(rec, 'messages')) {
      const compactReason = sessionCompactMessagesCheck(rec.messages)
      if (compactReason !== undefined) hostCheck(op, compactReason, plugin)
    }
    return runSessionCompact(
      typeof instructions === 'string' ? instructions : '',
      plugin,
    )
  }
  if (op === 'session.send') {
    const reason = sessionSendCheck(rec ?? args[0])
    if (reason !== undefined) hostCheck(op, reason, plugin)
    return runSessionSend(rec ?? {}, plugin)
  }
  if (op === 'ui.log') {
    const textCheck = hostTextCheck(rec?.text)
    if (textCheck !== undefined) hostCheck(op, textCheck, plugin)
    const toCheck = uiLogToCheck(rec?.to)
    if (toCheck !== undefined) hostCheck(op, toCheck, plugin)
    const { recordPluginUiLog, recordPluginUiLogDebug } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../pluginUiLog.js') as typeof import('../pluginUiLog.js')
    const line = String(rec?.text ?? '')
    if (rec?.to === 'debug') {
      recordPluginUiLogDebug(plugin ?? '', line)
    } else {
      recordPluginUiLog(plugin ?? '', line)
    }
    return undefined
  }
  if (op === 'ui.toast') {
    const textCheck = hostTextCheck(rec?.text)
    if (textCheck !== undefined) hostCheck(op, textCheck, plugin)
    const timeoutMs = rec?.timeoutMs
    if (
      timeoutMs !== undefined &&
      !(
        typeof timeoutMs === 'number' &&
        Number.isInteger(timeoutMs) &&
        timeoutMs > 0 &&
        timeoutMs <= UI_TOAST_TIMEOUT_MS_MAX
      )
    ) {
      hostCheck(
        op,
        `timeoutMs is a whole number of ms, 1 to ${UI_TOAST_TIMEOUT_MS_MAX}`,
        plugin,
      )
    }
    const pluginName = plugin ?? ''
    const toastText = String(rec?.text ?? '')
    const now = Date.now()
    if (
      now -
        (fhState().pluginToastLastAt.get(pluginName) ??
          Number.NEGATIVE_INFINITY) <
      UI_TOAST_COOLDOWN_MS
    ) {
      logForDebugging(
        `$.ui.toast (${pluginName}): within ${UI_TOAST_COOLDOWN_MS}ms of the last; dropped: ${toastText}`,
      )
      return undefined
    }
    fhState().pluginToastLastAt.set(pluginName, now)
    fhState().uiToastShowHandler?.({
      plugin: pluginName,
      text: toastText,
      ...(typeof timeoutMs === 'number' ? { timeoutMs } : {}),
    })
    return undefined
  }
  if (op === 'ui.notify') {
    const err = validateUiNotifyInput(rec ?? {})
    if (err !== undefined) hostCheck(op, err, plugin)
    const pluginName = plugin ?? ''
    const text = String(rec?.text ?? '')
    const title =
      typeof rec?.title === 'string' && rec.title !== ''
        ? rec.title
        : pluginName
    const notifyHandler = fhState().uiNotifyHandler
    const channel = notifyHandler
      ? await notifyHandler({
          plugin: pluginName,
          message: text,
          title,
          notificationType: 'plugin_notification',
          ...(typeof rec?.key === 'string' && { key: rec.key }),
          ...(typeof rec?.delayMs === 'number' && { delayMs: rec.delayMs }),
          ...(typeof rec?.at === 'number' && { at: rec.at }),
          ...(typeof rec?.untilBack === 'boolean' && {
            untilBack: rec.untilBack,
          }),
        })
      : 'no_surface'
    const mapped = mapUiNotifyChannel(channel, pluginName)
    logForDebugging(
      `$.ui.notify (${pluginName}): ${text.length} chars: ${mapped.isSent ? `sent by ${mapped.channel}` : mapped.reason}`,
    )
    return mapped
  }
  if (op === 'ui.cancelNotify') {
    const err = validateNotifyKey(rec?.key)
    if (err !== undefined) hostCheck(op, err, plugin)
    const pluginName = plugin ?? ''
    const cancelNotifyHandler = fhState().uiCancelNotifyHandler
    const isSent = cancelNotifyHandler
      ? Boolean(
          await cancelNotifyHandler({
            plugin: pluginName,
            key: String(rec?.key),
          }),
        )
      : false
    return { isSent }
  }
  if (op === 'ui.status') {
    if (rec?.text !== undefined) {
      const textCheck = hostTextCheck(rec.text)
      if (textCheck !== undefined) hostCheck(op, textCheck, plugin)
    }
    runUiStatus(
      plugin ?? '',
      typeof rec?.text === 'string' ? rec.text : undefined,
    )
    return undefined
  }
  if (op === 'ui.notice') {
    const id = rec?.tool_use_id
    if (typeof id !== 'string' || id === '') {
      hostCheck(op, 'takes the tool_use_id of an open call', plugin)
    }
    if (rec?.text !== undefined) {
      const textCheck = hostTextCheck(rec.text)
      if (textCheck !== undefined) hostCheck(op, textCheck, plugin)
    }
    return undefined
  }
  if (op === 'config.list') {
    try {
      const { getInitialSettings } = await import('../../settings/settings.js')
      const keys = new Set([
        ...Object.keys(getInitialSettings() ?? {}),
        ...fhState().configOverlay.keys(),
      ])
      return [...keys]
    } catch {
      return [...fhState().configOverlay.keys()]
    }
  }
  if (op === 'config.set') {
    const key = rec?.key
    const value = rec?.value
    if (typeof key !== 'string' || key === '') {
      hostCheck(
        op,
        'takes { key, value } (the key as $.config.list names it)',
        plugin,
      )
    }
    const valueCheck = configValueCheck(value)
    if (valueCheck !== undefined) hostCheck(op, valueCheck, plugin)
    fhState().configOverlay.set(key, value as ConfigOverlayValue)
    return undefined
  }
  if (op === 'flag.value') {
    const name = rec ? rec.name : args[0]
    const fallback = rec ? rec.fallback : args[1]
    if (typeof name !== 'string' || name === '') return fallback
    const raw = process.env[`FEATURE_${name}`]
    if (raw === undefined) return fallback
    return raw === '1' || raw === 'true'
  }
  if (op === 'env.get') {
    const name = rec ? rec.name : args[0]
    return typeof name === 'string' ? process.env[name] : undefined
  }
  if (op === 'env.set') {
    const name = rec ? rec.name : args[0]
    const value = rec ? rec.value : args[1]
    if (
      typeof name !== 'string' ||
      name === '' ||
      name.includes('=') ||
      name.includes('\0')
    ) {
      hostCheck(op, 'takes { name, value? } (a valid variable name)', plugin)
    }
    if (value !== undefined && typeof value !== 'string') {
      hostCheck(op, 'takes value as a string or undefined to unset', plugin)
    }
    if (isProjectScopeBlockedEnvVar(name, value)) {
      const msg = `${name} is unchanged: only the environment Claude Code starts with, or Claude Code itself, may give it this value (host rule)`
      logForDebugging(
        `${plugin !== undefined && plugin !== '' ? `${plugin}: ` : ''}$.env.set: ${msg}`,
        { level: 'warn' },
      )
      throw new Error(
        `${plugin !== undefined && plugin !== '' ? `${plugin}: ` : ''}$.env.set: ${msg}`,
      )
    }
    const mod = plugin
      ? fhState().loadedModules.find(
          m => m.name === plugin && m.status !== 'unloaded',
        )
      : undefined
    const isTrustedEnvWriter =
      mod !== undefined &&
      (mod.isManaged === true ||
        mod.tier === 'prepend' ||
        mod.tier === 'builtin' ||
        mod.tier === 'core')
    const commitTrack = isTrustedEnvWriter
      ? clearPersonalEnvSetTrack(name)
      : beginPersonalEnvSetTrack(name, mod?.pluginStorageId ?? plugin)
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
    commitTrack()
    return {}
  }
  if (op === 'prompt.media') {
    const id = rec?.id
    const offset = rec?.offset
    if (typeof id !== 'string' || id === '') {
      hostCheck(
        op,
        "takes { id } (an attachment's id, from the prompt.submit in flight)",
        plugin,
      )
    }
    if (
      offset !== undefined &&
      (typeof offset !== 'number' ||
        !Number.isSafeInteger(offset) ||
        offset < 0)
    ) {
      hostCheck(
        op,
        `takes offset, a whole number of bytes from 0 (got ${String(offset)})`,
        plugin,
      )
    }
    const mod = plugin
      ? fhState().loadedModules.find(
          m => m.name === plugin && m.status !== 'unloaded',
        )
      : undefined
    const isManaged =
      mod !== undefined &&
      (mod.isManaged === true ||
        mod.tier === 'prepend' ||
        mod.tier === 'builtin' ||
        mod.tier === 'core')
    const inFlight =
      isManaged &&
      serving?.listedMedia?.includes(id) === true &&
      serving?.isDispatching?.() === true
    if (!inFlight) return PROMPT_MEDIA_ABSENT
    const result = await readPromptMediaById(id, offset ?? 0)
    return serving?.isDispatching?.() === true ? result : PROMPT_MEDIA_ABSENT
  }
  if (op === 'session.identity') {
    const mod = plugin
      ? fhState().loadedModules.find(
          m => m.name === plugin && m.status !== 'unloaded',
        )
      : undefined
    const isManaged =
      mod !== undefined &&
      (mod.isManaged === true ||
        mod.tier === 'prepend' ||
        mod.tier === 'builtin' ||
        mod.tier === 'core')
    if (!isManaged) {
      return {
        deny: `$.session.identity answers only a mod that managed settings enable and that is loaded in place from a source they name; ${plugin ?? 'unknown'} is not one`,
      }
    }
    const { getSettingsForSource } = await import('../../settings/settings.js')
    const policy = getSettingsForSource('policySettings') as
      | { forceLoginOrgUUID?: string | string[] }
      | undefined
    const allowedOrgs = policy?.forceLoginOrgUUID
    const orgList =
      typeof allowedOrgs === 'string'
        ? [allowedOrgs]
        : Array.isArray(allowedOrgs)
          ? allowedOrgs
          : []
    const { getOauthAccountInfo } = await import('../../auth.js')
    const acct = getOauthAccountInfo()
    const orgUuid = acct?.organizationUuid
    const kind = acct
      ? 'claude.ai'
      : process.env.ANTHROPIC_API_KEY
        ? 'api-key'
        : 'none'
    if (!orgUuid || !orgList.includes(orgUuid)) {
      return { kind, isVerified: false }
    }
    return {
      kind,
      organizationId: orgUuid,
      ...(acct?.emailAddress ? { email: acct.emailAddress } : {}),
      isVerified: true,
    }
  }
  if (op === 'ui.view') {
    if (
      !isEventRecord(rec) ||
      Reflect.ownKeys(rec).some(k => k !== 'agentId') ||
      ('agentId' in rec &&
        (typeof rec.agentId !== 'string' || rec.agentId === ''))
    ) {
      hostCheck(
        op,
        'takes { agentId } (whose transcript the main view shows, by its id in $.agent.list()) or {} for the main conversation',
        plugin,
      )
    }
    const viewHostHandler = fhState().uiViewHostHandler
    if (!viewHostHandler) {
      return { deny: 'no main view here' }
    }
    if (serving?.isPersonInitiated === false) {
      return { deny: 'not person-initiated' }
    }
    const status = await viewHostHandler(
      'agentId' in rec ? { agentId: rec.agentId as string } : {},
    )
    switch (status) {
      case 'shown':
        return {}
      case 'unknown':
        return { deny: 'no agent under that id' }
      case 'hidden':
        return { deny: 'that agent is not one the tasks list shows' }
      case 'ended':
        return { deny: 'that agent has ended' }
      case 'moved':
        return { deny: 'the view moved meanwhile' }
      case 'elsewhere':
        return { deny: "that agent's transcript is not in this session" }
    }
  }
  if (op === 'clock.now') return Date.now()
  if (op === 'clock.sleep') {
    const ms = rec && typeof rec.ms === 'number' ? rec.ms : Number(args[0])
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
      hostCheck(
        op,
        `takes { ms }, a non-negative number of milliseconds (got ${String(ms)})`,
        plugin,
      )
    }
    await waitClockMs(ms, rec?.signal)
    return undefined
  }
  if (op === 'clock.after' || op === 'clock.every') {
    const ms = rec && typeof rec.ms === 'number' ? rec.ms : Number(args[0])
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
      hostCheck(
        op,
        `takes { ms }, a non-negative number of milliseconds (got ${String(ms)})`,
        plugin,
      )
    }
    await waitClockMs(ms, rec?.signal)
    return undefined
  }
  if (op === 'turn.abort') {
    return runTurnAbort(rec ?? {}, plugin)
  }
  if (op === 'prompt.submit') {
    const text = rec?.text
    if (typeof text !== 'string' || text.trim() === '') {
      hostCheck(op, 'takes { text } (a non-empty prompt)', plugin)
    }
    if (text.trimStart().startsWith('/')) {
      hostCheck(
        op,
        'submits a prompt to the model; a text beginning with / would run a command as the user; run one with $.command.run({ command })',
        plugin,
      )
    }
    const attachments = rec?.attachments
    if (Array.isArray(attachments) && attachments.length > 0) {
      hostCheck(op, 'takes text alone; attachments cannot be submitted', plugin)
    }
    const inputRefused = checkPluginInputRefusal(
      { plugin: plugin ?? '' },
      '$.prompt.submit',
    )
    if (inputRefused !== undefined) {
      return { drop: inputRefused }
    }
    return withSessionStartDedup(
      'prompt.submit',
      rec ?? {},
      plugin ?? '',
      undefined,
      () => runPromptSubmit(rec ?? {}, plugin),
    )
  }
  if (op === 'prompt.read') {
    // densable Iss.read: sU("ui_prompt_read") then requester.readPrompt,
    // else the local box. Unanswered → empty box.
    const client = attachedClientAnswering('ui_prompt_read')
    if (client) {
      const { getCurrentStructuredIO } = await import('src/cli/structuredIO.js')
      const answer = await getCurrentStructuredIO()?.requestUiPromptRead(
        client.surface,
        client.clientId,
      )
      if (!answer) return { text: '', cursor: 0 }
      return {
        text: answer.text,
        cursor: Math.min(answer.cursor, answer.text.length),
      }
    }
    const storeState = getPromptInputCursorState()
    const text =
      storeState.active || storeState.value !== ''
        ? storeState.value
        : fhState().promptBoxText
    const cursor =
      storeState.cursor !== null ? storeState.cursor : fhState().promptBoxCursor
    return { text, cursor: Math.min(Math.max(0, cursor), text.length) }
  }
  if (op === 'prompt.fill') {
    const decErr = validatePromptDecorations(rec?.decorations)
    if (decErr !== undefined) hostCheck(op, decErr, plugin)
    // densable Qit: OFr()?.write ?? no_composer. Iss.write is the remote
    // ui_prompt_fill client; unbound TUI (promptBoxBound) is OFr null.
    const text = typeof rec?.text === 'string' ? rec.text : ''
    if (text.length > UI_HOST_TEXT_MAX) return { isFilled: false }
    const client = attachedClientAnswering('ui_prompt_fill')
    if (client) {
      const { getCurrentStructuredIO } = await import('src/cli/structuredIO.js')
      const mode =
        rec?.mode === 'append' || rec?.mode === 'insert' ? rec.mode : 'replace'
      const filled = await getCurrentStructuredIO()?.requestUiPromptFill({
        surface: client.surface,
        clientId: client.clientId,
        text,
        mode,
        decorations: Array.isArray(rec?.decorations)
          ? rec.decorations
          : undefined,
      })
      return { isFilled: filled === true }
    }
    if (!fhState().promptBoxBound)
      return { isFilled: false, refusal: 'no_composer' }
    return runPromptFill(rec ?? {}, plugin)
  }
  if (op === 'prompt.suggest') {
    // densable Iss.propose: {isShown} only. No client or over 1e6 → false.
    const text = typeof rec?.text === 'string' ? rec.text : ''
    const client = attachedClientAnswering('ui_prompt_suggest')
    if (!client || text.length > UI_HOST_TEXT_MAX) return { isShown: false }
    const { getCurrentStructuredIO } = await import('src/cli/structuredIO.js')
    const shown = await getCurrentStructuredIO()?.requestUiPromptSuggest(
      client.surface,
      client.clientId,
      text,
    )
    return { isShown: shown === true }
  }
  if (
    op === 'store.get' ||
    op === 'store.set' ||
    op === 'store.delete' ||
    op === 'store.keys'
  ) {
    return runPluginStore(op, rec ?? {}, plugin)
  }
  if (op === 'audio.play') {
    return runAudioPlay(rec ?? {}, plugin)
  }
  if (op === 'audio.speak') {
    return runAudioSpeak(rec ?? {}, plugin)
  }
  if (op === 'fs.ancestors') {
    return runFsAncestors(rec ?? {}, plugin)
  }
  if (op === 'http.fetch') {
    const url = rec ? stringArg(rec.url) : stringArg(args[0])
    if (!url) hostCheck(op, 'takes a URL', plugin)
    const init = rec
      ? isEventRecord(rec.init)
        ? rec.init
        : undefined
      : isEventRecord(args[1])
        ? args[1]
        : undefined
    return fetchHttp(url, init, plugin)
  }
  if (op === 'process.run') {
    const argv = rec ? rec.argv : args[0]
    const init = rec
      ? isEventRecord(rec.init)
        ? rec.init
        : undefined
      : isEventRecord(args[1])
        ? args[1]
        : undefined
    return runProcess(argv, init, plugin)
  }
  if (op === 'process.spawn') {
    const problem = validateProcessSpawnRequest(rec)
    if (problem !== undefined) {
      hostCheck(op, problem, plugin)
    }
    const req = rec as {
      argv: string[]
      cwd?: string
      env?: Record<string, string>
      input?: string
    }
    return spawnProcessStream(req, plugin ?? 'unknown')
  }
  if (op === 'ui.ask') {
    return runUiAsk(args, plugin)
  }
  if (op === 'model.complete') {
    return runModelComplete(rec ?? {}, plugin)
  }
  if (op === 'model.classify') {
    return runModelClassify(rec ?? {}, plugin)
  }
  if (op === 'model.fork') {
    const prompt = rec ? rec.prompt : undefined
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      hostCheck(op, 'takes { prompt } (a non-empty prompt)', plugin)
    }
    return runModelFork(rec ?? {}, plugin)
  }
  if (op === 'mcp.call') {
    return runMcpCall(rec ?? {}, plugin)
  }
  if (op === 'mcp.connect') {
    return runMcpConnect(rec ?? {}, plugin)
  }
  if (op === 'telemetry.log') {
    const to = rec?.to
    if (
      rec === undefined ||
      (to !== undefined && to !== 'anthropic' && to !== 'collector')
    ) {
      hostCheck(
        'telemetry.log',
        'takes an entry ({ to?, event, ... }, to "anthropic" or "collector")',
        plugin,
      )
    }
    return dispatchTelemetryLog(
      { ...(rec ?? {}), to: to ?? 'anthropic' },
      {
        plugin,
      },
    )
  }
  if (op === 'telemetry.mark') {
    if (rec === undefined) {
      hostCheck(
        'telemetry.mark',
        'takes an entry ({ feature, kind, reason?, props? })',
        plugin,
      )
    }
    return runFunctionHookChain(
      'telemetry.mark',
      rec ?? {},
      async () => ({
        value: undefined,
      }),
      undefined,
      undefined,
      { origin: resolveHookCallOrigin(plugin) },
    )
  }
  if (op === 'agent.list') {
    return listPluginAgents()
  }
  if (op === 'agent.register') {
    const activeMod = activeHookModuleAls.getStore()
    if (
      activeMod !== undefined &&
      (!fhState().loadedModules.includes(activeMod) ||
        activeMod.status === 'unloaded')
    ) {
      const who = plugin ?? activeMod.name
      throw new Error(
        `${who}: $.agent.register refused: the hooks module that made the call is no longer loaded (it was reloaded or removed)`,
      )
    }
    return registerPluginAgent(rec ?? {}, plugin)
  }
  if (op === 'agent.spawn') {
    return withSessionStartDedup(
      'agent.spawn',
      rec ?? {},
      plugin ?? '',
      undefined,
      () => runAgentSpawn(rec ?? {}, plugin),
    )
  }
  if (op === 'command.list') {
    return listPluginCommands()
  }
  if (op === 'command.register') {
    return registerPluginCommand(rec ?? {}, plugin)
  }
  if (op === 'command.run') {
    return withSessionStartDedup(
      'command.run',
      rec ?? {},
      plugin ?? '',
      undefined,
      () => runPluginCommand(rec ?? {}, plugin),
    )
  }
  if (op === 'tool.list') {
    return runToolList(plugin)
  }
  if (op === 'tool.call') {
    return runToolCall(rec ?? {}, plugin)
  }
  if (op === 'tool.check') {
    return runToolCheck(rec ?? {}, plugin)
  }
  if (op === 'tool.register') {
    return runToolRegister(rec ?? {}, plugin)
  }
  if (op === 'interface.call') {
    return runInterfaceCall(rec ?? {}, plugin)
  }
  if (op === 'plugin.register') {
    return runPluginRegister(rec ?? {}, plugin)
  }
  if (
    op === 'ui.open' ||
    op === 'ui.close' ||
    op === 'ui.panes' ||
    op === 'ui.scroll' ||
    op === 'ui.focus' ||
    op === 'ui.copy' ||
    op === 'ui.selection' ||
    op === 'ui.blit' ||
    op === 'ui.resolve' ||
    op === 'ui.invalidate'
  ) {
    return runUiHost(op, rec ?? {}, plugin)
  }
  if (op === 'theme.set') {
    const rawArg = args[0]
    const err = themeSetCheck(rawArg)
    if (err !== undefined) hostCheck(op, err, plugin)
    return runThemeSet(rawArg as Record<string, unknown>, plugin)
  }
  if (op === 'theme.clear') {
    return runThemeClear()
  }
  if (op === 'settings.read') {
    return runSettingsRead(rec, op, plugin)
  }
  if (op === 'fs.read') {
    const path = pathFrom(args)
    if (typeof path !== 'string' || path === '') {
      if (rec !== undefined) hostCheck(op, 'takes a path', plugin)
      return undefined
    }
    const opts = !rec && isEventRecord(args[1]) ? args[1] : undefined
    const hasAs =
      (rec !== undefined && Object.hasOwn(rec, 'as')) ||
      (opts !== undefined && Object.hasOwn(opts, 'as'))
    const asMode = hasAs
      ? rec !== undefined && Object.hasOwn(rec, 'as')
        ? rec.as
        : opts?.as
      : 'text'
    if (asMode !== 'text' && asMode !== 'bytes') {
      hostCheck(op, 'as is "text" or "bytes"', plugin)
    }
    const baseCwd = await resolvePluginFsBaseCwd(rec?.cwd ?? opts?.cwd)
    const resolvedPath = resolve(baseCwd, path)
    await refusePluginFsNetworkPath(path, 'fs.read', plugin, baseCwd)
    const buf = readFileSync(resolvedPath)
    if (buf.byteLength > FS_BYTE_LIMIT) {
      const who = plugin !== undefined && plugin !== '' ? `${plugin}: ` : ''
      const reason = `the file is over the ${FS_BYTE_LIMIT}-byte limit`
      logForDebugging(
        `$.fs.read (${plugin ?? ''}): ${resolvedPath} refused: ${reason}`,
      )
      throw new Error(`${who}$.fs.read: ${path} refused: ${reason}`)
    }
    return asMode === 'bytes'
      ? { base64: buf.toString('base64') }
      : buf.toString('utf8')
  }
  if (op === 'fs.write') {
    const path = rec ? stringArg(rec.path) : stringArg(args[0])
    const text = rec ? rec.text : args[1]
    if (typeof path !== 'string' || path === '') {
      if (rec !== undefined) hostCheck(op, 'takes a path', plugin)
      return undefined
    }
    if (rec !== undefined && typeof text !== 'string') {
      hostCheck(op, 'takes the text to write', plugin)
    }
    const baseCwd = await resolvePluginFsBaseCwd(rec?.cwd)
    const resolvedPath = resolve(baseCwd, path)
    await refusePluginFsNetworkPath(path, 'fs.write', plugin, baseCwd)
    const content = typeof text === 'string' ? text : String(text ?? '')
    const byteLen = Buffer.byteLength(content, 'utf8')
    if (byteLen > FS_BYTE_LIMIT) {
      const who = plugin !== undefined && plugin !== '' ? `${plugin}: ` : ''
      const reason = `${byteLen} bytes is over the ${FS_BYTE_LIMIT}-byte limit`
      logForDebugging(
        `$.fs.write (${plugin ?? ''}): ${resolvedPath} refused: ${reason}`,
      )
      throw new Error(`${who}$.fs.write: ${path} refused: ${reason}`)
    }
    mkdirSync(dirname(resolvedPath), { recursive: true })
    writeFileSync(resolvedPath, content, 'utf8')
    logForDebugging(
      `$.fs.write (${plugin ?? ''}): ${resolvedPath} (${byteLen} bytes)`,
    )
    return undefined
  }
  if (op === 'fs.list') {
    const { readdirSync, statSync } = await import('fs')
    const baseCwd = await resolvePluginFsBaseCwd(rec?.cwd)
    const rawPath = pathFrom(args) ?? '.'
    await refusePluginFsNetworkPath(rawPath, 'fs.list', plugin, baseCwd)
    const target = resolve(baseCwd, rawPath)
    const entries = readdirSync(target, { withFileTypes: true })
    const listed: Array<{
      name: string
      kind: 'file' | 'dir' | 'other'
      size: number
      mtimeMs: number
      isLink: boolean
    }> = []
    for (const entry of entries) {
      // densable `dOe(M)` — kind from the dirent, not the follow-stat.
      const kind: 'file' | 'dir' | 'other' = entry.isFile()
        ? 'file'
        : entry.isDirectory()
          ? 'dir'
          : 'other'
      let size = 0
      let mtimeMs = 0
      if (entry.isFile()) {
        try {
          const st = statSync(join(target, entry.name))
          size = st.size
          mtimeMs = st.mtimeMs
        } catch {
          // densable `fOe(...).catch(()=>{return})` — leave size/mtime 0
        }
      }
      listed.push({
        name: entry.name,
        kind,
        size,
        mtimeMs,
        isLink: entry.isSymbolicLink(),
      })
    }
    listed.sort((a, b) => a.name.localeCompare(b.name))
    return listed
  }
  if (op === 'fs.stat') {
    const { lstatSync, realpathSync, statSync } = await import('fs')
    const rawPath = pathFrom(args)
    if (typeof rawPath !== 'string') return undefined
    const baseCwd = await resolvePluginFsBaseCwd(rec?.cwd)
    await refusePluginFsNetworkPath(rawPath, 'fs.stat', plugin, baseCwd)
    const target = resolve(baseCwd, rawPath)
    const lst = lstatSync(target)
    const isLink = lst.isSymbolicLink()
    let resolvedStat: ReturnType<typeof statSync> | undefined
    if (isLink) {
      try {
        resolvedStat = statSync(target)
      } catch {
        resolvedStat = undefined
      }
    }
    const st = resolvedStat ?? lst
    const kind: 'file' | 'dir' | 'other' = st.isFile()
      ? 'file'
      : st.isDirectory()
        ? 'dir'
        : 'other'
    const shouldResolve = rec?.resolve === true && resolvedStat !== undefined
    return {
      kind,
      size: st.size,
      mtimeMs: st.mtimeMs,
      isLink,
      isFile: st.isFile(),
      isDirectory: st.isDirectory(),
      ...(shouldResolve && { realPath: realpathSync(target) }),
    }
  }
  if (op === 'fs.exists') {
    const path = pathFrom(args)
    if (typeof path !== 'string' || path === '') return false
    const baseCwd = await resolvePluginFsBaseCwd(rec?.cwd)
    const resolvedPath = resolve(baseCwd, path)
    await refusePluginFsNetworkPath(path, 'fs.exists', plugin, baseCwd)
    return existsSync(resolvedPath)
  }
  if (op === 'state.get') {
    const key = stateKey(readStateRef(args[0], 'get'))
    const slot = fhState().pluginState.get(key)
    // densable Gpr: missing key is { value: undefined, version: 0 }
    const version = slot?.version ?? 0
    noteStateRead(key, version)
    return {
      value: slot?.value,
      version,
    }
  }
  if (op === 'state.set') {
    const key = stateKey(readStateRef(args[0], 'set'))
    const value =
      rec && 'value' in rec && args.length === 1 ? rec.value : args[1]
    const opts = isEventRecord(args[2]) ? args[2] : undefined
    const current = fhState().pluginState.get(key)
    const ifVersion = opts?.ifVersion
    if (
      typeof ifVersion === 'number' &&
      (current?.version ?? 0) !== ifVersion
    ) {
      return { isSet: false, version: current?.version ?? 0 }
    }
    const version = (current?.version ?? 0) + 1
    fhState().pluginState.set(key, { value, version })
    notifyDrawingReadersOfKeys([key])
    return { isSet: true, version }
  }
  // densable ECe: e.ops[op].run — missing op throws TypeError reading 'run'
  throw new TypeError("Cannot read properties of undefined (reading 'run')")
}
