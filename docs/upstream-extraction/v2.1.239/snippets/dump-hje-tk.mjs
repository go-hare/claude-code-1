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
    if (hits.length >= 10) break;
  }
  const chunks = [`#### "${needleStr}" ${hits.length} [${hits.slice(0, 8).join(", ")}]`];
  for (const i of hits.slice(0, maxHits)) {
    chunks.push(ascii(buf.subarray(Math.max(0, i - before), Math.min(buf.length, i + after)).toString("latin1")));
    chunks.push("---");
  }
  return chunks.join("\n");
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-hje-tk.txt",
  [
    dump("Loe=", 30, 80, 8),
    dump("Aee=", 30, 80, 8),
    dump("Xhe=", 30, 80, 8),
    dump("2*Loe,2*(Aee+Xhe)", 40, 80, 2),
    dump("function Tk(", 20, 300, 6),
    dump("Tk=function", 20, 200, 4),
    dump("needsGutter", 40, 200, 6),
    dump("function fp(", 20, 200, 4),
    dump("function nH(", 20, 200, 4),
    dump("UAt=2", 40, 120, 4),
  ].join("\n\n"),
);
console.log("ok");
