import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function dumpInRange(needleStr, before, after, lo, hi, maxHits = 12) {
  const needle = Buffer.from(needleStr);
  const hits = [];
  let from = lo;
  while (from < hi) {
    const i = buf.indexOf(needle, from);
    if (i < 0 || i >= hi) break;
    hits.push(i);
    from = i + 1;
    if (hits.length >= maxHits) break;
  }
  const chunks = [`#### "${needleStr}" in ${lo}-${hi}: ${hits.length} [${hits.join(", ")}]`];
  for (const i of hits) {
    chunks.push(ascii(buf.subarray(Math.max(0, i - before), Math.min(buf.length, i + after)).toString("latin1")));
    chunks.push("---");
  }
  return chunks.join("\n");
}

function dump(needleStr, before, after, maxHits = 6) {
  return dumpInRange(needleStr, before, after, 0, buf.length, maxHits);
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-continue18b.txt",
  [
    dumpInRange("AU(", 80, 60, 300000000, 322000000, 20),
    dump("=AU(", 80, 80, 8),
    dump("AU(e,", 60, 80, 8),
    dump("selection:extendLeft", 80, 400, 4),
    dump("selection:copy", 80, 400, 6),
    dump("^\\uFEFF([!#]?)", 40, 250, 4),
    dump("function isJetBrains", 20, 200, 4),
    dump("5000", 0, 0, 1),
    dump("masked", 40, 160, 8),
    dump("password", 40, 120, 6),
    dump("killHistory", 40, 160, 4),
    dump("US-only", 60, 300, 4),
    dump("data residency", 40, 200, 4),
    dump("usOnly", 40, 160, 6),
    dump("after compaction", 40, 200, 4),
    dump("skill arguments", 40, 160, 4),
    dump("reminder", 40, 160, 8),
  ].join("\n\n"),
);
console.log("ok");
