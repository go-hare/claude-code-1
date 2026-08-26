import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

const start = 322459800;
const end = 322498800;
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-elicit-module.txt",
  ascii(buf.subarray(start, end).toString("latin1")),
);
console.log("wrote", end - start);

// also targeted
function dump(needleStr, before, after, maxHits = 5) {
  const needle = Buffer.from(needleStr);
  const hits = [];
  let from = 322450000;
  const limit = 322510000;
  while (from < limit) {
    const i = buf.indexOf(needle, from);
    if (i < 0 || i > limit) break;
    hits.push(i);
    from = i + 1;
    if (hits.length >= maxHits) break;
  }
  return { needle: needleStr, hits, samples: hits.map((i) =>
    ascii(buf.subarray(Math.max(0, i - before), Math.min(buf.length, i + after)).toString("latin1")),
  )};
}

const extra = [
  dump("function zRr", 10, 1500, 2),
  dump("function Tk(", 20, 200, 4),
  dump("Loe=", 20, 80, 6),
  dump("Aee=", 20, 80, 6),
  dump("Xhe=", 20, 80, 6),
  dump("function nH(", 20, 150, 4),
  dump("function or(", 20, 150, 4),
  dump("function fp(", 20, 150, 3),
];
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-elicit-extra.json",
  JSON.stringify(extra, null, 2),
);
console.log("extra ok");
