import * as React from 'react';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import type { LocalJSXCommandContext } from '../../commands.js';
import { RemoteSkillsMenu, SkillsMenu } from '../../components/skills/SkillsMenu.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { getModelFacts } from '../../utils/model/modelFacts.js';

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  if (getIsRemoteMode()) {
    return <RemoteSkillsMenu onExit={onDone} />;
  }
  return (
    <SkillsMenu
      onExit={onDone}
      commands={context.options.commands}
      bytesPerToken={getModelFacts(context.options.mainLoopModel).bytesPerToken}
    />
  );
}
