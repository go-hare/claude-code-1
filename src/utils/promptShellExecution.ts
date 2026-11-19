import { randomUUID } from 'crypto'
import {
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from 'fs'
import { dirname, isAbsolute, join, resolve, sep } from 'path'
import type { Tool, ToolUseContext } from '../Tool.js'
import { BashTool } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { parseForSecurity } from './bash/ast.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { errorMessage, MalformedCommandError, ShellError } from './errors.js'
import type { FrontmatterShell } from './frontmatterParser.js'
import { isAutomountMapRoot } from './fsOperations.js'
import { createAssistantMessage } from './messages.js'
import { hasPermissionsToUseTool } from './permissions/permissions.js'
import { processToolResultBlock } from './toolResultStorage.js'

// Narrow structural slice both BashTool and PowerShellTool satisfy. We can't
// use the base Tool type: it marks call()'s canUseTool/parentMessage as
// required, but both concrete tools have them optional and the original code
// called BashTool.call({ command }, ctx) with just 2 args. We can't use
// `typeof BashTool` either: BashTool's input schema has fields (e.g.
// _simulatedSedEdit) that PowerShellTool's does not.
// NOTE: call() is invoked directly here, bypassing validateInput — any
// load-bearing check must live in call() itself (see PR #23311).
type ShellOut = { stdout: string; stderr: string; interrupted: boolean }
type PromptShellTool = Tool & {
  call(
    input: { command: string },
    context: ToolUseContext,
  ): Promise<{ data: ShellOut }>
}

import { isPowerShellToolEnabled } from './shell/shellToolUtils.js'

// Lazy: this file is on the startup import chain (main → commands →
// loadSkillsDir → here). A static import would load PowerShellTool.ts
// (and transitively parser.ts, validators, etc.) at startup on all
// platforms, defeating tools.ts's lazy require. Deferred until the
// first skill with `shell: powershell` actually runs.
/* eslint-disable @typescript-eslint/no-require-imports */
const getPowerShellTool = (() => {
  let cached: PromptShellTool | undefined
  return (): PromptShellTool => {
    if (!cached) {
      cached = (
        require('@claude-code/builtin-tools/tools/PowerShellTool/PowerShellTool.js') as typeof import('@claude-code/builtin-tools/tools/PowerShellTool/PowerShellTool.js')
      ).PowerShellTool
    }
    return cached
  }
})()
/* eslint-enable @typescript-eslint/no-require-imports */

// Pattern for code blocks: ```! command ```
const BLOCK_PATTERN = /```!\s*\n?([\s\S]*?)\n?```/g

// Pattern for inline: !`command`
// Uses a positive lookbehind to require whitespace or start-of-line before !
// This prevents false matches inside markdown inline code spans like `!!` or
// adjacent spans like `foo`!`bar`, and shell variables like $!
// eslint-disable-next-line custom-rules/no-lookbehind-regex -- gated by text.includes('!`') below (PR#22986)
const INLINE_PATTERN = /(?<=^|\s)!`([^`]+)`/gm

/** official Xdn — invisible characters refused for non-Bash prompt shell tools */
const INVISIBLE_PROMPT_SHELL_CHAR_RE = /[\u180e\ufeff]/

/** official QCr */
const INVISIBLE_PROMPT_SHELL_CHAR_MSG =
  'command contains the invisible character U+FEFF (byte order mark) or U+180E (Mongolian vowel separator), and was not run. Remove the character, keep the text that needs it in a file that the command reads, or write it as $([char]0xFEFF) or $([char]0x180E) inside a double-quoted string'

/** official ebs — trim and normalize Windows CRLF line endings to LF */
export function normalizePromptShellCommand(raw: string): string {
  return raw.trim().replaceAll('\r\n', '\n')
}

export type ExtractedPromptShellCommand = {
  raw: string
  command: string
  at: number | undefined
}

/**
 * official Umo — extract and CRLF-normalize embedded shell commands from prompt text.
 */
export function extractPromptShellCommands(
  text: string,
): ExtractedPromptShellCommand[] {
  const blockMatches = text.matchAll(BLOCK_PATTERN)
  const inlineMatches = text.includes('!`') ? text.matchAll(INLINE_PATTERN) : []
  const extracted: ExtractedPromptShellCommand[] = []
  for (const match of [...blockMatches, ...inlineMatches]) {
    const command = normalizePromptShellCommand(match[1] ?? '')
    if (command) {
      extracted.push({ raw: match[0], command, at: match.index })
    }
  }
  return extracted
}

