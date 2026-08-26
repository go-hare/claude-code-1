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
  // #33 focus click
  "terminalFocusGainedAt",
  "function Jhf",
  "function OKa",
  "function C2t",
  "FOCUS_IN",
  "\x1b[I",
  "ignoreNext",
  "focus-click",
  "gainedAt",
  // #11 esc queued
  "queuedCommands",
  "abortOnEscape",
  "cancelAndAbort",
  "escapeQueued",
  "queryAborted",
  "abortedWhileQueued",
  "skipNextSubmit",
  "drainQueue",
  "processQueue",
  // #37 hooks cwd
  "getOriginalCwd()",
  "pathExists(hook",
  "homedir()",
  "getProjectRoot",
  "safeCwd",
  "hook spawn",
  "cwd not found",
  // #19 resume deleted
  "allProjects",
  "session.cwd",
  "project.cwd",
  "existsSync",
  "directory no longer",
  "removed worktree",
  "cd into",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n.replace(/\x1b/g, "ESC")}" count=${hs.length} [${hs.slice(0, 6).join(",")}]`);
  const big =
    n.includes("function") ||
    n.includes("terminalFocus") ||
    n.includes("queued") ||
    n.includes("getOriginal") ||
    n.includes("allProjects") ||
    n.includes("directory");
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 80, big ? 1800 : 500));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-u13a.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
