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
  'eNf="IDE diagnostics baseline timed out"',
  "Q1f=4000",
  "function Q1f",
  "Claude Code JetBrains Plugin",
  "isJetBrainsIdeTerminal()",
  "message to yourself",
  "You are sending",
  "a message to it would be",
  "posix_spawn ENOENT",
  "getOriginalCwd",
  "homedir()",
  "keepAliveWhile",
  "SessionStart",
  "setMcpServers",
  "ignoreNextClick",
  "FOCUS_IN",
  "MODAL_TRANSCRIPT_PEEK",
  "abortOnEscape",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 6).join(",")}]`);
  const big =
    n.includes("function") ||
    n.includes("eNf") ||
    n.includes("Q1f") ||
    n.includes("yourself") ||
    n.includes("posix") ||
    n.includes("keepAlive") ||
    n.includes("setMcp") ||
    n.includes("ignoreNext") ||
    n.includes("MODAL") ||
    n.includes("abortOn");
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 100, big ? 1800 : 600));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-u18d.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
