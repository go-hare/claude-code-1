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
const lines = [];
lines.push("==== before jfu show gate ====");
lines.push(around(326381190, 1200, 200));

lines.push("\n==== jfu decline hPr ====");
lines.push(around(326381800, 0, 2200));

lines.push("\n==== Vfs()return!1;return!0 ====");
for (const i of hits("if(Vfs())return!1;return!0", 3)) {
  lines.push(around(i, 800, 80));
}

lines.push("\n==== show upsell helpers ====");
for (const n of [
  "function Lfu",
  "function ifu",
  "function nfu",
  "function ofu",
  "function sfu",
  "function afu",
  "function cfu",
  "function ufu",
  "function dfu",
  "function pfu",
  "function hfu",
  "function mfu",
  "function gfu",
  "function yfu",
  "function bfu",
  "function wfu",
  "function xfu",
  "function kfu",
  "function Sfu",
  "function Cfu",
  "function _fu",
  "function Efu",
  "function Afu",
  "function Tfu",
  "function vfu",
  "function ffu",
]) {
  const hs = hits(n, 1);
  if (hs.length) {
    lines.push(`\n#### ${n}`);
    lines.push(around(hs[0], 20, 500));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unknown24g.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
