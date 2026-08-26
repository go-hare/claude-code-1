import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
const i = buf.indexOf(Buffer.from("staging block exited without a staging file"));
const start = Math.max(0, i - 200);
const end = Math.min(buf.length, i + 1800);
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-u58e.txt",
  ascii(buf.subarray(start, end).toString("latin1")),
);
console.log("ok", i);
