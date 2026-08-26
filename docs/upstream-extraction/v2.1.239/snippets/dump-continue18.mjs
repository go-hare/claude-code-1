import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function dump(needleStr, before, after, maxHits = 6) {
  const needle = Buffer.from(needleStr);
  const hits = [];
  let from = 0;
  while (true) {
    const i = buf.indexOf(needle, from);
    if (i < 0) break;
    hits.push(i);
    from = i + 1;
    if (hits.length >= 16) break;
  }
  const chunks = [`#### "${needleStr}" ${hits.length} [${hits.slice(0, 10).join(", ")}]`];
  for (const i of hits.slice(0, maxHits)) {
    chunks.push(ascii(buf.subarray(Math.max(0, i - before), Math.min(buf.length, i + after)).toString("latin1")));
    chunks.push("---");
  }
  return chunks.join("\n");
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-continue18.txt",
  [
    dump("function AU(", 20, 400, 4),
    dump("truncatePathMiddle", 40, 200, 6),
    dump("35;150;7M", 40, 120, 4),
    dump("mouse report", 40, 120, 4),
    dump("dark-ansi", 40, 200, 6),
    dump("effortBadge", 40, 160, 4),
    dump("badgeColor", 40, 160, 4),
    dump("ultracodeBadge", 40, 160, 4),
    dump("JediTerm", 40, 200, 6),
    dump("JetBrains", 40, 160, 6),
    dump("selection:copy", 40, 200, 4),
    dump("Shift+Arrow", 40, 120, 4),
    dump("\\uFEFF", 40, 200, 6),
    dump("stripBom", 40, 200, 6),
    dump("us-only-inference", 40, 200, 4),
    dump("usOnlyInference", 40, 200, 4),
    dump("1.1x", 40, 120, 4),
    dump("US-only", 40, 160, 4),
  ].join("\n\n"),
);
console.log("ok");
