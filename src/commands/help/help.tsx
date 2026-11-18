import { HelpV2 } from '../../components/HelpV2/HelpV2.js';
import type { LocalJSXCommandCall } from '../../types/command.js';

export const call: LocalJSXCommandCall = async (onDone, { options: { commands } }) => {
  // Official 2.1.307 (#1088): use menuDescription in /help when present so bundled
  // skills show their short menu description rather than the long model-facing one.
  const helpCommands = commands.map(cmd =>
    cmd.type === 'prompt' && cmd.menuDescription != null && cmd.menuDescription !== ''
      ? { ...cmd, description: cmd.menuDescription }
      : cmd,
  );
  return <HelpV2 commands={helpCommands} onClose={onDone} />;
};
