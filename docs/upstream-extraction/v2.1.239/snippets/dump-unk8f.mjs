import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 15) {
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
  'case"defer"',
  "permissionDecision===",
  "H8f(",
  "async function*H8f(",
  "tengu_pre_tool_hook_deferred",
  "permissionDecision=defer",
  "Valid types are: allow, deny, ask",
  "Valid types are:",
  "hook_deferred_tool",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 10).join(",")}]`);
  if (hs.length === 0) continue;
  const win = n === "H8f(" || n === "async function*H8f(" ? [80, 400] : [200, 1400];
  for (const i of hs.slice(0, n === "H8f(" ? 8 : 3)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, win[0], win[1]));
  }
}

// Scan JIy for escape after 326127302
const jiy = 326127302;
const slice = buf.subarray(jiy, jiy + 25000).toString("latin1");
const escIdx = [];
let p = 0;
while (escIdx.length < 12) {
  const k = slice.indexOf("escape", p);
  if (k < 0) break;
  escIdx.push(k);
  p = k + 1;
}
lines.push(`==== JIy escape offsets (${escIdx.length}) ====`);
for (const k of escIdx) {
  lines.push(`--- JIy+${k} ---`);
  lines.push(ascii(slice.slice(Math.max(0, k - 180), k + 420)));
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk8f.txt",
  lines.join("\n"),
);
console.log("ok", lines.length, "esc", escIdx.length);
