/**
 * Function hooks submodule: pluginEngine
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { logForDebugging } from '../../debug.js'
import { toUiSelection } from '../uiSelectionRowHolding.js'
import vm, { type SyntheticModule } from 'vm'
import {
  AGENT_NAME_RE,
  AGENT_SPAWN_DESC_WORDS,
  AGENT_TOOL_NAME,
  ATOM_BRAND,
  CLAUDE_CODE_EXPORTS,
  DERIVED_BRAND,
  EMPTY_MODEL_USAGE,
  SUPPRESSED_PROXY_SKIP,
  UI_ASK_DEFAULTS,
  UI_ASK_HEADER_WIDTH,
  UI_ASK_MAX_OPTIONS,
  UI_ASK_MIN_OPTIONS,
  UI_ASK_NO_ANSWER_CAP,
  UPDATE_TRIES_MAX,
  _t,
  clockMs,
  cloneIn,
  configValueCheck,
  isAbortSignal,
  isEventRecord,
  normalizeModelCompleteInput,
  pickAgentRegister,
  promptFillPayload,
  sessionMessagesCheck,
  sessionMessagesPayload,
  sessionSendCheck,
  sessionSendPayload,
  storeJsonValue,
  suppressedRemovedMessage,
} from './constants.js'
import { notifyDrawingReadersOfKeys } from './faultRender.js'
import { runFunctionHookChain } from './hookChain.js'
import { handleHostOp } from './hostOp.js'
import {
  activeHookOriginAls,
  activeHookServingAls,
  fhState,
  getResolvedAnswer,
  moduleTierRank,
  noteStateRead,
  readStateRef,
  runtimeBridge,
  stateKey,
  waitForWorkerReplacement,
} from './state.js'
import type {
  DerivedMemo,
  FrozenAtom,
  FrozenDerived,
  HookOriginEntry,
  StateAtomRef,
} from './types.js'
import { fillWithheldUiResolveTable, makeUiResolveTable } from './uiResolve.js'
import { blitPayload, uiRenderArgCheck } from './uiValidation.js'

/**
 * densable `Kg` `$.agent`: list the task registry, register a plugin agent
 * as `{plugin}:{name}`, spawn the Agent tool in the background.
 */
function engineAgent(
  plugin: string,
  environmentId: string,
): Record<string, unknown> {
  return {
    list: () => hostOp(environmentId, 'agent.list', [{}]),
    register: (input: unknown) => {
      const picked = pickAgentRegister(input)
      const name = picked?.name
      if (
        picked === undefined ||
        typeof name !== 'string' ||
        !AGENT_NAME_RE.test(name)
      ) {
        return Promise.reject(
          new Error(
            `${plugin}: $.agent.register takes { name, description, prompt, ... }; name is letters, digits, _ or - (up to 64)`,
          ),
        )
      }
      return hostOp(environmentId, 'agent.register', [picked])
    },
    spawn: async (input: unknown) => {
      const rec = isEventRecord(input) ? input : undefined
      const prompt = rec?.prompt
      if (
        rec === undefined ||
        typeof prompt !== 'string' ||
        prompt.trim() === ''
      ) {
        throw new Error(
          `${plugin}: $.agent.spawn takes { prompt, ... } (a non-empty prompt)`,
        )
      }
      const description =
        typeof rec.description === 'string'
          ? rec.description
          : prompt.split(/\s+/).slice(0, AGENT_SPAWN_DESC_WORDS).join(' ')
      const raw = await hostOp(environmentId, 'agent.spawn', [
        {
          tool: AGENT_TOOL_NAME,
          prompt,
          description,
          run_in_background: true,
          ...(rec.model !== undefined && { model: rec.model }),
          ...(rec.subagentType !== undefined && {
            subagent_type: rec.subagentType,
          }),
          ...(rec.name !== undefined && { name: rec.name }),
          ...(rec.cwd !== undefined && { cwd: rec.cwd }),
        },
      ])
      const reply = isEventRecord(raw) ? raw : undefined
      const deny =
        (typeof reply?.deny === 'string' ? reply.deny : undefined) ??
        (reply?.isError === true
          ? typeof reply.text === 'string'
            ? reply.text
            : String(reply.text ?? '')
          : undefined)
      if (deny !== undefined) return { deny }
      const result = isEventRecord(reply?.result) ? reply.result : reply
      const agentId = isEventRecord(result)
        ? typeof result.agentId === 'string'
          ? result.agentId
          : undefined
        : undefined
      const resolved =
        isEventRecord(result) && typeof result.resolvedModel === 'string'
          ? result.resolvedModel
          : undefined
      const model =
        resolved ??
        (typeof rec.model === 'string' ? rec.model : undefined) ??
        'inherit'
      return {
        model,
        ...(agentId !== undefined && { agentId }),
      }
    },
  }
}

/** densable `sg` `$.config`: list() then set({ key, value }). */
function engineConfig(
  plugin: string,
  environmentId: string,
): Record<string, unknown> {
  return {
    list: () => hostOp(environmentId, 'config.list', [{}]),
    set: (input: unknown) => {
      const rec = isEventRecord(input) ? input : undefined
      const key = rec?.key
      const value = rec?.value
      if (
        typeof key !== 'string' ||
        key === '' ||
        configValueCheck(value) !== undefined
      ) {
        return Promise.reject(
          new Error(
            `${plugin}: $.config.set takes { key, value } (the key as $.config.list names it; the value a boolean, a string, a number or a list of strings)`,
          ),
        )
      }
      return hostOp(environmentId, 'config.set', [{ key, value }])
    },
  }
}

