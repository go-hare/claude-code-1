import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const txt = readFileSync(exe).toString("latin1");
const ascii = (s) => s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
const out = [];
function all(needle, before, after, cap = 3) {
  out.push(`\n##### ${needle}`);
  let i = -1, n = 0;
  while ((i = txt.indexOf(needle, i + 1)) !== -1 && n < cap) {
    n++;
    out.push(`--- @${i} ---\n` + ascii(txt.slice(Math.max(0, i - before), i + after)));
  }
  out.push(`(shown ${n})`);
}
all("async function cmp(", 0, 3000, 2);
all("function Tli(", 0, 700, 2);
all("function T4r(", 0, 700, 2);
all("function q3e(", 0, 300, 2);
all("async function ump(", 0, 700, 2);
all("function amp(", 0, 400, 2);
writeFileSync("docs/upstream-extraction/v2.1.239/snippets/gold-rev-cmp.txt", out.join("\n"));
console.log("ok");
