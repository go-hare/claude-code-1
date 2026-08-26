import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
const needle = Buffer.from("selection:extendLeft");
const out = [];
let i = buf.indexOf(needle);
while (i !== -1) {
  out.push(
    `#### @${i}\n` +
      ascii(
        buf
          .subarray(Math.max(0, i - 900), Math.min(buf.length, i + 900))
          .toString("latin1"),
      ) +
      "\n---\n",
  );
  i = buf.indexOf(needle, i + 1);
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-review-extend-bind.txt",
  out.join("\n"),
);
console.log("hits", out.length);