/** densable `_g` `$.settings`: read only. */
function engineSettings(
  plugin: string,
  environmentId: string,
): Record<string, unknown> {
  return {
    read: (input?: unknown) => {
      const source = isEventRecord(input) ? input.source : undefined
      const key = isEventRecord(input) ? input.key : undefined
      if (
        (input !== undefined && !isEventRecord(input)) ||
        (key !== undefined && typeof key !== 'string')
      ) {
        return Promise.reject(
          new Error(
            `${plugin}: $.settings.read takes { source }, { key } or nothing`,
          ),
        )
      }
      return hostOp(
        environmentId,
        'settings.read',
        source !== undefined ? [{ source }] : [{}],
      ).then(res => {
        if (key === undefined) return res
        if (!isEventRecord(res)) return undefined
        return Object.entries(res).find(([k]) => k === key)?.[1]
      })
    },
  }
}

/**
 * densable `ng` `$.command`: register a slash name, list session+plugin
 * commands, run by queuing `/${command}`.
 */
function engineCommand(
  plugin: string,
  environmentId: string,
): Record<string, unknown> {
  return {
    list: () => hostOp(environmentId, 'command.list', [{}]),
    register: (input: unknown) => {
      const rec = isEventRecord(input)
        ? {
            name: input.name,
            description: input.description,
            argumentHint: input.argumentHint,
            immediate: input.immediate,
          }
        : undefined
      const name = rec?.name
      if (
        rec === undefined ||
        typeof name !== 'string' ||
        !AGENT_NAME_RE.test(name)
      ) {
        return Promise.reject(
          new Error(
            `${plugin}: $.command.register takes { name, description, argumentHint?, immediate? }; name is letters, digits, _ or - (up to 64)`,
          ),
        )
      }
      const { description, argumentHint, immediate } = rec
      if (typeof description !== 'string' || description.trim() === '') {
        return Promise.reject(
          new Error(
            `${plugin}: $.command.register: ${name} needs a description (what the menu shows)`,
          ),
        )
      }
      return hostOp(environmentId, 'command.register', [
        {
          name,
          description,
          ...(argumentHint !== undefined && { argumentHint }),
          ...(immediate !== undefined && { immediate }),
        },
      ])
    },
    run: (input: unknown) => {
      const rec = isEventRecord(input)
        ? { command: input.command, args: input.args }
        : undefined
      const command = rec?.command
      if (typeof command !== 'string' || command === '') {
        return Promise.reject(
          new Error(
            `${plugin}: $.command.run takes { command, args? } (the command's name without the slash)`,
          ),
        )
      }
      return hostOp(environmentId, 'command.run', [
        { command, args: rec?.args ?? '' },
      ])
    },
  }
}

/**
 * densable `Wg` `$.tool`: register a plugin tool, list the session tools,
 * call/check through the host.
 */
function engineTool(
  plugin: string,
  environmentId: string,
): Record<string, unknown> {
  return {
    register: (input: unknown) => {
      if (
        !isEventRecord(input) ||
        typeof input.name !== 'string' ||
        !AGENT_NAME_RE.test(input.name)
      ) {
        return Promise.reject(
          new Error(
            `${plugin}: $.tool.register takes { name, description, inputSchema?, isDeferred? }; name is letters, digits, _ or - (up to 64)`,
          ),
        )
      }
      if (
        typeof input.description !== 'string' ||
        input.description.trim() === ''
      ) {
        return Promise.reject(
          new Error(
            `${plugin}: $.tool.register: ${input.name} needs a description (what the model reads)`,
          ),
        )
      }
      if (
        input.isDeferred !== undefined &&
        typeof input.isDeferred !== 'boolean'
      ) {
        return Promise.reject(
          new Error(
            `${plugin}: $.tool.register: ${input.name}'s isDeferred must be true or false`,
          ),
        )
      }
      const schema = input.inputSchema ?? { type: 'object' }
      if (!isEventRecord(schema)) {
        return Promise.reject(
          new Error(
            `${plugin}: $.tool.register: ${input.name}'s inputSchema must be a JSON schema object`,
          ),
        )
      }
      return hostOp(environmentId, 'tool.register', [
        {
          name: input.name,
          description: input.description,
          inputSchema: { type: 'object', ...schema },
          ...(input.isDeferred !== undefined && {
            isDeferred: input.isDeferred,
          }),
        },
      ])
    },
    list: () => hostOp(environmentId, 'tool.list', [{}]),
    call: async (input: unknown) => {
      if (!isEventRecord(input)) {
        throw new Error(`${plugin}: $.tool.call: input must be an object`)
      }
      if (typeof input.tool !== 'string' || input.tool.length === 0) {
        throw new Error(
          `${plugin}: $.tool.call takes the event's input: { tool, ...args }`,
        )
      }
      return hostOp(environmentId, 'tool.call', [input])
    },
    check: (input: unknown) =>
      isEventRecord(input) &&
      typeof input.tool === 'string' &&
      input.tool.length > 0 &&
      isEventRecord(input.input)
        ? hostOp(environmentId, 'tool.check', [
            { tool: input.tool, input: input.input },
          ])
        : Promise.reject(
            new Error(
              `${plugin}: $.tool.check takes { tool, input }: the tool's name and its arguments, an object`,
            ),
          ),
  }
}

/** densable `Sg` — `$.prompt`. */
function Sg(plugin: string, environmentId: string): Record<string, unknown> {
  return {
    submit: (input: unknown) => {
      const rec = isEventRecord(input) ? input : undefined
      const attachments = rec?.attachments
      // densable `Boo`: empty → slash (`JMe`) → attachments (`n&&n.length>0`).
      return _t(input, plugin, 'prompt.submit').then(text => {
        if (text.trim() === '') {
          return Promise.reject(
            new Error(
              `${plugin}: $.prompt.submit takes { text } (a non-empty prompt)`,
            ),
          )
        }
        if (text.trimStart().startsWith('/')) {
          return Promise.reject(
            new Error(
              `${plugin}: $.prompt.submit submits a prompt to the model; a text beginning with / would run a command as the user; run one with $.command.run({ command })`,
            ),
          )
        }
        if (Array.isArray(attachments) && attachments.length > 0) {
          return Promise.reject(
            new Error(
              `${plugin}: $.prompt.submit takes text alone; attachments cannot be submitted`,
            ),
          )
        }
        return hostOp(environmentId, 'prompt.submit', [{ text }])
      })
    },
    read: () => hostOp(environmentId, 'prompt.read', [{}]),
    fill: (input: unknown) =>
      promptFillPayload(input, plugin).then(payload =>
        hostOp(environmentId, 'prompt.fill', [payload]),
      ),
    suggest: (input: unknown) =>
      _t(input, plugin, 'prompt.suggest').then(text =>
        hostOp(environmentId, 'prompt.suggest', [{ text }]),
      ),
  }
}

