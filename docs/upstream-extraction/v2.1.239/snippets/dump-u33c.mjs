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
const offs = [
  318057501, 318057660, 318057765, 318057888, 326068140, 326068171,
  326068882, 326068907, 326068960, 326254775, 308705250, 308705293,
  322007651, 322022652, 317819661, 328878624, 210137092,
];
const lines = [];
for (const i of offs) {
  lines.push(`#### @${i}`);
  lines.push(around(i, 400, 1800));
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-u33c.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
