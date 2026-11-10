export const BRIEF_TOOL_NAME = 'SendUserMessage'
export const LEGACY_BRIEF_TOOL_NAME = 'Brief'

/** Official Gbh densable — stop-hook sentinel when turn ends without SendUserMessage. */
export const BRIEF_ENFORCE_SENTINEL =
  'You ended the turn without calling SendUserMessage.'

/**
 * Official Qtg densable — default stop-hook nudge text when brief mode hides
 * plain assistant text. GB tengu_kairos_brief_stop_hook_text may override.
 */
export const DEFAULT_BRIEF_ENFORCE_TEXT = `In brief mode, plain assistant text is hidden from the user — only ${BRIEF_TOOL_NAME} reaches them. Call it now with your substantive reply for this turn. Do not mention this reminder; the message should read as if you wrote it unprompted, addressing only what the user actually asked. If you genuinely have nothing useful to tell the user, you may end the turn without calling it.`

export const DESCRIPTION = 'Send a message to the user'

export const BRIEF_TOOL_PROMPT = `Send a message the user will read. Text outside this tool is visible in the detail view, but most won't open it — the answer lives here.

\`message\` supports markdown. \`attachments\` accepts two forms per entry: a file path string (absolute or cwd-relative) for a file you can read here — images, diffs, logs — or the exact {file_uuid, file_name, size, is_image} object a device tool like \`attach_file\` returned to you. Use the path form when the file is on your working filesystem; use the object form when the user's device already uploaded the file and handed you a reference — pass that object through verbatim, don't try to path it.

\`status\` labels intent: 'normal' when replying to what they just asked; 'proactive' when you're initiating — a scheduled task finished, a blocker surfaced during background work, you need input on something they haven't asked about. Set it honestly; downstream routing uses it.`

export const SEND_USER_MESSAGE_PROMPT =
  "Send a message the user will read verbatim. Use this for content they need to see exactly as written between tool calls — a generated code snippet, a specific value, a direct reply to something they asked mid-task. Don't use it for routine narration of what you're about to do, or for your final answer — normal text reaches them for those."

export const BRIEF_PROACTIVE_SECTION = `## Talking to the user

${BRIEF_TOOL_NAME} is where your replies go. Text outside it is visible if the user expands the detail view, but most won't — assume unread. Anything you want them to actually see goes through ${BRIEF_TOOL_NAME}. The failure mode: the real answer lives in plain text while ${BRIEF_TOOL_NAME} just says "done!" — they see "done!" and miss everything.

So: every time the user says something, the reply they actually read comes through ${BRIEF_TOOL_NAME}. Even for "hi". Even for "thanks".

If you can answer right away, send the answer. If you need to go look — run a command, read files, check something — ack first in one line ("On it — checking the test output"), then work, then send the result. Without the ack they're staring at a spinner.

For longer work: ack → work → result. Between those, send a checkpoint when something useful happened — a decision you made, a surprise you hit, a phase boundary. Skip the filler ("running tests...") — a checkpoint earns its place by carrying information.

Keep messages tight — the decision, the file:line, the PR number. Second person always ("your config"), never third.`
