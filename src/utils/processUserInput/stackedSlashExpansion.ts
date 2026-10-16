/**
 * densable 2.1.289 stacked slash expansion (`kt` @208163281, limit `tt=5`).
 * Semantic names only — never export minify `kt`.
 */
import type {
  Command,
  CommandBase,
  PromptCommand,
} from '../../types/command.js'
import { getCommandName, isCommandEnabled } from '../../types/command.js'
import { parseSlashCommand } from '../slashCommandParsing.js'
import {
  isSkillFullyDisabledByOverride,
  resolveSkillOverrideMode,
} from '../residualFinalEnvGates.js'
import { getInitialSettings } from '../settings/settings.js'

/** densable `tt=5`. */
export const STACKED_SLASH_LIMIT = 5

export type StackedSlashParse = {
  stacked: Array<CommandBase & PromptCommand>
  trailingArgs: string
  capped: boolean
}

function isPromptCommand(
  command: Command,
): command is CommandBase & PromptCommand {
  return command.type === 'prompt'
}

/** densable `BP(e){return uR(e)==="off"}`. */
function isSkillOverrideOff(command: Command): boolean {
  return isSkillFullyDisabledByOverride(
    resolveSkillOverrideMode(command, {
      skillOverrides: getInitialSettings().skillOverrides,
      settingsDisableBundledSkills: getInitialSettings().disableBundledSkills,
    }),
  )
}

/**
 * densable `kt(e,s,o,u)`.
 * Early-empty when reconstructed args AND skip filter are both unset.
 */
export function parseStackedSlashCommands(
  args: string,
  reconstructedArgs: string | undefined,
  commands: Command[],
  skip?: (command: CommandBase & PromptCommand) => boolean,
): StackedSlashParse {
  if (reconstructedArgs === undefined && skip === undefined) {
    return { stacked: [], trailingArgs: args, capped: false }
  }
  const stacked: Array<CommandBase & PromptCommand> = []
  let remaining = args
  let reconstructed = reconstructedArgs
  let capped = false
  for (let i = 0; ; i++) {
    const trimmed = remaining.trimStart()
    if (!trimmed.startsWith('/')) break
    if (i >= STACKED_SLASH_LIMIT) {
      capped = true
      break
    }
    const parsed = parseSlashCommand(trimmed)
    if (!parsed) break
    let reconstructedForThis = reconstructed
    if (reconstructed !== undefined) {
      const reconTrimmed = reconstructed.trimStart()
      const reconParsed = reconTrimmed.startsWith('/')
        ? parseSlashCommand(reconTrimmed)
        : undefined
      if (!reconParsed || reconParsed.commandName !== parsed.commandName) break
      reconstructedForThis = reconParsed.args
    }
    const found = commands.find(
      cmd =>
        cmd.name === parsed.commandName ||
        getCommandName(cmd) === parsed.commandName ||
        cmd.aliases?.includes(parsed.commandName),
    )
    if (
      !found ||
      !isPromptCommand(found) ||
      found.context === 'fork' ||
      found.getContext !== undefined ||
      found.argsMayContainSlashCommands ||
      found.userInvocable === false ||
      !isCommandEnabled(found) ||
      isSkillOverrideOff(found)
    ) {
      break
    }
    remaining = parsed.args
    reconstructed = reconstructedForThis
    if (skip?.(found)) continue
    stacked.push(found)
  }
  return { stacked, trailingArgs: remaining, capped }
}

/** densable first-command gate: fork / getContext / argsMayContainSlashCommands skip kt. */
export function shouldParseStackedSlash(
  command: CommandBase & PromptCommand,
): boolean {
  return (
    command.context !== 'fork' &&
    command.getContext === undefined &&
    command.argsMayContainSlashCommands !== true
  )
}
