import { type Command, findCommand, getCommandName, isCommandEnabled } from '../../commands.js';
import { HelpV2 } from '../../components/HelpV2/HelpV2.js';
import type { LocalJSXCommandCall } from '../../types/command.js';

const COMMANDS_DOCS_URL = 'https://code.claude.com/docs/en/commands';

/**
 * Official 2.1.326 #130 (`Qe` / `commandUsage`): format concise single-command
 * usage output for `/help <command>` and `/<command> --help`.
 */
export function formatCommandUsage(command: Command): string {
  const name = getCommandName(command);
  const aliases = command.aliases?.map(alias => `/${alias}`).join(', ');
  const description =
    command.type === 'prompt' && command.menuDescription != null && command.menuDescription !== ''
      ? command.menuDescription
      : command.description;
  const isBuiltin = command.type !== 'prompt' || command.source === 'builtin' || command.source === 'bundled';
  return [
    `/${name} ${command.argumentHint ?? ''}`,
    description,
    aliases ? `Also: ${aliases}` : '',
    isBuiltin ? `Docs: ${COMMANDS_DOCS_URL}` : '',
  ]
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export const call: LocalJSXCommandCall = async (onDone, { options: { commands } }, args) => {
  // Official 2.1.326 #130: `/help <command>` prints usage directly without opening the modal.
  const target = (args ?? '').trim().replace(/^\//, '');
  if (target) {
    const matched = findCommand(target, commands);
    if (matched && isCommandEnabled(matched)) {
      onDone(formatCommandUsage(matched), { display: 'displayOnly' });
      return null;
    }
  }

  // Official 2.1.307 (#1088): use menuDescription in /help when present so bundled
  // skills show their short menu description rather than the long model-facing one.
  const helpCommands = commands.map(cmd =>
    cmd.type === 'prompt' && cmd.menuDescription != null && cmd.menuDescription !== ''
      ? { ...cmd, description: cmd.menuDescription }
      : cmd,
  );
  return <HelpV2 commands={helpCommands} onClose={onDone} />;
};
