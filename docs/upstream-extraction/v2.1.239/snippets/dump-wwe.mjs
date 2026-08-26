import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
const i = buf.indexOf(Buffer.from("function Wwe("));
const j = buf.indexOf(Buffer.from("Wwe="), 310000000);
const k = buf.indexOf(Buffer.from("function Wwe("), 300000000);
console.log({ i, j, k });
const out = [
  i >= 0 ? ascii(buf.subarray(i, i + 400).toString("latin1")) : "no function Wwe",
  "====",
  ascii(buf.subarray(313224186 - 50, 313224186 + 200).toString("latin1")),
];
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-wwe.txt",
  out.join("\n"),
);
