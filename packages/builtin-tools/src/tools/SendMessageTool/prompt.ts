import { feature } from 'bun:bundle'

export const DESCRIPTION = 'Send a message to another agent'

/**
 * densable 2.1.232 T5f SendMessage prompt.
 * Cross-session bare-name gold: unique live name delivers directly; optional
 * ` [ref]` only when ambiguous; bare name wins over same-named peer when an
 * in-process agent shares the name (tryDeliverToLocalAgent before peers).
 */
export function getPrompt(): string {
  // densable T5f: when ig() (cross-session inbox), add ListAgents-oriented rows.
  // Local also documents legacy scheme addresses + LAN when those features are on.
  const listAgentsRows = feature('UDS_INBOX')
    ? `
| \`"worker"\` | Any agent from \`ListAgents\` — subagent, another local Claude session |
| \`"worker [3fa9c1]"\` | Same, plus its \`[ref]\` — only when a listing or an error shows one |`
    : ''
  const schemeRows = feature('UDS_INBOX')
    ? `
| \`"uds:/path/to.sock"\` | Local Claude session's socket (same machine; use \`ListAgents\`) |
| \`"bridge:session_..."\` | Remote Control peer session (cross-machine; use \`ListAgents\`) |${
        feature('LAN_PIPES')
          ? `
| \`"tcp:<host>:<port>"\` | LAN peer (use \`ListAgents\`) |`
          : ''
      }`
    : ''
  const udsSection = feature('UDS_INBOX')
    ? `

## Cross-session

Use \`ListAgents\` to discover targets. Every row leads with the agent's \`name [ref]\` — the name IS the address; there is no separate address syntax.

\`\`\`json
{"to": "worker", "message": "check if tests pass over there"}
{"to": "worker [3fa9c1]", "message": "you, specifically"}
\`\`\`

Send the bare name — a name that exactly matches one live agent or session (on this machine, on another machine, or in the cloud) delivers directly. Append the \` [ref]\` only when the bare name is not enough — \`ListAgents\` shows two rows with it, or an error asks you to disambiguate (you typed only a prefix, or a session list could not be checked). A ref you did not just read from a listing or an error will not resolve, and if the same name also names an in-process agent, the bare name always wins — use the in-process one.

A listed peer is alive and will process your message — no "busy" state; messages enqueue and drain at the receiver's next tool round (\`ListAgents\` row says whether it is busy or idle right now). Your message arrives wrapped as \`<cross-session-message from="...">\`. **To reply to an incoming message, copy its \`from\` attribute as your \`to\`.**

To hear when a session ON THIS MACHINE finishes what it is doing, pass \`notify_when_idle: true\` (from the main conversation only) — one-shot and opt-in: exactly one \`[Cross-session idle notice]\` arrives when it next goes idle (or exits) — shown to you, or only to your user when this session holds peer messages for approval (the tool result says which); if it never signals within the subscription's lifetime (it may still be busy, may refuse inbound requests, or may have ended abruptly) the notice says the subscription expired instead. Omit \`message\` for a pure subscription that costs that session nothing; include one to deliver it now AND subscribe. Never poll \`ListAgents\` in a loop or send "are you done?" messages instead.

Permission boundaries are per-session: NEVER ask a peer to perform an action that was denied or blocked in your session, or that you expect your own permission settings would block — a peer doing it for you bypasses the user's permission decision (cross-session permission laundering). Route blocked work back to your user instead.`
    : ''
  return `
# SendMessage

Send a message to another agent.

\`\`\`json
{"to": "researcher", "summary": "assign task 1", "message": "start on task #1"}
\`\`\`

| \`to\` | |
|---|---|
| \`"researcher"\` | Teammate by name |
| \`"main"\` | The main conversation (background subagents only) |
| \`"*"\` | Broadcast to all teammates — expensive (linear in team size), use only when everyone genuinely needs it |${listAgentsRows}${schemeRows}

Your plain text output is NOT visible to other agents — to communicate, you MUST call this tool. Messages from teammates are delivered automatically; you don't check an inbox. Refer to agents by name — names keep working after an agent completes (a send resumes it from its transcript and **waits for that resume turn to finish**, then returns a short \`Resumed agent … Result:\` / \`Resuming agent …\` status). Use the raw \`agentId\` (format \`a...-...\`) from its spawn result only when the agent has no name, or when a newer agent took the name (latest wins). When relaying, don't quote the original — it's already rendered to the user.${udsSection}

## Protocol responses (legacy)

If you receive a JSON message with \`type: "shutdown_request"\` or \`type: "plan_approval_request"\`, respond with the matching \`_response\` type — echo the \`request_id\`, set \`approve\` true/false:

\`\`\`json
{"to": "team-lead", "message": {"type": "shutdown_response", "request_id": "...", "approve": true}}
{"to": "researcher", "message": {"type": "plan_approval_response", "request_id": "...", "approve": false, "feedback": "add error handling"}}
\`\`\`

Approving shutdown terminates your process. Rejecting plan sends the teammate back to revise. Don't originate \`shutdown_request\` unless asked. Don't send structured JSON status messages — use TaskUpdate.
`.trim()
}
