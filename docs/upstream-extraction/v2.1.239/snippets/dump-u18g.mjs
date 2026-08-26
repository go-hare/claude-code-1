import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
function around(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"),
  );
}
function hits(needle, max = 4) {
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
const needles = [
  "Hooks: cwd",
  "falling back",
  "safeCwd",
  "hookCwd",
  "spawn ENOENT",
  "cwd not found",
  "function dme",
  "getProjectRoot()",
  "existsSync(e.cwd)",
  "existsSync(t.cwd)",
  "all-projects",
  "resumeSession",
  "queuedCommands.length",
  "abortQuery",
  "cancelAndAbort",
  "onEscape",
  "keepAlive",
  "heartbeatMs",
  "hookHeartbeat",
  "startActiveSpan",
  "withActiveSpan",
  "traceContext",
  "context.with",
  "AgentDetail",
  "vimMode",
  "setVimMode",
  "ignoreFocusClick",
  "focusGained",
  "button press",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.join(",")}]`);
  if (hs.length === 0) continue;
  lines.push(around(hs[0], 80, 900));
}
for (const i of [313432026, 313515404]) {
  lines.push(`==== getOriginalCwd ${i} ====`);
  lines.push(around(i, 200, 2000));
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-u18g.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
