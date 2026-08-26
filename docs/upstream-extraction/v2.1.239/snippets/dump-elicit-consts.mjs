import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function dump(needleStr, before, after, maxHits = 4) {
  const needle = Buffer.from(needleStr);
  const hits = [];
  let from = 0;
  while (true) {
    const i = buf.indexOf(needle, from);
    if (i < 0) break;
    hits.push(i);
    from = i + 1;
    if (hits.length >= 12) break;
  }
  const chunks = [`#### "${needleStr}" ${hits.length} [${hits.slice(0, 8).join(", ")}]`];
  for (const i of hits.slice(0, maxHits)) {
    chunks.push(ascii(buf.subarray(Math.max(0, i - before), Math.min(buf.length, i + after)).toString("latin1")));
    chunks.push("---");
  }
  return chunks.join("\n");
}

const parts = [
  dump("function zRr(", 20, 200),
  dump("zRr=", 20, 80, 6),
  dump("UAt=", 20, 80, 8),
  dump("dKc=", 20, 80, 8),
  dump("function pKc(", 20, 250),
  dump("function Pd(", 20, 200),
  dump("Hje=", 20, 80, 8),
  dump("Pje=", 20, 80, 8),
  dump("function Hi(", 20, 250),
  dump("HvA=", 20, 80, 6),
  dump("UAt-", 40, 40, 6),
];

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-elicit-consts.txt",
  parts.join("\n\n"),
);
console.log("ok");