/** densable `Gg` — `$.turn.abort`. */
function Gg(plugin: string, environmentId: string): Record<string, unknown> {
  return {
    abort: (input: unknown) => {
      const turnId = isEventRecord(input) ? input.turnId : undefined
      if (typeof turnId !== 'string' || turnId === '') {
        return Promise.reject(
          new Error(
            `${plugin}: $.turn.abort takes { turnId } (the id turn.start carried)`,
          ),
        )
      }
      return hostOp(environmentId, 'turn.abort', [{ turnId }])
    },
  }
}

/** densable `Ng` — `$.store` (string key, not `{ key }`). */
function engineStore(
  plugin: string,
  environmentId: string,
): Record<string, unknown> {
  const keyOf = (value: unknown, method: string): string => {
    if (typeof value !== 'string' || value === '') {
      throw new Error(
        `${plugin}: $.store.${method} takes a non-empty string key`,
      )
    }
    return value
  }
  return {
    get: async (key: unknown) =>
      hostOp(environmentId, 'store.get', [{ key: keyOf(key, 'get') }]),
    set: async (key: unknown, value: unknown) => {
      await hostOp(environmentId, 'store.set', [
        { key: keyOf(key, 'set'), value: storeJsonValue(value, plugin) },
      ])
    },
    delete: async (key: unknown) => {
      await hostOp(environmentId, 'store.delete', [
        { key: keyOf(key, 'delete') },
      ])
    },
    keys: () => hostOp(environmentId, 'store.keys', [{}]),
  }
}

/** densable `bd` — `$.clock` after/every take `(ms, fn)`. */
function engineClock(
  plugin: string,
  environmentId: string,
): Record<string, unknown> {
  const schedule = (
    op: 'after' | 'every',
    ms: unknown,
    fn: unknown,
    shouldRepeat: boolean,
  ): { cancel: () => void } => {
    if (typeof fn !== 'function') {
      throw new Error(`${plugin}: $.clock.${op} takes a function`)
    }
    const delay = clockMs(ms, plugin, op)
    let timer: ReturnType<typeof setTimeout> | undefined
    const handle = {
      cancel() {
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
        const at = fhState().clockCallbacks.findIndex(
          entry => entry.cancel === handle.cancel,
        )
        if (at >= 0) fhState().clockCallbacks.splice(at, 1)
      },
    }
    const tick = (): void => {
      if (timer === undefined) return
      void Promise.resolve((fn as () => unknown)()).catch((err: unknown) => {
        const why = err instanceof Error ? err.message : String(err)
        console.warn(`${plugin}: $.clock.${op}: the callback threw: ${why}`)
      })
      if (shouldRepeat) {
        timer = setTimeout(tick, delay)
      } else {
        handle.cancel()
      }
    }
    fhState().clockCallbacks.push(handle)
    void hostOp(environmentId, shouldRepeat ? 'clock.every' : 'clock.after', [
      { ms: delay },
    ]).then(() => {
      timer = setTimeout(tick, 0)
    })
    return handle
  }
  return {
    now: () => hostOp(environmentId, 'clock.now', [{}]),
    sleep: (ms: unknown, opts?: unknown) => {
      const delay = clockMs(ms, plugin, 'sleep')
      const rec = isEventRecord(opts) ? opts : undefined
      return hostOp(environmentId, 'clock.sleep', [
        {
          ms: delay,
          ...(rec?.signal !== undefined && { signal: rec.signal }),
        },
      ])
    },
    after: (ms: unknown, fn: unknown) => schedule('after', ms, fn, false),
    every: (ms: unknown, fn: unknown) => schedule('every', ms, fn, true),
  }
}

/** densable `og` `$.audio`. */
function engineAudio(
  plugin: string,
  environmentId: string,
  root?: string,
): Record<string, unknown> {
  return {
    play: (clip: unknown, opts?: unknown) => {
      const rec = isEventRecord(opts) ? opts : {}
      const signal = rec.signal
      const shouldLoop = rec.shouldLoop
      const gain = rec.gain
      if (signal !== undefined && !isAbortSignal(signal)) {
        return Promise.reject(
          new Error(
            `${plugin}: $.audio.play options.signal must be an AbortSignal`,
          ),
        )
      }
      if (shouldLoop === true && signal === undefined) {
        return Promise.reject(
          new Error(
            `${plugin}: $.audio.play with shouldLoop needs options.signal: the clip repeats until it aborts`,
          ),
        )
      }
      return hostOp(environmentId, 'audio.play', [
        {
          clip,
          shouldLoop: shouldLoop === true,
          gain,
          root,
          ...(signal !== undefined && { signal }),
        },
      ])
    },
    speak: (text: unknown, opts?: unknown) => {
      const rec = isEventRecord(opts) ? opts : undefined
      return hostOp(environmentId, 'audio.speak', [
        {
          text: String(text),
          ...(rec?.voice !== undefined && { voice: rec.voice }),
        },
      ])
    },
  }
}

