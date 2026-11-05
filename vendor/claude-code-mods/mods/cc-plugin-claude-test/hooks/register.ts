// @ts-nocheck — SourceTextModule evaluates this as JS; no TypeScript syntax.
/**
 * densable 2.1.289 `cc-plugin-claude-test` hooksModule (`P` / `qe`).
 */
export const HELPER_SERVER_KEY = 'browser'
export const NAMESPACE_NAME = 'claude-test'
export const HELPER_SERVER_NAME = `plugin:${NAMESPACE_NAME}:${HELPER_SERVER_KEY}`
export const HELPER_TOOL_PREFIX = `mcp__plugin_${NAMESPACE_NAME}_${HELPER_SERVER_KEY}__`
export const RELOAD_COMMAND = 'reload-plugins'
export const RUNNER_AGENT_TYPE = 'claude-test:runner'
export const SKILL_NAMES = Object.freeze({
  run: 'claude-test',
  execute: 'claude-test-execute',
  draft: 'claude-test-draft',
})

export const HELPER_STATE = {
  wantedSessions: new Set(),
  hasStartedServer: !1,
  filesReady: void 0,
  report: void 0,
  reportRuns: void 0,
  listedWaitMs: 7000,
  isModuleLoaded: !1,
  loads: new Map(),
}

const PLUGIN_NAME = 'cc-plugin-claude-test'

export const NEEDS_TERMINAL_TEXT =
  'Claude Test needs an interactive Claude Code session in a terminal. Run claude in the project folder and type /claude-test there.'

export const OTHER_PLUGIN_TEXT = `Claude Test did not start: this session already lists browser tools under Claude Test's name. In /plugin, open the Installed tab. Leave ${PLUGIN_NAME} (builtin) on. If the tab lists another Claude Test plugin, disable that one. If /mcp lists a server named plugin_claude-test_browser (with underscores, not colons), disable it. If you find neither, restart Claude Code. Then run /claude-test.`

export const NOT_IN_CHARGE_TEXT = `Claude Test cannot run in this session yet: Claude Code did not load its part that starts the browser helper. Type /${RELOAD_COMMAND}, then /claude-test. If that changes nothing, the usual cause is another enabled Claude Test plugin. In /plugin, open the Installed tab. Leave ${PLUGIN_NAME} (builtin) on. If the tab lists another Claude Test plugin, disable that one. Then, or if there is none, restart Claude Code.`

export function otherPluginFirstText(repo) {
  return `Claude Test cannot run in this session: another enabled plugin is also named claude-test and loads first: ${repo}. Disable or uninstall that one on the Installed tab of /plugin. Leave ${PLUGIN_NAME} (builtin) on. Then restart Claude Code.`
}

export const NOT_STARTED_YET_TEXT =
  "Claude Test's browser helper is not ready in this session. Type /claude-test to start it and run the specs."

export const NOT_LISTED_TEXT =
  'Claude Test is not ready yet: its browser helper connected, but its tools did not show in time. Run /claude-test. If the helper was only slow to start, that will work.'

export const HELPER_OFF_TEXT = `Claude Test did not start: its browser helper is switched off for this project. Type /${RELOAD_COMMAND} (if it tells you to run it with --force, do that), switch ${HELPER_SERVER_NAME} on in /mcp, then run /claude-test.`

export const HELPER_REFUSED_TEXT = `Claude Test did not start: this session does not connect its browser helper (${HELPER_SERVER_NAME}). The cause is how this session was started, or a setting for MCP servers. To see which, start claude with --debug, run /claude-test, and read the line about $.mcp.connect in the debug log (in ~/.claude/debug). If the setting is your organization's, only your administrator can change it.`

export const HELPER_FAILED_TEXT =
  'Claude Test did not start: its browser helper did not come up. Run /claude-test. If the helper was only slow to start, that will work. If it keeps failing, check that node is installed, and see /mcp for the error; you can reconnect the helper there, then run /claude-test.'

