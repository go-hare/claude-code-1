import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u2013\u2014\u2018\u2019\u201c\u201d]/g, ".");
}

function dumpAround(label, needleStr, before, after, maxHits = 6) {
  const needle = Buffer.from(needleStr);
  const hits = [];
  let from = 0;
  while (true) {
    const i = buf.indexOf(needle, from);
    if (i < 0) break;
    hits.push(i);
    from = i + 1;
    if (hits.length >= maxHits) break;
  }
  const chunks = [`#### "${needleStr}" ${hits.length} [${hits.join(", ")}]`];
  for (const i of hits) {
    chunks.push(ascii(buf.subarray(Math.max(0, i - before), Math.min(buf.length, i + after)).toString("latin1")));
    chunks.push("---");
  }
  return chunks.join("\n");
}

const parts = [
  dumpAround("fd", "function fD(", 40, 400),
  dumpAround("vs", "function Vs(", 40, 500),
  dumpAround("uq", "function uq(e=Lne)", 20, 80),
  dumpAround("izg-opt", "optionWindow:QPo", 20, 40),
  dumpAround("izg-slice", "QPo??{start:0", 80, 800),
  dumpAround("izg-hi", "pTe?Hi(", 80, 400),
  dumpAround("more-options", " more options above", 80, 200),
  dumpAround("more-opts2", "more options", 40, 200),
];

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-fd-vs-izg.txt",
  parts.join("\n\n"),
);
console.log("ok");
