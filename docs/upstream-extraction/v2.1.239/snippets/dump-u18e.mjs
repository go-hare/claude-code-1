import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
function hits(needle, max = 6) {
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
  "no agent named",
  "No agent named",
  "yourself)",
  "send to yourself",
  "Sending to yourself",
  "your own session",
  "this session itself",
  "Q1f",
  "wBS=500",
  "ABS===",
  "source===ABS",
  "===ABS",
  "JetBrains Plugin",
  "pendingSgr",
  "function kTd",
  "35;",
  "split across",
  "org policy",
  "organization policy",
  "policy_rejection",
  "keep-alive",
  "keepalive",
  "idle-reap",
  "idle_reap",
  "SessionStart hook",
  "deleted directory",
  "resume in the current",
  "pathExists(session",
  "plan mode",
  "leavePlanMode",
  "idle worker",
  "5xx",
  "mid-session reconnect",
  "mobile image",
  "saved file path",
  "anthropic.com",
  "CCR_PROXY",
  "WEBFETCH_USE_CCR",
  "traceparent",
  "PreToolUse",
  "vim mode",
  "AgentView",
  "escape to NORMAL",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 6).join(",")}]`);
  if (hs.length === 0) continue;
  const big =
    n.includes("no agent") ||
    n.includes("yourself") ||
    n.includes("Q1f") ||
    n.includes("ABS") ||
    n.includes("pendingSgr") ||
    n.includes("kTd") ||
    n.includes("policy") ||
    n.includes("keep") ||
    n.includes("plan") ||
    n.includes("CCR") ||
    n.includes("traceparent") ||
    n.includes("AgentView") ||
    n.includes("deleted");
  for (const i of hs.slice(0, 1)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 80, big ? 1400 : 400));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-u18e.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