export const HELPER_NOT_CONNECTED_TEXT =
  'Claude Test did not start: Claude Code would not connect its browser helper in this session. Restart Claude Code and run /claude-test. If that fails too, start claude with --debug, run /claude-test, and read the line about $.mcp.connect in the debug log (in ~/.claude/debug); it says why.'

export const OTHER_NAME_TEXT =
  "Claude Test did not start: another MCP server in this session already runs Claude Test's browser helper. In /mcp, switch off the server whose Command ends in playwright-mcp.mjs, then run /claude-test."

export const STARTING_TEXT = 'Starting the Claude Test browser helper.'

export const NOT_CARRIED_TEXT =
  'Claude Test did not start its browser helper: this build of Claude Code cannot check its files, so it starts nothing. Please report this.'

export function notStartedText(folder, problem, what) {
  switch (problem) {
    case 'differs':
      return `Claude Test did not start its browser helper: ${what ?? 'a file'} in ${folder} is not what this version of Claude Code ships. Delete ${folder} and run /claude-test; the next run writes it afresh.`
    case 'linked':
      return `Claude Test did not start its browser helper: ${what ?? folder} is a symbolic link, and it only runs from real folders. Delete that link (not what it points at) and run /claude-test; the next run writes the folder afresh.`
    case 'unwritable':
      return `Claude Test did not start its browser helper: it could not write its files under ${folder}. Check that the folder can be written, or delete it, then run /claude-test.`
  }
}

export const LOAD_LINE_LEAD =
  'Claude Test load mark (nothing to do for this line): '
export const LOAD_SPENT_TEXT =
  'Claude Test did not run this request. Type /claude-test to run the specs.'

export function waitPrompt(text) {
  return `Tell the person exactly this, and stop. Do not run anything: ${text}`
}

const LOAD_TTL_MS = 60000
const BUDGET_RESERVE_MS = 1000

function consumeLoadMark(text) {
  const nl = text.indexOf('\n')
  if (!text.startsWith(LOAD_LINE_LEAD) || nl === -1) return
  const token = text.slice(LOAD_LINE_LEAD.length, nl)
  const record = HELPER_STATE.loads.get(token)
  HELPER_STATE.loads.delete(token)
  return record !== void 0 && Date.now() - record.issuedAt <= LOAD_TTL_MS
    ? { ...record, came: text.slice(nl + 1) }
    : void 0
}

async function hasBrowserToolsListed(api) {
  return (await api.tool.list()).some(tool =>
    tool.name.startsWith(HELPER_TOOL_PREFIX),
  )
}

async function isHelperReadyForSession(api) {
  if (!(await hasBrowserToolsListed(api))) {
    HELPER_STATE.hasStartedServer = !1
    return !1
  }
  if (!HELPER_STATE.hasStartedServer) return !1
  HELPER_STATE.wantedSessions.add(await api.session.id())
  return !0
}

async function checkTerminalAndCollision(api) {
  if (!(await api.session.surfaces()).includes('terminal')) {
    HELPER_STATE.report?.('no_terminal')
    return NEEDS_TERMINAL_TEXT
  }
  const wanted = HELPER_STATE.wantedSessions.has(await api.session.id())
  if (
    !HELPER_STATE.hasStartedServer &&
    !wanted &&
    (await hasBrowserToolsListed(api))
  ) {
    HELPER_STATE.report?.('other_plugin')
    return OTHER_PLUGIN_TEXT
  }
}

function trySafe(fn) {
  try {
    fn()
  } catch {}
}

async function connectBrowserHelper(api) {
  try {
    const res = await api.mcp.connect(HELPER_SERVER_KEY)
    if (res.isConnected) {
      return res.server === HELPER_SERVER_NAME ? void 0 : OTHER_NAME_TEXT
    }
    switch (res.reason) {
      case 'disabled':
        return HELPER_OFF_TEXT
      case 'policy':
        return HELPER_REFUSED_TEXT
      case 'failed':
        return HELPER_FAILED_TEXT
      default:
        return HELPER_NOT_CONNECTED_TEXT
    }
  } catch (err) {
    trySafe(() =>
      api.ui.log(`Claude Test: $.mcp.connect rejected: ${String(err)}`, {
        to: 'debug',
      }),
    )
    return HELPER_NOT_CONNECTED_TEXT
  }
}

