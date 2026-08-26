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
  "async function*y8f(",
  "async function*w8f(",
  "async function*x8f(",
  "async function*k8f(",
  "async function*m8f(",
  "async function*n8f(",
  "Deferred tool resume:",
  "type:\"hook_deferred_tool\"",
  'type:"hook_deferred_tool"',
  "hook_deferred_tool",
  "function EAa(",
  "d===\"INSERT\"",
  "d===\"NORMAL\"",
  "vimMode===\"INSERT\"",
  "setVimMode",
  "function _bl(",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 8).join(",")}]`);
  if (hs.length === 0) continue;
  const win =
    n.includes("8f(") || n === "Deferred tool resume:" || n.includes("hook_deferred")
      ? [400, 1800]
      : n.includes("INSERT") || n.includes("NORMAL") || n === "setVimMode"
        ? [200, 800]
        : [80, 900];
  for (const i of hs.slice(0, 3)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, win[0], win[1]));
  }
}

// Also dump 2KB BEFORE the resume site to get function name
lines.push("==== BEFORE resume 310705525 ====");
lines.push(around(310705200, 2200, 200));

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk8e.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
