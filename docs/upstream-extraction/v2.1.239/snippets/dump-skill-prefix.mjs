import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
const needles = [
  "### Skill:",
  "case\"invoked_skills\"",
  "invoked EARLIER",
  "function pve",
  "US_ONLY",
  "usOnly",
  "inference premium",
  "data-residency premium",
];
const lines = [];
for (const n of needles) {
  const needle = Buffer.from(n);
  const hits = [];
  let i = 0;
  while (hits.length < 4) {
    const j = buf.indexOf(needle, i);
    if (j < 0) break;
    hits.push(j);
    i = j + 1;
  }
  lines.push(`#### "${n}" count=${hits.length} [${hits.join(",")}]`);
  for (const h of hits.slice(0, 2)) {
    lines.push(`--- ${h} ---`);
    lines.push(
      ascii(buf.subarray(Math.max(0, h - 200), Math.min(buf.length, h + 800)).toString("latin1")),
    );
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-skill-prefix.txt",
  lines.join("\n"),
);
console.log("ok");
