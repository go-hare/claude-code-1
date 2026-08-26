import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

const i = buf.indexOf(Buffer.from("hbo.Provider,{value:Wie||Tqt?null:e7h"));
const j = buf.indexOf(Buffer.from("if(n&&oI0(w,T))return"));

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-e7h.txt",
  [
    "#### hbo.Provider context\n",
    ascii(buf.subarray(i - 4000, i + 400).toString("latin1")),
    "\n\n#### after oI0\n",
    ascii(buf.subarray(j - 200, j + 2500).toString("latin1")),
  ].join(""),
);
console.log("ok", i, j);
