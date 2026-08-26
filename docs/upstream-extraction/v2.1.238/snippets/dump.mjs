// Throwaway dumper for the official 2.1.238 SEA (Bun single-file exe).
// Usage: node dump.mjs <name> <needle> [before] [after] [occurrence]
import { readFileSync, writeFileSync } from "node:fs";

const exe =
  process.env.TEMP + "\\official-238\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

const [name, needle, beforeArg, afterArg, occArg] = process.argv.slice(2);
const before = Number(beforeArg ?? 300);
const after = Number(afterArg ?? 1800);
const occ = Number(occArg ?? 0);

const nb = Buffer.from(needle);
let i = -1;
for (let n = 0; n <= occ; n++) {
  i = buf.indexOf(nb, i + 1);
  if (i < 0) break;
}
if (i < 0) {
  console.log("MISS", name, JSON.stringify(needle));
  process.exit(1);
}
const start = Math.max(0, i - before);
const end = Math.min(buf.length, i + after);
writeFileSync(
  `docs/upstream-extraction/v2.1.238/snippets/gold-${name}.txt`,
  ascii(buf.subarray(start, end).toString("latin1")),
);
let total = 0;
for (let p = buf.indexOf(nb); p >= 0; p = buf.indexOf(nb, p + 1)) total++;
console.log("OK", name, "at", i, "occurrences", total);
