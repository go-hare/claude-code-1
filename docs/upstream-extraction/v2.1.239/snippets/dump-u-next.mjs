import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
function hits(needle, max = 12) {
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
  "hasQueuedCommands",
  "queuedCommandsLength",
  "drainCommandQueue",
  "getCommandsByMaxPriority",
  "user-cancel",
  "finish early",
  "repeat actions",
  "still working",
  // #26
  "pendingSgr",
  "pendingCsi",
  "incompleteCsi",
  "orphanSgr",
  "[<\\d+;\\d+;\\d+[Mm]",
  "absorbMm",
  // #28
  "startActiveSpan",
  "traceparent",
  "withSpan",
  "otel.trace",
  "resumeSpan",
  "deferred tool",
  "PreToolUse hook",
  // #29
  "vimMode:\"NORMAL\"",
  "vimMode:'NORMAL'",
  "NORMAL mode",
  "agent view",
  "clearing the prompt",
  // #37
  "posix_spawn ENOENT",
  "falling back to original",
  "project root or home",
  "homedir()",
  "getProjectRoot()",
  // #44
  "organization policy",
  "policy check",
  "policy_blocked",
  "request_rejected",
  "shouldRetry:!1",
  // #47
  "idle-reap",
  "idle reaped",
  "SessionStart",
  "keep_alive",
  "keep-alives",
  // #51
  "function GCe",
  "live teammates",
  // #55
  "saved file path",
  "mobile",
  // #56
  "anthropic.com",
  "CCR_PROXY",
  "session's network proxy",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 8).join(",")}]`);
  if (hs.length === 0) continue;
  const take = n === "SessionStart" || n === "anthropic.com" || n === "homedir()" ? 1 : 2;
  for (const i of hs.slice(0, take)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 350, 1400));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-u-next.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
