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
  "re-emitting ",
  "hook_deferred_tool",
  "function Zrp(",
  "traceparent:",
  "function JIy(",
  "function uln(",
  "this.guard.forceEnd()",
  "function P8f(",
  "ppl(",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 8).join(",")}]`);
  if (hs.length === 0) continue;
  const win =
    n === "re-emitting " || n === "function JIy(" || n === "function P8f("
      ? [200, 3500]
      : n === "this.guard.forceEnd()"
        ? [800, 2500]
        : [120, 1200];
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, win[0], win[1]));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk8d.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