/** densable `ag` `$.fs` including ancestors. */
function engineFs(environmentId: string): Record<string, unknown> {
  return {
    read: (path: unknown, opts?: unknown) => {
      const as = isEventRecord(opts) ? opts.as : undefined
      return hostOp(environmentId, 'fs.read', [{ path, as: as ?? 'text' }])
    },
    write: (path: unknown, text: unknown) =>
      hostOp(environmentId, 'fs.write', [{ path, text }]),
    list: (path: unknown = '.') => hostOp(environmentId, 'fs.list', [{ path }]),
    exists: (path: unknown) => hostOp(environmentId, 'fs.exists', [{ path }]),
    stat: (path: unknown, opts?: unknown) => {
      const resolveFlag = isEventRecord(opts) ? opts.resolve : undefined
      return hostOp(environmentId, 'fs.stat', [
        { path, resolve: resolveFlag ?? false },
      ])
    },
    ancestors: (input: unknown) => {
      const rec = isEventRecord(input) ? input : undefined
      return hostOp(environmentId, 'fs.ancestors', [
        {
          names: rec?.names,
          ...(rec?.of !== undefined && { of: rec.of }),
          ...(rec?.below !== undefined && { below: rec.below }),
        },
      ])
    },
  }
}

/**
 * densable `ex` `$.ui.ask`: question first, at most 4 options, pad Yes/No,
 * header defaults to Plugin (12 chars), host runs AskUserQuestion.
 */
async function engineUiAsk(
  plugin: string,
  environmentId: string,
  question: unknown,
  opts?: unknown,
): Promise<string> {
  if (typeof question !== 'string' || question.trim() === '') {
    throw new Error(`${plugin}: $.ui.ask takes the question first`)
  }
  const bag = Array.isArray(opts)
    ? { options: opts }
    : isEventRecord(opts)
      ? opts
      : {}
  const options = (Array.isArray(bag.options) ? bag.options : []).map(String)
  if (options.length > UI_ASK_MAX_OPTIONS) {
    throw new Error(
      `${plugin}: $.ui.ask takes at most ${UI_ASK_MAX_OPTIONS} options (got ${options.length})`,
    )
  }
  const filled =
    options.length >= UI_ASK_MIN_OPTIONS
      ? options
      : [
          ...options,
          ...UI_ASK_DEFAULTS.filter(label => !options.includes(label)).slice(
            0,
            UI_ASK_MIN_OPTIONS - options.length,
          ),
        ]
  const headerRaw = typeof bag.header === 'string' ? bag.header : 'Plugin'
  const header = headerRaw.slice(0, UI_ASK_HEADER_WIDTH)
  const raw = await hostOp(environmentId, 'ui.ask', [
    {
      tool: 'AskUserQuestion',
      questions: [
        {
          question,
          header,
          options: filled.map(label => ({ label, description: '' })),
          multiSelect: bag.multiSelect === true,
        },
      ],
    },
  ])
  const reply = isEventRecord(raw) ? raw : undefined
  const answers = isEventRecord(reply?.result)
    ? reply.result.answers
    : undefined
  const picked = isEventRecord(answers) ? answers[question] : undefined
  const restore = (value: string): string =>
    options.find(label => label === value) ?? value
  if (typeof picked === 'string') return restore(picked)
  if (Array.isArray(picked)) {
    return picked.map(value => restore(String(value))).join(', ')
  }
  const why = String(reply?.deny ?? reply?.text ?? '').slice(
    0,
    UI_ASK_NO_ANSWER_CAP,
  )
  throw new Error(
    `${plugin}: $.ui.ask: no answer (${why || 'the dialog was dismissed'})`,
  )
}

/**
 * densable `$` for one loaded module: `plugin` plus the core tables a
 * hook actually calls. `state` is in-process. `flag.value` reads
 * `FEATURE_<NAME>`. `ui` records what the hook asked to show. `session`
 * reads this process. Host ops go through the worker port, or
 * `handleHostOp` in the same thread.
 */
