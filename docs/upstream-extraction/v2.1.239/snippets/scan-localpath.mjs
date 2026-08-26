import { readFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const s = readFileSync(exe).toString("latin1");

const twoSlash = String.raw`/^[\\/]{2}/.test(`;
const pats = [
  ["ELe(", null],
  [twoSlash, null],
  ["non-local IPC path", null],
  ["aRu=", 90],
  ["function TSe(", null],
  ["TSe=", 90],
];
for (const [needle, ctx] of pats) {
  const hits = [];
  let i = 0;
  while (true) {
    const j = s.indexOf(needle, i);
    if (j < 0) break;
    hits.push(ctx ? `${j}::${s.slice(j, j + ctx).replace(/[^\x20-\x7e]/g, ".")}` : j);
    i = j + 1;
    if (hits.length > 40) break;
  }
  console.log(JSON.stringify(needle), hits.length, hits.join(" | "));
}
