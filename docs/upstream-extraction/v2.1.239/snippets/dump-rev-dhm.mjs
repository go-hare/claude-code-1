import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const txt = readFileSync(exe).toString("latin1");
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
const out = [];
function all(needle, before, after, cap = 6) {
  out.push(`\n##### needle=${JSON.stringify(needle)}`);
  let i = -1;
  let n = 0;
  while ((i = txt.indexOf(needle, i + 1)) !== -1 && n < cap) {
    n++;
    out.push(`--- @${i} ---\n` + ascii(txt.slice(Math.max(0, i - before), i + after)));
  }
  out.push(`(shown ${n})`);
}
all("function DHm(", 0, 700, 2);
all("function G1w(", 0, 700, 2);
all("function MFn(", 0, 800, 2);
all("function lRw(", 0, 500, 2);
all("function Jio(", 0, 500, 2);
all("function VEt(", 0, 400, 2);
all("function Xen(", 0, 500, 2);
all("function v_a(", 0, 300, 2);
all("function sBr(", 0, 300, 2);
all("function iti(", 0, 300, 2);
all("var sti", 0, 120, 3);
writeFileSync("docs/upstream-extraction/v2.1.239/snippets/gold-rev-dhm.txt", out.join("\n"));
console.log("ok");