export function pluginEngine(
  mod: {
    name: string
    root?: string
  },
  environmentId = mod.name,
): Record<string, unknown> {
  const uiLog: unknown[] = []
  return {
    plugin: { name: mod.name, root: mod.root ?? '' },
    state: {
      async get(ref: unknown) {
        const key = stateKey(readStateRef(ref, 'get'))
        const slot = fhState().pluginState.get(key)
        // densable Gpr: missing key is { value: undefined, version: 0 }
        const version = slot?.version ?? 0
        noteStateRead(key, version)
        return {
          value: slot?.value,
          version,
        }
      },
      async set(ref: unknown, value: unknown, opts?: { ifVersion?: number }) {
        const key = stateKey(readStateRef(ref, 'set'))
        const current = fhState().pluginState.get(key)
        if (
          opts?.ifVersion !== undefined &&
          (current?.version ?? 0) !== opts.ifVersion
        ) {
          return { isSet: false, version: current?.version ?? 0 }
        }
        const version = (current?.version ?? 0) + 1
        fhState().pluginState.set(key, { value, version })
        notifyDrawingReadersOfKeys([key])
        return { isSet: true, version }
      },
    },
    flag: {
      value(name: unknown, fallback?: unknown) {
        if (typeof name !== 'string' || name === '') return fallback
        const raw = process.env[`FEATURE_${name}`]
        if (raw === undefined) return fallback
        return raw === '1' || raw === 'true'
      },
    },
    ui: {
      log(text: unknown, opts?: { to?: string }) {
        uiLog.push({
          type: 'log',
          text: String(text),
          to: opts?.to ?? 'transcript',
        })
        void hostOp(environmentId, 'ui.log', [
          { text: String(text), to: opts?.to ?? 'transcript' },
        ]).catch(() => {})
      },
      toast(text: unknown, opts?: { timeoutMs?: number }) {
        uiLog.push({
          type: 'toast',
          text: String(text),
          timeoutMs: opts?.timeoutMs,
        })
        void hostOp(environmentId, 'ui.toast', [
          {
            text: String(text),
            ...(typeof opts?.timeoutMs === 'number'
              ? { timeoutMs: opts.timeoutMs }
              : {}),
          },
        ]).catch(() => {})
      },
      notify(text: unknown, opts: Record<string, unknown> = {}) {
        return hostOp(environmentId, 'ui.notify', [
          {
            text,
            ...(opts?.title !== undefined && { title: opts.title }),
            ...(opts?.key !== undefined && { key: opts.key }),
            ...(opts?.delayMs !== undefined && { delayMs: opts.delayMs }),
            ...(opts?.at !== undefined && { at: opts.at }),
            ...(opts?.untilBack !== undefined && { untilBack: opts.untilBack }),
          },
        ])
      },
      cancelNotify(key: unknown) {
        return hostOp(environmentId, 'ui.cancelNotify', [{ key }])
      },
      status(text: unknown) {
        uiLog.push({
          type: 'status',
          text: text === undefined || text === null ? undefined : String(text),
        })
        void hostOp(environmentId, 'ui.status', [
          {
            text:
              text === undefined || text === null ? undefined : String(text),
          },
        ]).catch(() => {})
      },
      notice(toolUseId: unknown, text: unknown) {
        uiLog.push({
          type: 'notice',
          tool_use_id: toolUseId,
          text: String(text),
        })
        void hostOp(environmentId, 'ui.notice', [
          { tool_use_id: toolUseId, text: String(text) },
        ]).catch(() => {})
      },
      async ask(question: unknown, opts?: unknown) {
        return engineUiAsk(mod.name, environmentId, question, opts)
      },
      invalidate(event: unknown) {
        void hostOp(environmentId, 'ui.invalidate', [{ event }]).catch(() => {})
      },
      blit(input: unknown) {
        return hostOp(environmentId, 'ui.blit', [blitPayload(input)])
      },
      resolve(input: unknown) {
        const reason = uiRenderArgCheck(input)
        if (reason !== undefined) {
          return Promise.reject(
            new Error(`${mod.name}: $.ui.resolve ${reason}`),
          )
        }
        // In worker mode, resolve element constructors locally inside the worker
        // so functions never cross MessagePort (and press handles register in the
        // worker's pressHandlers table, invoked via PressMessage).
        if (fhState().hostOpPorts.has(environmentId) && isEventRecord(input)) {
          const surface = String(input.surface)
          const component = String(input.component)
          const stored = getResolvedAnswer(environmentId, surface, component)
          if (stored !== undefined) return Promise.resolve(stored)
          return runFunctionHookChain('ui.resolve', input, async () =>
            makeUiResolveTable(surface, mod.name),
          ).then(table => fillWithheldUiResolveTable(table, surface, mod.name))
        }
        return hostOp(environmentId, 'ui.resolve', [input])
      },
      open(input: unknown) {
        const rec = isEventRecord(input) ? input : {}
        return hostOp(environmentId, 'ui.open', [
          {
            id: rec.id,
            ...(rec.title !== undefined && { title: String(rec.title) }),
            ...(rec.focus !== undefined && { focus: rec.focus }),
            ...(rec.closeOnEscape !== undefined && {
              closeOnEscape: rec.closeOnEscape,
            }),
            ...(rec.holdToasts !== undefined && { holdToasts: rec.holdToasts }),
            ...(rec.rows !== undefined && { rows: rec.rows }),
            ...(rec.columns !== undefined && { columns: rec.columns }),
          },
        ])
      },
      close(input: unknown) {
        const rec = isEventRecord(input) ? input : {}
        return hostOp(environmentId, 'ui.close', [
          { id: rec.id, origin: { kind: 'plugin' } },
        ])
      },
      panes: () => hostOp(environmentId, 'ui.panes', [{}]),
      // densable 2.1.289: selection:()=>t("ui.selection",{})
      async selection() {
        const raw = await hostOp(environmentId, 'ui.selection', [{}])
        if (!raw || typeof raw !== 'object') return undefined
        return toUiSelection(
          raw as { text?: unknown; requestId?: unknown; instance_id?: unknown },
        )
      },
      scroll(input: unknown) {
        const rec = isEventRecord(input) ? input : {}
        return hostOp(environmentId, 'ui.scroll', [
          {
            to: rec.to,
            ...(rec.in !== undefined && { in: rec.in }),
            ...(rec.block !== undefined && { block: rec.block }),
          },
        ])
      },
      focus(input: unknown) {
        const rec = isEventRecord(input) ? input : {}
        return hostOp(environmentId, 'ui.focus', [
          { requestId: rec.requestId, key: rec.key },
        ])
      },
      copy(input: unknown) {
        const rec = isEventRecord(input) ? input : {}
        return hostOp(environmentId, 'ui.copy', [
          {
            text: rec.text,
            ...(rec.surface !== undefined && { surface: rec.surface }),
          },
        ])
      },
    },
    theme: {
      set(attributes: unknown) {
        return hostOp(environmentId, 'theme.set', [attributes])
      },
      clear() {
        return hostOp(environmentId, 'theme.clear', [{}])
      },
    },
    session: {
      messages: (input?: unknown) => {
        const reason = sessionMessagesCheck(input)
        if (reason !== undefined) {
          return Promise.reject(
            new Error(`${mod.name}: $.session.messages ${reason}`),
          )
        }
        return hostOp(environmentId, 'session.messages', [
          sessionMessagesPayload(input),
        ])
      },
      cwd: () => hostOp(environmentId, 'session.cwd', [{}]),
      root: () => hostOp(environmentId, 'session.root', [{}]),
      model: () => hostOp(environmentId, 'session.model', [{}]),
      turns: () => hostOp(environmentId, 'session.turns', [{}]),
      id: () => hostOp(environmentId, 'session.id', [{}]),
      repo: () => hostOp(environmentId, 'session.repo', [{}]),
      surface: () => hostOp(environmentId, 'session.surface', [{}]),
      surfaces: () => hostOp(environmentId, 'session.surfaces', [{}]),
      authorize: () => hostOp(environmentId, 'session.authorize', [{}]),
      usage: (input?: unknown) => {
        const rec = isEventRecord(input) ? input : undefined
        const extra = rec
          ? Object.keys(rec).filter(
              key => key !== 'breakdown' && key !== 'columns',
            )
          : []
        if (input !== undefined && (rec === undefined || extra.length > 0)) {
          return Promise.reject(
            new Error(
              `${mod.name}: $.session.usage takes { breakdown, columns } or nothing${extra.length > 0 ? ` (not ${extra.join(', ')})` : ''}`,
            ),
          )
        }
        return hostOp(environmentId, 'session.usage', [input ?? {}])
      },
      version: () => hostOp(environmentId, 'session.version', [{}]),
      send: (input: unknown) => {
        const reason = sessionSendCheck(input)
        if (reason !== undefined || !isEventRecord(input)) {
          return Promise.reject(
            new Error(`${mod.name}: $.session.send ${reason}`),
          )
        }
        return hostOp(environmentId, 'session.send', [
          sessionSendPayload(input),
        ])
      },
      compact: (input?: unknown) => {
        const instructions = isEventRecord(input)
          ? input.instructions
          : undefined
        if (
          input !== undefined &&
          (!isEventRecord(input) ||
            (instructions !== undefined && typeof instructions !== 'string'))
        ) {
          return Promise.reject(
            new Error(
              `${mod.name}: $.session.compact takes { instructions } (a string) or nothing`,
            ),
          )
        }
        return hostOp(
          environmentId,
          'session.compact',
          typeof instructions === 'string' ? [{ instructions }] : [{}],
        )
      },
    },
    audio: engineAudio(mod.name, environmentId, mod.root),
    prompt: Sg(mod.name, environmentId),
    turn: Gg(mod.name, environmentId),
    tool: engineTool(mod.name, environmentId),
    command: engineCommand(mod.name, environmentId),
    config: engineConfig(mod.name, environmentId),
    agent: engineAgent(mod.name, environmentId),
    fs: engineFs(environmentId),
    store: engineStore(mod.name, environmentId),
    clock: engineClock(mod.name, environmentId),
    http: {
      fetch: (url: unknown, init?: unknown) => {
        if (typeof url !== 'string' || url === '') {
          return Promise.reject(
            new Error(`${mod.name}: $.http.fetch takes a URL`),
          )
        }
        return hostOp(environmentId, 'http.fetch', [
          {
            url,
            ...(init === undefined
              ? {}
              : {
                  init: isEventRecord(init)
                    ? {
                        ...(init.method !== undefined && {
                          method: String(init.method),
                        }),
                        ...(init.headers !== undefined &&
                        isEventRecord(init.headers)
                          ? { headers: { ...init.headers } }
                          : {}),
                        ...(init.body !== undefined && {
                          body: String(init.body),
                        }),
                        ...(init.auth !== undefined && {
                          auth: String(init.auth),
                        }),
                        ...(init.socketPath !== undefined && {
                          socketPath: String(init.socketPath),
                        }),
                      }
                    : init,
                }),
          },
        ])
      },
    },
    process: {
      run: (argv: unknown, init?: unknown) =>
        hostOp(environmentId, 'process.run', [
          {
            argv: Array.isArray(argv) ? [...argv] : argv,
            ...(init === undefined
              ? {}
              : {
                  init: isEventRecord(init)
                    ? {
                        ...(init.cwd !== undefined && { cwd: init.cwd }),
                        ...(init.env !== undefined && { env: init.env }),
                        ...(init.stdin !== undefined && { stdin: init.stdin }),
                        ...(init.timeoutMs !== undefined && {
                          timeoutMs: init.timeoutMs,
                        }),
                      }
                    : init,
                }),
          },
        ]),
      spawn: (input: unknown) =>
        hostOp(
          environmentId,
          'process.spawn',
          isEventRecord(input)
            ? [
                {
                  argv: Array.isArray(input.argv)
                    ? [...input.argv]
                    : input.argv,
                  ...(input.cwd !== undefined && { cwd: input.cwd }),
                  ...(input.env !== undefined && { env: input.env }),
                  ...(input.input !== undefined && { input: input.input }),
                },
              ]
            : [input],
        ),
    },
    mcp: {
      call: (server: unknown, tool: unknown, callArgs: unknown = {}) =>
        hostOp(environmentId, 'mcp.call', [{ server, tool, args: callArgs }]),
      connect: (server: unknown) =>
        typeof server === 'string' && server.trim() !== ''
          ? hostOp(environmentId, 'mcp.connect', [{ server }])
          : Promise.reject(
              new Error(
                `${mod.name}: $.mcp.connect takes a server name (a non-empty string)`,
              ),
            ),
    },
    telemetry: {
      log: (entry: unknown) => {
        if (!isEventRecord(entry)) {
          return Promise.reject(
            new Error(
              `${mod.name}: $.telemetry.log takes an entry ({ to?, event, props? } or a collector record)`,
            ),
          )
        }
        const picked: Record<string, unknown> = {}
        for (const key of [
          'to',
          'event',
          'props',
          'attributes',
          'loggedAt',
          'span',
        ]) {
          if (entry[key] !== undefined) picked[key] = entry[key]
        }
        return hostOp(environmentId, 'telemetry.log', [picked])
      },
      mark: (entry: unknown) => {
        if (!isEventRecord(entry)) {
          return Promise.reject(
            new Error(
              `${mod.name}: $.telemetry.mark takes an entry ({ feature, kind, reason?, props? })`,
            ),
          )
        }
        const picked: Record<string, unknown> = {}
        for (const key of ['feature', 'kind', 'reason', 'props']) {
          if (entry[key] !== undefined) picked[key] = entry[key]
        }
        return hostOp(environmentId, 'telemetry.mark', [picked])
      },
    },
    model: {
      complete: async (input: unknown, options?: { signal?: AbortSignal }) => {
        const signal = options?.signal
        if (signal?.aborted === true) {
          return {
            isAnswered: false,
            reason: 'aborted',
            usage: { ...EMPTY_MODEL_USAGE },
          }
        }
        const normalized = isEventRecord(input)
          ? normalizeModelCompleteInput(input)
          : input
        try {
          return await hostOp(environmentId, 'model.complete', [normalized])
        } catch (err) {
          if ((signal as AbortSignal | undefined)?.aborted === true) {
            return {
              isAnswered: false,
              reason: 'aborted',
              usage: { ...EMPTY_MODEL_USAGE },
            }
          }
          throw err
        }
      },
      fork: (input: unknown) => hostOp(environmentId, 'model.fork', [input]),
      classify: (text: unknown, labels: unknown, options?: unknown) =>
        hostOp(environmentId, 'model.classify', [{ text, labels, options }]),
    },
    settings: engineSettings(mod.name, environmentId),
    env: hostTable('env', ['get', 'set'], environmentId),
    uiLog,
  }
}