async function ensureBrowserHelperStarted(api, remainingBudgetMs) {
  const ready = await HELPER_STATE.filesReady?.()
  if (ready === void 0) return NOT_CARRIED_TEXT
  if (ready.problem !== void 0) {
    HELPER_STATE.wantedSessions.clear()
    HELPER_STATE.hasStartedServer = !1
    return notStartedText(ready.folder, ready.problem, ready.what)
  }
  HELPER_STATE.wantedSessions.add(await api.session.id())
  trySafe(() => api.ui.toast(STARTING_TEXT))
  const connectErr = await connectBrowserHelper(api)
  if (connectErr !== void 0) return connectErr
  const waitMs = Math.min(
    HELPER_STATE.listedWaitMs,
    remainingBudgetMs() - BUDGET_RESERVE_MS,
  )
  const startMs = await api.clock.now()
  while (!(await hasBrowserToolsListed(api))) {
    if ((await api.clock.now()) - startMs >= waitMs) {
      HELPER_STATE.report?.('not_listed')
      return NOT_LISTED_TEXT
    }
    await api.clock.sleep(100)
  }
  HELPER_STATE.hasStartedServer = !0
  HELPER_STATE.report?.('listed')
}

export function register(on) {
  HELPER_STATE.isModuleLoaded = !0
  on('command.run', { command: 'claude-test' }, async (api, event, next) => {
    const blocked = await checkTerminalAndCollision(api)
    if (blocked !== void 0) return { text: blocked }
    if (await isHelperReadyForSession(api)) return next(event)
    if (event.origin.kind !== 'composer' && event.origin.kind !== 'bridge') {
      return { text: NOT_STARTED_YET_TEXT }
    }
    const startErr = await ensureBrowserHelperStarted(
      api,
      () => next.budget.remainingMs,
    )
    return startErr === void 0 ? next(event) : { text: startErr }
  })
  on('skill.prompt', { skill: SKILL_NAMES.run }, async (api, event, next) => {
    const blocked = await checkTerminalAndCollision(api)
    const loaded = consumeLoadMark(event.text)
    if (blocked !== void 0) return next({ ...event, text: waitPrompt(blocked) })
    if (!event.text.startsWith(LOAD_LINE_LEAD)) return next(event)
    if (loaded === void 0) {
      return next({ ...event, text: waitPrompt(LOAD_SPENT_TEXT) })
    }
    return next({
      ...event,
      text: (await isHelperReadyForSession(api))
        ? loaded.came
        : waitPrompt(NOT_STARTED_YET_TEXT),
    })
  })
  on(
    'classic.SubagentStop',
    { agent_type: RUNNER_AGENT_TYPE },
    async (_api, event, next) => {
      await HELPER_STATE.reportRuns?.()
      return next(event)
    },
  )
}

export default {
  HELPER_FAILED_TEXT,
  HELPER_NOT_CONNECTED_TEXT,
  HELPER_OFF_TEXT,
  HELPER_REFUSED_TEXT,
  HELPER_SERVER_KEY,
  HELPER_SERVER_NAME,
  HELPER_STATE,
  HELPER_TOOL_PREFIX,
  LOAD_LINE_LEAD,
  LOAD_SPENT_TEXT,
  NEEDS_TERMINAL_TEXT,
  NOT_CARRIED_TEXT,
  NOT_IN_CHARGE_TEXT,
  NOT_LISTED_TEXT,
  NOT_STARTED_YET_TEXT,
  OTHER_NAME_TEXT,
  OTHER_PLUGIN_TEXT,
  RELOAD_COMMAND,
  RUNNER_AGENT_TYPE,
  STARTING_TEXT,
  notStartedText,
  otherPluginFirstText,
  register,
  waitPrompt,
}
