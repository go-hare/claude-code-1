/**
 * densable 2.1.248 #1 `--restricted` / `CLAUDE_CODE_RESTRICTED`.
 *
 * Gold (SEA official-248/package/claude.exe, 226708128):
 * - O2 @178589351 sha=9555f7c727a5a06d
 *   `function O2(){return Me(process.env.CLAUDE_CODE_RESTRICTED)}`
 * - Yk @178565128 sha=004e8eb906e6711a  export alias isRestrictedSession @192782090
 *   `function Yk(){return n().host.launchOptions.restrictedSession()}`
 * - c7e @178565192 sha=97529dc3fc652d06
 * - RSe @185211520 / D2n @185211537 sha=cc7c00c15a722c6a
 * - argv `if(s==="--restricted"){t.restricted=!0;continue}` @178161324
 * - env fold @178178450
 * - zin @182966251 sha=b03cfb55b35887ca
 * - Fnt @185211661 sha=e146f11b3d2d8ec3
 * - Nnt @185211740 sha=662e0b7aeda8a62a
 * - Unt @185790549 sha=77200da7ab18eb11
 * - vi @181746129
 * - Wdt @183550610
 */

import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '@claude-code/builtin-tools/tools/PowerShellTool/toolName.js'
import { WEB_FETCH_TOOL_NAME } from '@claude-code/builtin-tools/tools/WebFetchTool/prompt.js'
import { CLAUDE_IN_CHROME_MCP_SERVER_NAME } from './claudeInChrome/common.js'
import { isEnvTruthy } from './envUtils.js'
import {
  getRestrictedSession,
  setRestrictedSession,
} from '../bootstrap/state.js'
import { buildMcpToolName } from '../services/mcp/mcpStringUtils.js'

/** official RSe @185211520 */
export const RESTRICTED_BYPASS_REFUSE =
  'bypassPermissions not supported in restricted mode'

/** official Commander main-option help @191582617 */
export const RESTRICTED_OPTION_HELP =
  'Restricted mode: removes the built-in tools that run commands or code (Bash, PowerShell, REPL and the other code-running tools) and WebFetch unless --tools names them, and ignores user, project and local settings files (managed settings and --settings still apply; add --strict-mcp-config to skip MCP servers too). Also confines the file tools to the working directories (--add-dir included), refuses bypassPermissions, and lets only a person or the configured permission handler approve writes to settings, git and tool-configuration files.'

/** official agents-dispatch option help @191605275 */
export const RESTRICTED_DISPATCH_OPTION_HELP =
  'Start dispatched sessions in restricted mode'

/** official leftover-host refuse @191366444 */
export const RESTRICTED_CLOUD_SSH_REFUSE =
  'Error: --restricted cannot be enforced in a cloud, remote-environment or ssh session, which runs its tools on another machine'

/** official MMt @185034158 — Qre cloud-create refuse when Yk() */
export const RESTRICTED_CLOUD_CREATE_REFUSE =
  'Cloud sessions cannot be created from a --restricted session: they would not enforce it.'

/** official Nnt extras — leftover workspace names already used in tests */
const WORKSPACE_BASH = 'mcp__workspace__bash'
const WORKSPACE_WEB_FETCH = 'mcp__workspace__web_fetch'
const REMOTE_DEVICE_BASH = 'mcp__remote-devices__device_bash'
const IDE_EXECUTE_CODE = 'mcp__ide__executeCode'
const JAVASCRIPT_TOOL = 'javascript_tool'
const REMOTE_DEVICES = 'remote-devices'
const REMOTE_DEVICE_JS_PREFIXES = [
  'Claude_Browser__',
  'claude-in-chrome__',
  'Claude_in_Chrome__',
] as const

/** official O2 */
export function isRestrictedEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_RESTRICTED)
}

/** official Yk / isRestrictedSession */
export function isRestrictedSession(): boolean {
  return getRestrictedSession()
}

/** official c7e */
export function setRestrictedSessionFlag(value: boolean): void {
  setRestrictedSession(value)
}

/** official zin */
export function foldRestrictedLaunchOptions<T extends { restricted?: boolean }>(
  options: T,
  sessionRestricted: boolean,
): Omit<T, 'restricted'> & { restricted: boolean } {
  if (sessionRestricted && !options.restricted) {
    return { ...options, restricted: true }
  }
  return { ...options, restricted: Boolean(options.restricted) }
}

/** official D2n */
export function refuseRestrictedBypass(e: {
  restricted?: boolean
  permissionMode?: string
  allowDangerouslySkipPermissions?: boolean
}): string | undefined {
  return e.restricted &&
    (e.permissionMode === 'bypassPermissions' ||
      e.allowDangerouslySkipPermissions)
    ? RESTRICTED_BYPASS_REFUSE
    : undefined
}

/** official Fnt */
export function restrictedNamedKeepSet(tools: string[]): Set<string> {
  return tools.some(t => t.startsWith('preset:')) ? new Set() : new Set(tools)
}

/** official Nnt */
export function restrictedDenyToolNames(
  codeRunningNames: Iterable<string>,
  keep: Set<string>,
): string[] {
  const r = [...codeRunningNames, WEB_FETCH_TOOL_NAME].filter(p => !keep.has(p))
  const o = [
    ...(keep.has(BASH_TOOL_NAME) ? [] : [WORKSPACE_BASH]),
    ...(keep.has(WEB_FETCH_TOOL_NAME) ? [] : [WORKSPACE_WEB_FETCH]),
  ]
  const u = [
    buildMcpToolName(CLAUDE_IN_CHROME_MCP_SERVER_NAME, JAVASCRIPT_TOOL),
    ...REMOTE_DEVICE_JS_PREFIXES.map(p =>
      buildMcpToolName(REMOTE_DEVICES, `${p}${JAVASCRIPT_TOOL}`),
    ),
  ]
  return [...r, ...o, REMOTE_DEVICE_BASH, IDE_EXECUTE_CODE, ...u]
}

/** official Unt PowerShell always-included name */
export function restrictedAlwaysCodeRunningNames(): string[] {
  return [POWERSHELL_TOOL_NAME]
}

/** official Yk()&&{CLAUDE_CODE_RESTRICTED:"1"} @202357703 */
export function restrictedSpawnEnv():
  | { CLAUDE_CODE_RESTRICTED: '1' }
  | Record<string, never> {
  return isRestrictedSession() ? { CLAUDE_CODE_RESTRICTED: '1' } : {}
}

/**
 * leftover class sr extraArgs / setExtraArgs @189666468
 * `get extraArgs(){return Yk()?this.#t:this.#e}`
 * `setExtraArgs(e){this.#e=e,this.#t=e.includes("--restricted")?e:["--restricted",...e]}`
 */
export function restrictedDispatchExtraArgs(
  extraArgs: readonly string[] = [],
): string[] {
  if (!isRestrictedSession()) return [...extraArgs]
  if (extraArgs.includes('--restricted')) return [...extraArgs]
  return ['--restricted', ...extraArgs]
}

/** official Wdt @183550610 */
export function restrictedAttachmentOutsideMessage(path: string): string {
  return `Attachment "${path}" is outside the working directory; --restricted only sends files from inside it.`
}

/** official vi @181746129 */
export function restrictedFileToolOutsideMessage(
  path: string,
  workingDirectories: Iterable<string>,
): string {
  const dirs = Array.from(workingDirectories).join(', ')
  return `${path} is outside ${dirs}; --restricted confines the file tools to the working directory.`
}