/** densable hostOps: `$` methods that are not local go through the environment port. */
function hostOp(
  environmentId: string,
  op: string,
  args: unknown[],
): Promise<unknown> {
  const port = fhState().hostOpPorts.get(environmentId)
  if (!port) return handleHostOp(op, args, environmentId)
  const opId = ++fhState().hostOpCounter
  const activeOrigin = activeHookOriginAls.getStore()
  const activeFrame = activeOrigin?.at(-1)
  const registration =
    activeFrame !== undefined &&
    typeof activeFrame !== 'string' &&
    activeFrame.plugin === environmentId
      ? activeFrame.registration
      : undefined
  const activeServing = activeHookServingAls.getStore()
  return new Promise((resolve, reject) => {
    fhState().pendingHostOps.set(opId, { resolve, reject })
    port.postMessage({
      type: 'op',
      opId,
      op,
      args,
      ...(registration !== undefined && { registration }),
      ...(activeOrigin !== undefined &&
        activeOrigin.length > 0 && { hookOrigin: activeOrigin }),
      ...(activeServing !== undefined && { serving: activeServing }),
    })
  })
}

/** A namespace whose methods record the call, then go through the host port. */
function hostTable(
  namespace: string,
  methods: readonly string[],
  environmentId?: string,
): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const table: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const method of methods) {
    table[method] = async (...args: unknown[]) => {
      if (environmentId)
        return hostOp(environmentId, `${namespace}.${method}`, args)
      fhState().pluginHostCalls.push({ namespace, method, args })
      return handleHostOp(`${namespace}.${method}`, args)
    }
  }
  return table
}

