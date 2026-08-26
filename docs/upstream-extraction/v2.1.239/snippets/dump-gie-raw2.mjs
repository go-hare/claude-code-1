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

const lines = [];

for (const n of [
  "The text inside the",
  "UNTRUSTED web content",
  "function Q2r",
  "promptless",
  "applyPromptToMarkdown",
  "function Xhr",
  "webFetchReadmissionAllowed:",
  "Iq(W)",
  "_pr(",
  "function _pr",
]) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 8).join(",")}]`);
  if (hs.length === 0) continue;
  const before = n === "The text inside the" || n === "function Q2r" ? 2500 : 200;
  const after = n === "The text inside the" || n === "function Q2r" ? 800 : 1600;
  for (const i of hs.slice(0, n === "The text inside the" ? 1 : 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, before, after));
  }
}

// Official raw-wrap function starts just before 311935507
lines.push("#### raw wrap prelude @ 311933200");
lines.push(around(311933200, 0, 2800));

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-gie-raw2.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
