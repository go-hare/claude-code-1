import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 20) {
  const n = Buffer.from(needle);
  const out = [];
  let i = 0;
  while (out.length < max) {
    const j = buf.indexOf(n, i);
    if (j < 0) break;
    out.push(j);
    i = j + 1;
  }
  return out;
}

function around(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"),
  );
}

const needles = [
  // #13 cloud plan idle
  "out of plan mode",
  "idle worker",
  "plan mode after",
  "resuming out of plan",
  "plan_mode_reentry",
  "permissionMode===\"plan\"",
  'mode:"plan"',
  "CLAUDE_CODE_REMOTE",
  "idle-reaped",
  "worker restart",
  "restorePlan",
  "restorePermissionMode",
  "permissionModeFromTranscript",
  "hydrat",
  "planModeOnResume",
  "mode===\"plan\"",

  // #15 remote MCP 5xx
  "setMcpServers",
  "hasFailedSdk",
  "stuck in a failed",
  "mid-session reconnect",
  "transient 5xx",
  "status>=500",
  "status>= 500",
  "status === 5",
  "type:\"failed\"",
  "mcp reconnect",
  "reconnect after",
  "failed after a transient",
  "clearFailed",
  "retryFailedMcp",
  "mcpServer failed",

  // #44 org policy resend
  "rejected by an organization",
  "organization policy",
  "organization's policy",
  "policy_violation",
  "policy_hit",
  "shouldRetry=!1",
  "shouldRetry:false",
  "organization_policy",
  "org_policy",
  "policy check",
  "before the rejection",

  // #55 mobile image path
  "saved file path",
  "uploaded from mobile",
  "mobile now include",
  "saved_file_path",
  "savedFilePath",
  "image_path",
  "pasted_image",
  "file_path",
  "uploaded image",
  "mobile upload",
  "remote image",

  // #56 web bash anthropic proxy
  "www.anthropic.com",
  "docs.anthropic.com",
  "non-API anthropic",
  "session's network proxy",
  "allowed domains",
  "anthropic.com hosts",
  "HTTPS_PROXY",
  "session proxy",
  "CLAUDE_CODE_PROXY",
  "ANTHROPIC_UNIX",
  "isAnthropicHost",
  "anthropic.com/",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 12).join(",")}]`);
  if (hs.length === 0) continue;
  for (const i of hs.slice(0, 4)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 220, 900));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk5.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