/**
 * densable `Ct` — suppressed noun is a Proxy: any method rejects with Jxr.
 */
function suppressedInterface(
  noun: string,
  by: string,
): Record<string, unknown> {
  const empty = Object.freeze(Object.create(null)) as Record<string, unknown>
  return new Proxy(empty, {
    get(_target, prop) {
      if (typeof prop !== 'string' || SUPPRESSED_PROXY_SKIP.has(prop)) {
        return undefined
      }
      return async () => {
        throw new Error(suppressedRemovedMessage(`${noun}.${prop}`, by))
      }
    },
  })
}

export function finalizeOwnedTable(
  environmentId: string,
  table: unknown,
  suppressed?: unknown,
): void {
  if (fhState().finalizedEnvironments.has(environmentId)) {
    throw new Error(`${environmentId}: $ is already built`)
  }
  const identity = new Set(
    Object.keys(fhState().ownedTables.get(environmentId) ?? {}),
  )
  const next: Record<string, Record<string, unknown>> = {
    ...(fhState().ownedTables.get(environmentId) ?? {}),
  }
  if (isEventRecord(table)) {
    const incomingRank = moduleTierRank(environmentId)
    for (const [name, methods] of Object.entries(table)) {
      if (!isEventRecord(methods)) continue
      for (const [otherEnvId, otherTable] of fhState().ownedTables.entries()) {
        if (otherEnvId === environmentId) continue
        if (!Object.hasOwn(otherTable, name)) continue
        const otherRank = moduleTierRank(otherEnvId)
        if (incomingRank > otherRank) {
          logForDebugging(
            `$.${name}: ${environmentId} (higher tier) replaces conflicting user mod ${otherEnvId}`,
          )
          runtimeBridge.unloadModule(otherEnvId)
        } else {
          logForDebugging(
            `$.${name}: ${environmentId} conflicts with ${otherEnvId}; unloading ${environmentId}`,
          )
          runtimeBridge.unloadModule(environmentId)
          throw new Error(
            `${environmentId}: $.${name} is already provided by ${otherEnvId}`,
          )
        }
      }
      next[name] = { ...methods }
    }
  }
  if (isEventRecord(suppressed)) {
    for (const [name, reason] of Object.entries(suppressed)) {
      if (name === '*') continue
      if (Object.hasOwn((table as object) ?? {}, name)) continue
      if (identity.has(name)) continue
      const by =
        typeof reason === 'string'
          ? reason
          : isEventRecord(reason) && typeof reason.by === 'string'
            ? reason.by
            : String(reason)
      next[name] = suppressedInterface(name, by)
    }
  }
  for (const methods of Object.values(next)) Object.freeze(methods)
  fhState().ownedTables.set(environmentId, Object.freeze(next))
  fhState().finalizedEnvironments.add(environmentId)
}

