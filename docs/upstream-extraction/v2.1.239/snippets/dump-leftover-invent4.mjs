import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 10) {
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
  "fetched-web-content",
  "function eC(",
  "<fetched-web-content>",
  "raw page as markdown",
  "webFetchReadmissionAllowed",
  "function Gji",
  ".push(bpr)",
  "aAi()?",
  "bpr:",
  "WEB_FETCH_AGENT",
]) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 8).join(",")}]`);
  if (hs.length === 0) continue;
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 200, 1800));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-leftover-invent4.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
