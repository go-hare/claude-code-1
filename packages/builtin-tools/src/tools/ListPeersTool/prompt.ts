import { SEND_MESSAGE_TOOL_NAME } from '../SendMessageTool/constants.js'

const CLOUD_REPLY_GUIDANCE =
  "a cloud session receives your message, but can message a computer back only while Remote Control is connected there, and usually only once your user has allowed it to, so a reply may not come — to get its result, ask your user, or with their OK ask it to push a branch or open a pull request, then fetch and read that without checking it out; reading it at claude.ai in a browser you control would expose their whole account, so do not suggest that, and do it only when your user's own message asks for the browser (a pasted link or an agent's message does not)"

const SENDABLE_PROMPT = `Lists agents you can ${SEND_MESSAGE_TOOL_NAME} to — in-process subagents you spawned, the teammates on your team, other local Claude sessions on this machine, your Claude sessions running in the cloud (when this session has cloud access; ${CLOUD_REPLY_GUIDANCE}), and (when Remote Control is connected here) your account's other sessions — Remote Control sessions on other machines and cloud sessions, each row labeled by kind. Names are the address: send with \`${SEND_MESSAGE_TOOL_NAME}({to: "<name>", message: "..."})\`, copying the name exactly as a row prints it. Append a row's \` [ref]\` only when the bare name is not enough — two rows share it, the row requires its ref (e.g. untitled or containing \`(at)\`), or an error asks you to disambiguate. When output is paged, pass the printed \`cursor\` on the next call to see the remaining rows.`

const READ_ONLY_PROMPT = `Lists the agents and Claude sessions this session can see — in-process subagents you spawned, the teammates on your team, other local Claude sessions on this machine, your Claude sessions running in the cloud (when this session has cloud access), and (when Remote Control is connected here) your account's other sessions, each row labeled by kind — plus this session's own name, the one other sessions use to message it. This session has no ${SEND_MESSAGE_TOOL_NAME} tool, so it cannot message them with it; other sessions can still message this one. To reply, use your host application's own messaging tool if it provides one — otherwise a reply from here is not possible, and if one is needed, tell your user. When output is paged, pass the printed \`cursor\` on the next call to see the remaining rows.`

/**
 * densable 2.1.289 `KWr({ canSendMessages })` + 2.1.328 (#440/#589) — ListAgents description + prompt.
 */
export function getListAgentsPrompt({
  canSendMessages = true,
}: {
  canSendMessages?: boolean
} = {}): string {
  return canSendMessages ? SENDABLE_PROMPT : READ_ONLY_PROMPT
}