export async function callPluginInterface(
  environmentId: string,
  call: { name: string; method: string },
  args: unknown[] = [],
  callers: unknown[] = [],
  hookOrigin?: readonly HookOriginEntry[],
): Promise<unknown> {
  if (fhState().workerReplacementPromise !== undefined) {
    await waitForWorkerReplacement('interface.call')
  }
  const resolvedOrigin = hookOrigin ?? activeHookOriginAls.getStore()
  const resolvedServing = activeHookServingAls.getStore()
  const invoke = async (): Promise<unknown> => {
    const clonedArgs = args.map(cloneIn)
    fhState().lastInterfaceCallers = [...callers]
    fhState().interfaceCallerStack.push(fhState().lastInterfaceCallers)
    try {
      const own = fhState().ownedTables.get(environmentId)
      const table = own?.[call.name]
      const method = table?.[call.method]
      if (typeof method === 'function') {
        return await method(...clonedArgs)
      }
      const engine = pluginEngine({ name: environmentId }, environmentId)
      const ns = engine[call.name]
      if (!isEventRecord(ns)) {
        throw new Error(
          `${environmentId} provides no interface named ${call.name}`,
        )
      }
      const fn = ns[call.method]
      if (typeof fn !== 'function') {
        throw new Error(
          `$.${call.name} (${environmentId}) has no method ${call.method}`,
        )
      }
      return await fn(...clonedArgs)
    } finally {
      fhState().interfaceCallerStack.pop()
    }
  }
  const runWithOrigin = () =>
    resolvedOrigin !== undefined
      ? activeHookOriginAls.run(resolvedOrigin, invoke)
      : invoke()
  return resolvedServing !== undefined
    ? activeHookServingAls.run(resolvedServing, runWithOrigin)
    : runWithOrigin()
}

function deepFrozen(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const member of Object.values(value as Record<string, unknown>)) {
    deepFrozen(member)
  }
  return Object.freeze(value)
}

function frozenRef(ref: StateAtomRef, id = ref.id): StateAtomRef {
  const { plugin, key } = ref
  return Object.freeze(id === undefined ? { plugin, key } : { plugin, key, id })
}

function hasBrand(source: unknown, brand: symbol): boolean {
  return (
    typeof source === 'object' &&
    source !== null &&
    (source as Record<symbol, unknown>)[brand] !== undefined
  )
}

function isAtom(source: unknown): source is FrozenAtom {
  return hasBrand(source, ATOM_BRAND)
}

function isDerived(source: unknown): source is FrozenDerived {
  return hasBrand(source, DERIVED_BRAND)
}

function atomValueOf(atom: FrozenAtom, stored: unknown): unknown {
  if (atom.shape === undefined) {
    return stored === undefined ? atom.initial : stored
  }
  const kept = isEventRecord(stored) ? stored : undefined
  const isSameShape = kept?.shape === atom.shape && kept.value !== undefined
  return isSameShape ? kept.value : atom.initial
}

function storedValueOf(atom: FrozenAtom, value: unknown): unknown {
  return atom.shape === undefined ? value : { shape: atom.shape, value }
}

async function peekState(
  source: unknown,
): Promise<{ value: unknown; versions: number[] }> {
  if (isAtom(source)) {
    // densable peek goes through $.state.get (Gpr missing → version 0)
    const held = (await handleHostOp('state.get', [source.ref])) as {
      value?: unknown
      version?: number
    }
    return {
      value: atomValueOf(source, held?.value),
      versions: [held?.version ?? 0],
    }
  }
  if (!isDerived(source)) {
    const ref = readStateRef(source, 'get')
    const held = (await handleHostOp('state.get', [ref])) as {
      value?: unknown
      version?: number
    }
    return { value: held?.value, versions: [held?.version ?? 0] }
  }
  const parts = await Promise.all(source.sources.map(one => peekState(one)))
  const versions = parts.flatMap(part => part.versions)
  const key = versions.join(',')
  const memo = source.memo
  if (memo.versions !== key) {
    memo.value = source.compute(...parts.map(part => part.value))
    memo.versions = key
  }
  return { value: memo.value, versions }
}

export function claudeCodeModule(context: object): SyntheticModule {
  const module = new vm.SyntheticModule(
    [...CLAUDE_CODE_EXPORTS],
    function () {
      const atom = (
        ref: StateAtomRef,
        initial: unknown,
        options?: { shape?: unknown },
      ): FrozenAtom =>
        Object.freeze({
          [ATOM_BRAND]: true,
          ref: frozenRef(ref),
          initial: deepFrozen(initial),
          ...(options?.shape !== undefined && { shape: options.shape }),
        }) as FrozenAtom
      const derive = (
        sources: unknown[],
        compute: (...values: unknown[]) => unknown,
      ): FrozenDerived => {
        const memo: DerivedMemo = {}
        return Object.freeze({
          [DERIVED_BRAND]: memo,
          memo,
          sources: Object.freeze(
            sources.map(one => {
              const isMade = isAtom(one) || isDerived(one)
              return isMade ? one : frozenRef(readStateRef(one, 'get'))
            }),
          ),
          compute,
        }) as unknown as FrozenDerived
      }
      const memberOf = (family: unknown, event: { requestId: string }) =>
        isAtom(family)
          ? (Object.freeze({
              ...family,
              [ATOM_BRAND]: true,
              ref: frozenRef(family.ref, event.requestId),
            }) as FrozenAtom)
          : frozenRef(readStateRef(family, 'get'), event.requestId)
      const read = async ($: { state: unknown }, source: unknown) =>
        (await peekState(source)).value
      const update = async (
        $: { state: unknown },
        target: unknown,
        change: (current: unknown) => unknown,
      ) => {
        const ref = isAtom(target) ? target.ref : readStateRef(target, 'set')
        for (let tries = 0; tries < UPDATE_TRIES_MAX; tries += 1) {
          const held = fhState().pluginState.get(stateKey(ref))
          const current = isAtom(target)
            ? atomValueOf(target, held?.value)
            : held?.value
          const next = change(current)
          const stored = isAtom(target) ? storedValueOf(target, next) : next
          const wrote = await handleHostOp('state.set', [
            ref,
            stored,
            { ifVersion: held?.version ?? 0 },
          ])
          if (isEventRecord(wrote) && wrote.isSet === true) return next
        }
        throw new Error(
          'update: the value was written by another every time it was read, up to the bound on tries; nothing was written',
        )
      }
      module.setExport('atom', atom)
      module.setExport('derive', derive)
      module.setExport('memberOf', memberOf)
      module.setExport('read', read)
      module.setExport('update', update)
    },
    { identifier: 'claude-code', context },
  )
  return module
}

runtimeBridge.buildPluginEngine = pluginEngine
runtimeBridge.callPluginInterface = callPluginInterface
