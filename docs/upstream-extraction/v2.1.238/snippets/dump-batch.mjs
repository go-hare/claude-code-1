// Throwaway batch dumper for the official 2.1.238 SEA.
// Reads needles.json: [{name, needle, before?, after?, occ?}]
import { readFileSync, writeFileSync } from "node:fs";

const buf = readFileSync(process.env.TEMP + "\\official-238\\package\\claude.exe");
const jobs = JSON.parse(readFileSync(process.argv[2], "utf8"));

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

for (const j of jobs) {
  const nb = Buffer.from(j.needle);
  let total = 0;
  for (let p = buf.indexOf(nb); p >= 0; p = buf.indexOf(nb, p + 1)) total++;
  let i = -1;
  for (let n = 0; n <= (j.occ ?? 0); n++) {
    i = buf.indexOf(nb, i + 1);
    if (i < 0) break;
  }
  if (i < 0) {
    console.log("MISS", j.name, "hits=" + total);
    continue;
  }
  const start = Math.max(0, i - (j.before ?? 1500));
  const end = Math.min(buf.length, i + (j.after ?? 3000));
  writeFileSync(
    `docs/upstream-extraction/v2.1.238/snippets/gold-${j.name}.txt`,
    ascii(buf.subarray(start, end).toString("latin1")),
  );
  console.log("OK", j.name, "at", i, "hits=" + total);
}
