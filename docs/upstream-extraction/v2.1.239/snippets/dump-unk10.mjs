import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 8) {
  const n = Buffer.from(needle);
  const out = [];
  let i = 0;
  while (out.length < max) {
    const j = buf.indexOf(n, i);
    if (j < 0) break;
    out.push(j);
    i = j + 1;
  }
  return { count: countAll(n), offs: out };
}

function countAll(n) {
  let c = 0;
  let i = 0;
  while (c < 40) {
    const j = buf.indexOf(n, i);
    if (j < 0) break;
    c++;
    i = j + 1;
  }
  return c >= 40 ? `${c}+` : c;
}

function around(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"),
  );
}

const needles = [
  // #11
  "queuedCommands",
  "queuedCommand",
  "cancelAndAbort",
  "abortQuery",
  "abort the current",
  "leaving the session idle",
  "repeat actions",
  "cancelRequest",
  "drainQueued",
  "flushQueued",
  "submitQueued",
  "onCancel",
  "escapePressed",
  "userCancel",
  // #13
  "plan mode",
  "planMode",
  "enterPlanMode",
  "restorePlan",
  "idle worker",
  "worker restart",
  "out of plan",
  "plan_mode",
  "isPlanModeEnabled",
  // #15
  "setMcpServers",
  "mid-session",
  "stuck in a failed",
  "hasFailedSdk",
  "mcp reconnect",
  "reconnectMcp",
  "failed after",
  "transient",
  "statusCode>=500",
  "status>=500",
  // #28
  "PreToolUse",
  "tool_decision",
  "deferredByHook",
  "hookDeferred",
  "original turn",
  "traceparent",
  "startSpan",
  "startActiveSpan",
  "otel",
  "OpenTelemetry",
  "spanContext",
  "withSpan",
  "activeSpan",
  "continueTrace",
  // #29
  "vimMode===",
  'vimMode==="NORMAL"',
  "vimMode",
  "setVimMode",
  "NORMAL",
  "keeps your text",
  "clearing the prompt",
  "agent view",
  "AgentView",
  "defaultToAgentsView",
  // #37
  "posix_spawn ENOENT",
  "ENOENT",
  "hook cwd",
  "hooksCwd",
  "getOriginalCwd",
  "getProjectRoot",
  "homedir",
  "os.homedir",
  "dme()",
  "tmpdir",
  // #44
  "organization policy",
  "policy_hit",
  "policy_blocked",
  "shouldRetry",
  "resend",
  "rejected by",
  "policy check failed",
  "org_policy",
  "organization_policy",
  "block_reason",
  // #47
  "SessionStart",
  "Setup hook",
  "keep-alive",
  "keepalive",
  "keepAlive",
  "idle-reaped",
  "idle reaped",
  "sendKeepAlive",
  "session_keepalive",
  // #55
  "saved file path",
  "mobile",
  "uploaded image",
  "image path",
  "file_path",
  "savedPath",
  "mediaPath",
  // #56
  "www.anthropic.com",
  "docs.anthropic.com",
  "anthropic.com",
  "session proxy",
  "allowed domains",
  "network proxy",
  "ANTHROPIC_BASE",
];

const lines = [];
for (const n of needles) {
  const { count, offs } = hits(n);
  lines.push(`#### "${n}" count=${count} [${offs.join(",")}]`);
  if (offs.length === 0) continue;
  for (const i of offs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 80, 280));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk10.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
