import { readFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
const region = buf.subarray(320188000, 320202000).toString("latin1");
const idx = [];
let from = 0;
while (true) {
  const i = region.indexOf("Tqt", from);
  if (i < 0) break;
  idx.push(i);
  from = i + 1;
  if (idx.length > 20) break;
}
for (const i of idx.slice(0, 12)) {
  const s = region.slice(Math.max(0, i - 80), i + 80).replace(/[^\x20-\x7e]/g, ".");
  console.log("---", 320188000 + i);
  console.log(s);
}
