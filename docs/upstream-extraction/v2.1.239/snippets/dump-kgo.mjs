import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
const startNeedle = Buffer.from("async function KGo(");
const i = buf.indexOf(startNeedle);
if (i < 0) {
  console.log("miss");
  process.exit(1);
}
const chunk = ascii(
  buf.subarray(i, Math.min(buf.length, i + 6500)).toString("latin1"),
);
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-kgo.txt",
  chunk,
);
console.log("ok", i, chunk.length);
