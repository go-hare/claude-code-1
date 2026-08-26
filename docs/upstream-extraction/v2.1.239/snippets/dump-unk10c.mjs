import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 10) {
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
  "CLAUDE_CODE_REMOTE_SEND_KEEPALIVES",
  "session_keepalive_heartbeat",
  "session_idle_30s",
  "j3f",
  "activityCallback",
  "Hooks: cwd",
  "falling back to original",
  "falling back to",
  "cwd not found",
  "hook spawn",
  "blocked by your organization's policy",
  "policy_hit",
  "tool.execute",
  "execute_tool",
  "PreToolUse hook",
  "claude.tool",
  "hook.PreToolUse",
  "setMcpServers",
  "reconnectMcpServer",
  "status===\"failed\"",
  "type:\"failed\"",
  "saved file",
  "image_path",
  "media_path",
  "www.anthropic.com",
  "docs.anthropic.com",
  "non-API",
  "agent view",
  "vimMode",
  "escape to NORMAL",
  "INSERT",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.join(",")}]`);
  if (hs.length === 0) continue;
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 180, 500));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk10c.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
