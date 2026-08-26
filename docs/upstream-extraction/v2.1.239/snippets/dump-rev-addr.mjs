import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const txt = readFileSync(exe).toString("latin1");
const ascii = (s) => s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
const out = [];
function all(needle, before, after, cap = 4) {
  out.push(`\n##### ${needle}`);
  let i = -1, n = 0;
  while ((i = txt.indexOf(needle, i + 1)) !== -1 && n < cap) {
    n++;
    out.push(`--- @${i} ---\n` + ascii(txt.slice(Math.max(0, i - before), i + after)));
  }
  out.push(`(shown ${n})`);
}
all("iYb=", 200, 400, 4);
all("function p_a(", 0, 300, 3);
all("function Qei(", 0, 900, 3);
all("Cross-session idle notice", 900, 900, 6);
all("function b7(", 0, 400, 3);
all("function fBr(", 0, 600, 3);
all("function gWd(", 0, 300, 3);
writeFileSync("docs/upstream-extraction/v2.1.239/snippets/gold-rev-addr.txt", out.join("\n"));
console.log("ok");
