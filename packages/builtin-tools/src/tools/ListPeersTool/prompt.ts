import { SEND_MESSAGE_TOOL_NAME } from '../SendMessageTool/constants.js'

/**
 * densable 2.1.225 IRs / K5_ — ListAgents description + prompt.
 * Proactive RC-by-name (no reply-only clause).
 */
export function getListAgentsPrompt(): string {
  return `Lists agents you can ${SEND_MESSAGE_TOOL_NAME} to — in-process subagents you spawned, other local Claude sessions on this machine, your Claude sessions running in the cloud (when this session has cloud access), and (when Remote Control is connected here) your Remote Control sessions on other machines. Names are the address: send with \`${SEND_MESSAGE_TOOL_NAME}({to: "<name>", message: "..."})\`, copying the name exactly as a row prints it. Append a row's \` [ref]\` only when the bare name is not enough — two rows share it, or an error asks you to disambiguate.`
}