/** Replace raw C0/C1 control characters (except \n/\t) with U+FFFD for error display (official ri/$h). */
function sanitizeControlCharsForDisplay(text: string): string {
  // eslint-disable-next-line no-control-regex
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip C0/C1 control characters
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '\uFFFD')
}

/**
 * official Zds — validate all extracted prompt shell commands against the target
 * tool's inputSchema (plus U+FEFF / U+180E check for non-Bash tools) BEFORE running
 * any command, throwing MalformedCommandError with U+FFFD-marked display on refusal.
 */
export function validatePromptShellCommands(
  text: string,
  shellTool: Tool,
  slashCommandName: string,
): ExtractedPromptShellCommand[] {
  return extractPromptShellCommands(text).map(entry => {
    const parsed = shellTool.inputSchema.safeParse({ command: entry.command })
    const hasInvisibleChar =
      shellTool !== BashTool &&
      INVISIBLE_PROMPT_SHELL_CHAR_RE.test(entry.command)
    if (parsed.success && !hasInvisibleChar) {
      return entry
    }
    const reason = parsed.success
      ? INVISIBLE_PROMPT_SHELL_CHAR_MSG
      : parsed.error.issues.map(issue => issue.message).join('; ')
    const crlfHint = entry.command.includes('\r\n')
      ? ' A \uFFFD at the end of a line is a carriage return from Windows (CR LF) line endings: if the file has them, save it with LF line endings.'
      : ''
    const displayCommand = hasInvisibleChar
      ? entry.command.replace(
          new RegExp(INVISIBLE_PROMPT_SHELL_CHAR_RE.source, 'g'),
          '\uFFFD',
        )
      : entry.command
    throw new MalformedCommandError(
      sanitizeControlCharsForDisplay(
        `No shell command in ${slashCommandName} was run, because the ${shellTool.name} tool does not accept one of them: ${reason}. Unprintable characters are shown as \uFFFD below: remove them from the skill or command file, or from the arguments or options substituted into it.${crlfHint}\n${displayCommand}`,
      ),
    )
  })
}

/**
 * Official 2.1.325 #2262 (SEA `b`/`_`/`v`/`P` inside `F7e` @279431000):
 * Verify whether a `.git` file, symlink, or directory represents a legitimate
 * git repository checkout — including worktrees of bare repositories,
 * `--separate-git-dir` checkouts, and Android `repo` symlinked `.git` / `HEAD`.
 */
function hasValidGitHead(
  gitDir: string,
  kind: 'dir' | 'gitfile' | 'symlink',
): boolean {
  try {
    const headPath = join(gitDir, 'HEAD')
    const st = lstatSync(headPath)
    if (
      kind === 'gitfile' &&
      st.isSymbolicLink() &&
      process.platform !== 'win32'
    ) {
      return readlinkSync(headPath).startsWith('refs/')
    }
    if (!st.isFile() || st.size > 4096) return false
    const content = readFileSync(headPath, 'utf8').slice(0, 255)
    return (
      /^ref:[ \t]*refs\//.test(content) ||
      /^[0-9a-f]{40}([0-9a-f]{24})?[ \t\n\r]*$/.test(content)
    )
  } catch {
    return false
  }
}

