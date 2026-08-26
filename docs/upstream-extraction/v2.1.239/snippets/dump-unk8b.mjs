import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 8) {
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
  "function Cuy(",
  "function Ruy(",
  "forceEnd()",
  ".forceEnd(",
  "function Qrp(",
  "Qrp(",
  "blocked by your organization's policy",
  "wn_=",
  "policy_hit",
  "isVimEditing:$E",
  "$E=",
  "vimMode===\"INSERT\"",
  "vimMode===\"NORMAL\"",
  "function nnp(",
  "startSpan(\"claude_code.tool\"",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.join(",")}]`);
  if (hs.length === 0) continue;
  const big = n === "function Cuy(" || n === "function Ruy(" || n === "function nnp(" || n === "function Qrp(";
  const win = big ? [40, 2200] : n.includes("forceEnd") ? [200, 400] : [160, 700];
  for (const i of hs.slice(0, n.includes("forceEnd") ? 6 : 3)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, win[0], win[1]));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk8b.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
