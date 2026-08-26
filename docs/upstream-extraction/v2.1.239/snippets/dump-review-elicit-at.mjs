import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
const needle = Buffer.from("Fe=5,Be=2,je=3,ze=");
const i = buf.indexOf(needle);
const start = Math.max(0, i - 1200);
const end = Math.min(buf.length, i + 2600);
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-review-elicit-at.txt",
  ascii(buf.subarray(start, end).toString("latin1")),
);
console.log("ok", i);
