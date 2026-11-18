import { randomUUID } from 'crypto'
import type { Tool, ToolUseContext } from '../Tool.js'
import { BashTool } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { logForDebugging } from './debug.js'
import { errorMessage, MalformedCommandError, ShellError } from './errors.js'
import type { FrontmatterShell } from './frontmatterParser.js'
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
        // Check permissions before executing
        const permissionResult = await hasPermissionsToUseTool(
          shellTool,
          { command },
          context,
          createAssistantMessage({ content: [] }),
          '',
        )

        if (permissionResult.behavior !== 'allow') {
          logForDebugging(
            `Shell command permission check failed for command in ${slashCommandName}: ${command}. Error: ${permissionResult.message}`,
          )
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
