import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function around(i, before, after) {
  return ascii(
    buf
      .subarray(Math.max(0, i - before), Math.min(buf.length, i + after))
      .toString("latin1"),
  );
}

const lines = [];

function hits(needle, from = 0, until = buf.length, max = 15) {
  const n = Buffer.from(needle);
  const out = [];
  let i = from;
  while (out.length < max) {
    const j = buf.indexOf(n, i);
    if (j < 0 || j >= until) break;
    out.push(j);
    i = j + 1;
  }
  return out;
}

for (const n of [
  "function __r(",
  "function Fcs(",
  "function Ke0(",
  "function ZHe(",
  "function Ucs(",
  "unprintable path",
  "(unprintable path)",
  "Path hidden",
]) {
  const hs = hits(n);
  lines.push(`#### "${n}" [${hs.join(",")}]`);
  for (const i of hs.slice(0, 3)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 200, 500));
  }
}

// static render neighborhood
lines.push("\n==== ros.Provider neighborhood ====\n");
const i = buf.indexOf(Buffer.from("ros.Provider,{value:!0"));
lines.push(around(i, 800, 600));

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-jr.txt",
  lines.join("\n"),
);
console.log("ok", i);
