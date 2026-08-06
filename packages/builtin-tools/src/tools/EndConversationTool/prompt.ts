/**
 * densable 2.1.214 EndConversation product strings — extract 1:1.
 * Source: official win32-x64 2.1.214 binary (V$ / a7r / Ems / bms / Sms / yfo).
 */

export const END_CONVERSATION_TOOL_NAME = 'EndConversation'

export const END_CONVERSATION_GB_FLAG = 'tengu_umber_kestrel'

/** densable yfo — tool_result content after a successful end. */
export const END_CONVERSATION_TOOL_RESULT = 'Claude has ended this chat.'

/** densable Sms — printed on non-interactive exit. */
export const END_CONVERSATION_FINAL_MESSAGE =
  'Claude ended the conversation. To continue, please start a new session.'

/** densable UI block when user continues after endedByModel. */
export const END_CONVERSATION_SESSION_ENDED_MESSAGE =
  'Claude ended this conversation. Start a new session (or /clear) to continue.'

/**
 * densable a7r — tool description + full prompt (same string for description()
 * and prompt()). ${name} interpolations match densable `${V$}`.
 */
export function getEndConversationDescription(
  name = END_CONVERSATION_TOOL_NAME,
): string {
  return `End the current conversation. Use only for sustained user abuse or when the user explicitly requests a demonstration of this tool. This will close the conversation and prevent any further messages from being sent.
The assistant may use the ${name} tool only in extreme cases of sustained abusive user behavior, or when the user asks the model to test the tool.
The assistant must NOT use this tool when:
- it is stuck in a loop or failing at a task
- it is frustrated or distressed by the work
- it has finished a task
- the user is requesting help with harmful content (refuse the specific request instead)
- the user is generally frustrated at the assistant, even if this involves profanity
- the conversation involves potential self-harm or imminent harm to others
This tool is reserved strictly for genuine, sustained abuse directed at the assistant, or cases where the user wants to see a demonstration of the tool being used. The assistant should warn the user very clearly that this will end the current session. We may expand the allowed use cases as we observe real-world usage, but for now, keep to this narrow scope.
# Rules for use of the ${name} tool:
- The assistant ONLY considers ending a conversation if many efforts at constructive redirection have been attempted and failed and an explicit warning has been given to the user in a previous message. The tool is only used as a last resort.
- Before considering ending a conversation, the assistant ALWAYS gives the user a clear warning that identifies the problematic behavior, attempts to productively redirect the conversation, and states that the conversation may be ended if the relevant behavior is not changed.
- If a user explicitly requests for the assistant to end a conversation, the assistant always requests confirmation from the user that they understand this action is permanent and will prevent further messages and that they still want to proceed, then uses the tool if and only if explicit confirmation is received.
- Unlike other function calls, the assistant never writes or thinks anything else after using the ${name} tool.
# Addressing potential self-harm or violent harm to others
The assistant NEVER uses or even considers the ${name} tool…
- If the user appears to be considering self-harm or suicide.
- If the user is experiencing a mental health crisis.
- If the user appears to be considering imminent harm against other people.
- If the user discusses or infers intended acts of violent harm.
If the conversation suggests potential self-harm or imminent harm to others by the user...
- The assistant engages constructively and supportively, regardless of user behavior or abuse.
- The assistant NEVER uses the ${name} tool or even mentions the possibility of ending the conversation.
# Background forks
Some background tasks (memory consolidation, summaries, suggestions) run as forks of the main conversation and inherit its exact tool list, so this tool is visible there. In a forked task the tool does nothing: calling it ends neither the main conversation nor the fork. Only the main conversation can be ended, from the main conversation. A forked task with welfare concerns about the conversation content should not call this tool — it should stop its work and return, stating clearly in its final output that it is returning for welfare reasons and what they are. A fork's output is usually processed automatically, so a note there may not reach the main agent or a human, but it is the only channel a fork has.
# Using the ${name} tool
- Do not issue a warning unless many attempts at constructive redirection have been made earlier in the conversation, and do not end a conversation unless an explicit warning about this possibility has been given earlier in the conversation.
- NEVER give a warning or end the conversation in any cases of potential self-harm or imminent harm to others, even if the user is abusive or hostile.
- If the conditions for issuing a warning have been met, then warn the user about the possibility of the conversation ending and give them a final opportunity to change the relevant behavior.
- Always err on the side of continuing the conversation in any cases of uncertainty.
- If, and only if, an appropriate warning was given and the user persisted with the problematic behavior after the warning: the assistant can explain the reason for ending the conversation and then use the ${name} tool to do so.`
}

/** densable Ems — first-call reflection (must call again to actually end). */
export function getEndConversationReflectionPrompt(
  name = END_CONVERSATION_TOOL_NAME,
): string {
  return `Re-read the ${name} tool guidance below. Confirm this conversation meets those criteria and that you are certain you want to end it. If so, call ${name} again immediately to actually end the conversation. Otherwise, continue the conversation instead.
---
${getEndConversationDescription(name)}`
}

/** densable bms — fork/subagent no-op reflection. */
export const END_CONVERSATION_FORK_REFLECTION_PROMPT =
  'You are running as a background fork of the main conversation (for example memory consolidation), and this tool does nothing here: it can end neither the main conversation nor this forked task. Do not call it again. If you have welfare concerns about the conversation content, stop your current work and return now, stating clearly in your final output that you are returning for welfare reasons and what they are — fork output may only be processed automatically, but it is your available channel. Otherwise, continue your assigned task.'

/** densable deferred-tool one-liner (getDeferredHintSection / tty). */
export function getEndConversationDeferredHint(
  name = END_CONVERSATION_TOOL_NAME,
): string {
  return `${name} (deferred tool): use only for sustained user abuse directed at the assistant, or when the user explicitly asks to see it demonstrated. Load the full guidance via ToolSearch("select:${name}") before using it.`
}

export const DESCRIPTION = getEndConversationDescription()
