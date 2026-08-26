import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
const start = buf.indexOf(Buffer.from("let c=null,u=YWy()"));
const chunk = buf
  .subarray(start, start + 3500)
  .toString("latin1")
  .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-plan13d.txt",
  chunk,
);
console.log("start", start, "len", chunk.length);
