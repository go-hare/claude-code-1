import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
const i = 311950200;
const s = buf
  .subarray(i, i + 1800)
  .toString("latin1")
  .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-lto-lc.txt",
  s,
);
console.log(s.slice(0, 400));
