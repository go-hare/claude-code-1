import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function around(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"),
  );
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk8i.txt",
  [
    "==== H8f caller 326847200 ====",
    around(326847200, 1800, 1600),
  ].join("\n"),
);
console.log("ok");
