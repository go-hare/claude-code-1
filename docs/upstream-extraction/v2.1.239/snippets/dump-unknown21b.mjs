import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
function hits(needle, max = 5) {
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
  return ascii(buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"));
}
const needles = [
  "do not re-run",
  "original arguments",
  "skill invocation",
  "after compact",
  "empty <>",
  "<>",
  "literal ` `",
  "mouse leftover",
  "partial mouse",
  "sgrBuf",
  "csiBuf",
  "1006h",
  "expandedToolResult",
  "toolResultColor",
  "cwd no longer",
  "resume in the current directory",
  "existsSync(e.cwd)",
  "SessionStart",
  "keepAliveWhile",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" [${hs.join(",")}]`);
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 80, 160));
  }
}
writeFileSync("docs/upstream-extraction/v2.1.239/snippets/gold-unknown21b.txt", lines.join("\n"));
console.log("ok", lines.length);
