import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
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

function slice(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"),
  );
}

const lines = [];

// Q2r helpers
for (const n of [
  "function t_a(",
  "function T4d(",
  "function k4d(",
  "function NKb(",
  "function BH(",
  "function qnr(",
  "function $Kb(",
  "qnr=pp",
  "BH=pp",
  "parseArtifactUrl",
  "canonicalizeArtifactUrlInput",
  "artifactViewerUrlFor",
  "isArtifactToolRegistered",
  "isArtifactReadEnabled",
  "async prompt(e)",
  "YHp(",
  "Lto(",
]) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 6).join(",")}]`);
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(slice(i, 80, n === "function T4d(" || n === "function t_a(" ? 6000 : 2500));
  }
}

// Write raw Q2r module window (~40k from first helper near 303678000)
const start = 303676000;
const raw = buf.subarray(start, start + 45000).toString("latin1");
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-q2r-raw.txt",
  ascii(raw),
);

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-q2r-artifact-idx.txt",
  lines.join("\n"),
);
console.log("ok", lines.length, "q2r raw", raw.length);
