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
  "function mQc(",
  "isVimEditing",
  "getInFlightMessageId",
  "isInputEmpty",
  "isInputOverlayActive",
  "isExternalLoading",
  "priorContext",
  "function xne(",
  "xne()",
  "QLt.set",
  "startSpan(\"claude_code.tool\"",
  "When agent worktrees are removed",
  "Validate before spawning",
  "falling back to original",
  "project root",
  "hookCwd",
  "safeCwd",
  "getOriginalCwd",
  "cwd not found",
  "ENOENT",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.join(",")}]`);
  if (hs.length === 0) continue;
  const win = n === "function mQc(" ? [400, 3500] : n.includes("startSpan") || n === "priorContext" ? [200, 800] : [160, 500];
  for (const i of hs.slice(0, n === "function mQc(" ? 1 : 3)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, win[0], win[1]));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk10h.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