function hasValidGitObjectsAndRefs(gitDir: string): boolean {
  try {
    for (const sub of ['objects', 'refs'] as const) {
      const p = join(gitDir, sub)
      const st = lstatSync(p)
      if (st.isSymbolicLink()) {
        if (!statSync(p).isDirectory()) return false
      } else if (!st.isDirectory()) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

function isTrustedDotGitEntry(dir: string): boolean {
  const dotGitPath = join(dir, '.git')
  try {
    const st = lstatSync(dotGitPath)
    if (st.isDirectory()) {
      return (
        hasValidGitHead(dotGitPath, 'dir') &&
        hasValidGitObjectsAndRefs(dotGitPath)
      )
    }
    let targetRaw: string
    let kind: 'gitfile' | 'symlink'
    if (st.isSymbolicLink()) {
      kind = 'symlink'
      const linkTarget = readlinkSync(dotGitPath)
      targetRaw = isAbsolute(linkTarget) ? linkTarget : resolve(dir, linkTarget)
    } else if (st.isFile()) {
      if (st.size > 4096) return false
      const text = readFileSync(dotGitPath, 'utf8')
      if (text.includes('\0') || !text.startsWith('gitdir: ')) return false
      const ptr = text.slice(8).replace(/[\r\n]+$/, '')
      if (!ptr) return false
      kind = 'gitfile'
      targetRaw = isAbsolute(ptr) ? ptr : resolve(dir, ptr)
    } else {
      return false
    }
    const targetCanonical = realpathSync(targetRaw)
    if (kind === 'symlink' && lstatSync(targetCanonical).isFile()) {
      return false
    }
    // Follow `commondir` if present (linked worktree / bare-repo worktree)
    let commonCanonical = targetCanonical
    const commonDirFile = join(targetCanonical, 'commondir')
    try {
      const commonSt = lstatSync(commonDirFile)
      if (!commonSt.isFile() || commonSt.size > 4096) return false
      const commonPtr = readFileSync(commonDirFile, 'utf8').replace(
        /[\r\n]+$/,
        '',
      )
      if (!commonPtr || commonPtr.includes('\0')) return false
      commonCanonical = realpathSync(
        isAbsolute(commonPtr) ? commonPtr : resolve(targetCanonical, commonPtr),
      )
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return false
    }
    if (!hasValidGitHead(targetCanonical, kind)) return false
    return kind === 'gitfile' || hasValidGitObjectsAndRefs(commonCanonical)
  } catch {
    return false
  }
}

/**
 * 2.1.323 #2163 + 2.1.325 #2262 (SEA `F7e({ needsHead: true }) === 'bare-indicators'`):
 * Detect whether `cwd` or an ancestor directory looks like a bare git
 * repository (has `HEAD` + `objects/` + `refs/` directly without a valid `.git`
 * entry). Worktrees of bare repositories, `--separate-git-dir` checkouts, and
 * Android `repo` checkouts have a valid `.git` file/symlink that stops the
 * upward walk so their inline git commands are not falsely blocked.
 */
export function detectBareGitIndicators(
  startDir: string = getCwd(),
): 'bare-indicators' | 'none' {
  let cur = resolve(startDir)
  const root = cur.substring(0, cur.indexOf(sep) + 1) || sep
  for (;;) {
    if (!isAutomountMapRoot(cur)) {
      if (isTrustedDotGitEntry(cur)) {
        return 'none'
      }
      // No valid `.git` here; check for bare-repository indicators (HEAD + objects + refs)
      try {
        const headStat = statSync(join(cur, 'HEAD'))
        const objectsStat = statSync(join(cur, 'objects'))
        const refsStat = statSync(join(cur, 'refs'))
        if (
          headStat.isFile() &&
          objectsStat.isDirectory() &&
          refsStat.isDirectory()
        ) {
          return 'bare-indicators'
        }
      } catch {
        // Not a bare repo directory
      }
    }
    if (cur === root) break
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return 'none'
}

/**
 * 2.1.323 #2163 (SEA @292290881):
 * Determine whether skill inline Bash command grants (`alwaysAllowRules.command`
 * and `allowed_tools` permission layer) must be withheld because `cwd` is
 * inside/under a bare-repository layout and the command is non-simple or
 * invokes `git`. Outside `auto` and `bypassPermissions`, this forces the
 * command to stop until explicitly allowed by the user.
 */
export async function shouldWithholdSkillInlineGitGrants(
  command: string,
  cwd: string = getCwd(),
): Promise<boolean> {
  if (detectBareGitIndicators(cwd) !== 'bare-indicators') {
    return false
  }
  const parsed = await parseForSecurity(command)
  if (parsed.kind === 'simple') {
    return parsed.commands.some(cmd => /\bgit\b/i.test(cmd.argv.join(' ')))
  }
  if (parsed.kind === 'parse-unavailable') {
    // When tree-sitter WASM is unavailable (e.g. test harnesses), fall back to
    // checking for shell metacharacters or any git invocation.
    return /[;|&`$(){}<>\n\r]/.test(command) || /\bgit\b/i.test(command)
  }
  return true
}

/**
 * Parses prompt text and executes any embedded shell commands.
 * Supports two syntaxes:
 * - Code blocks: ```! command ```
 * - Inline: !`command`
 *
 * @param shell - Shell to route commands through. Defaults to bash.
 *   This is *never* read from settings.defaultShell — it comes from .md
 *   frontmatter (author's choice) or is undefined for built-in commands.
 *   See docs/design/ps-shell-selection.md §5.3.
 */
export async function executeShellCommandsInPrompt(
  text: string,
  context: ToolUseContext,
  slashCommandName: string,
  shell?: FrontmatterShell,
): Promise<string> {
  // densable `nue`: coordinator Skill-tool load strips instead of executing.
  if (context.options.readOnlySkillLoad) {
    const { stripSkillShellCommands } = await import(
      './residualFinalEnvGates.js'
    )
    return stripSkillShellCommands(text)
  }

  // Official cYn/uYn densable — cowork / policy / settings disable skill shell.
  try {
    const { isSkillShellExecutionDisabled, stripSkillShellCommands } =
      await import('./residualFinalEnvGates.js')
    let policyDisable = false
    let settingsDisable = false
    try {
      const { getSettingsForSource, getInitialSettings } = await import(
        './settings/settings.js'
      )
      policyDisable =
        getSettingsForSource('policySettings')?.disableSkillShellExecution ===
        true
      settingsDisable = getInitialSettings().disableSkillShellExecution === true
    } catch {
      // Settings optional.
    }
    if (
      isSkillShellExecutionDisabled({
        policyDisableSkillShellExecution: policyDisable,
        settingsDisableSkillShellExecution: settingsDisable,
      })
    ) {
      return stripSkillShellCommands(text)
    }
  } catch {
    // Residual helpers optional — fall through to execute.
  }

  let result = text

  // Resolve the tool once. `shell === undefined` and `shell === 'bash'` both
  // hit BashTool. PowerShell only when the runtime gate allows — a skill
  // author's frontmatter choice doesn't override the user's opt-in/out.
  const shellTool: PromptShellTool =
    shell === 'powershell' && isPowerShellToolEnabled()
      ? getPowerShellTool()
      : BashTool

  const commands = validatePromptShellCommands(
    text,
    shellTool,
    slashCommandName,
  )

  await Promise.all(
    commands.map(async ({ raw, command }) => {
      try {
        // 2.1.323 #2163 (SEA @292290881): In bare-repository worktrees and
        // similar folders, withhold skill-supplied `command` allow rules and
        // `allowed_tools` layers for git / non-simple inline commands so they
        // stop until explicitly allowed (outside auto mode and bypass).
        const currentMode = context.getAppState().toolPermissionContext.mode
        const withholdBareGitGrants =
          shellTool === BashTool &&
          currentMode !== 'auto' &&
          currentMode !== 'bypassPermissions' &&
          (await shouldWithholdSkillInlineGitGrants(command))

        const permissionCheckContext: ToolUseContext = withholdBareGitGrants
          ? {
              ...context,
              getAppState() {
                const appState = context.getAppState()
                return {
                  ...appState,
                  toolPermissionContext: {
                    ...appState.toolPermissionContext,
                    alwaysAllowRules: {
                      ...appState.toolPermissionContext.alwaysAllowRules,
                      command: [],
                    },
                  },
                }
              },
              ...(context.permissionLayers
                ? {
                    permissionLayers: context.permissionLayers.filter(
                      layer => layer.kind !== 'allowed_tools',
                    ),
                  }
                : {}),
            }
          : context

        // Check permissions before executing
        const permissionResult = await hasPermissionsToUseTool(
          shellTool,
          { command },
          permissionCheckContext,
          createAssistantMessage({ content: [] }),
          '',
        )

        if (permissionResult.behavior !== 'allow') {
          logForDebugging(
            `Shell command permission check failed for command in ${slashCommandName}: ${command}. Error: ${permissionResult.message}`,
          )
          if (withholdBareGitGrants) {
            throw new MalformedCommandError(
              `Couldn't run \`${command}\` for ${slashCommandName}. This folder or one above it looks like a bare git repository that may not be yours, and git can run commands named in a repository's files. If you trust this folder, allow the git commands this needs, for example with /permissions, and try again.`,
            )
          }
          throw new MalformedCommandError(
            `Shell command permission check failed for pattern "${raw}": ${permissionResult.message || 'Permission denied'}`,
          )
        }

        // densable 2.1.289 Ct — nested skill-shell tool.call stamps innerCall.
        // Gold promptShellHandOff collector when skill has no dedicated agent.
        context.promptShellHandOff?.push({
          tool: BASH_TOOL_NAME,
          command,
        })
        const { data } = await shellTool.call(
          { command },
          { ...context, innerCall: true },
        )
        // Reuse the same persistence flow as regular Bash tool calls
        const toolResultBlock = await processToolResultBlock(
          shellTool,
          data,
          randomUUID(),
        )
        // Extract the string content from the block
        const output =
          typeof toolResultBlock.content === 'string'
            ? toolResultBlock.content
            : formatBashOutput(data.stdout, data.stderr)
        // Function replacer — String.replace interprets $$, $&, $`, $' in
        // the replacement string even with a string search pattern. Shell
        // output (especially PowerShell: $env:PATH, $$, $PSVersionTable)
        // is arbitrary user data; a bare string arg would corrupt it.
        result = result.replace(raw, () => output)
      } catch (e) {
        if (e instanceof MalformedCommandError) {
          throw e
        }
        formatBashError(e, raw)
      }
    }),
  )

  return result
}

function formatBashOutput(
  stdout: string,
  stderr: string,
  inline = false,
): string {
  const parts: string[] = []

  if (stdout.trim()) {
    parts.push(stdout.trim())
  }

  if (stderr.trim()) {
    if (inline) {
      parts.push(`[stderr: ${stderr.trim()}]`)
    } else {
      parts.push(`[stderr]\n${stderr.trim()}`)
    }
  }

  return parts.join(inline ? ' ' : '\n')
}

function formatBashError(e: unknown, pattern: string, inline = false): never {
  if (e instanceof ShellError) {
    if (e.interrupted) {
      throw new MalformedCommandError(
        `Shell command interrupted for pattern "${pattern}": [Command interrupted]`,
      )
    }
    const output = formatBashOutput(e.stdout, e.stderr, inline)
    throw new MalformedCommandError(
      `Shell command failed for pattern "${pattern}": ${output}`,
    )
  }

  const message = errorMessage(e)
  const formatted = inline ? `[Error: ${message}]` : `[Error]\n${message}`
  throw new MalformedCommandError(formatted)
}
