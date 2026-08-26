import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
// usage: node dump-wrap.mjs <needle|@offset> <before> <after> <outName> [occurrence]
const arg = process.argv[2];
const before = Number(process.argv[3] ?? 400);
const after = Number(process.argv[4] ?? 4000);
const out = process.argv[5] ?? "gold-wrap";
const occ = Number(process.argv[6] ?? 0);
let off;
if (arg.startsWith("@")) {
  off = Number(arg.slice(1));
} else {
  let i = 0;
  for (let k = 0; k <= occ; k++) {
    off = buf.indexOf(Buffer.from(arg), i);
    if (off < 0) break;
    i = off + 1;
  }
}
if (off === undefined || off < 0) {
  console.log("NOT FOUND", arg);
  process.exit(1);
}
const start = Math.max(0, off - before);
const end = Math.min(buf.length, off + after);
const text = ascii(buf.subarray(start, end).toString("latin1"));
const wrapped = text.replace(/(.{200})/g, "$1\n");
writeFileSync(
  `docs/upstream-extraction/v2.1.239/snippets/${out}.txt`,
  wrapped,
);
console.log("ok", arg, off, start, end);
