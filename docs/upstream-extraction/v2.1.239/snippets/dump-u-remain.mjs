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
  // #11
  "queuedCommands",
  "abortOnEscape",
  "finish early",
  "queued prompt",
  "escapeQueued",
  // #37
  "posix_spawn",
  "function dme",
  "dme()",
  "Hooks: cwd",
  "hook cwd",
  "getOriginalCwd",
  "ENOENT",
  // #29
  "vimMode",
  "NORMAL",
  "agent view",
  "AgentView",
  // #44
  "organization policy",
  "org policy",
  "shouldRetry",
  "policy_violation",
  // #28
  "PreToolUse",
  "deferred by",
  // #26
  "pendingSgr",
  "35;150;7M",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 6).join(",")}]`);
  if (hs.length === 0) continue;
  // skip huge ENOENT dump except first 2 interesting ones later
  const take = n === "ENOENT" || n === "shouldRetry" ? 1 : 2;
  for (const i of hs.slice(0, take)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 250, 900));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-u-remain.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
