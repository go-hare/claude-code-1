import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
const txt = buf.toString("latin1");
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
const out = [];
function all(needle, before, after, cap = 40) {
  out.push(`\n##### needle=${JSON.stringify(needle)}`);
  let i = -1;
  let n = 0;
  while ((i = txt.indexOf(needle, i + 1)) !== -1 && n < cap) {
    n++;
    out.push(
      `--- @${i} ---\n` +
        ascii(txt.slice(Math.max(0, i - before), i + after)),
    );
  }
  out.push(`(total shown ${n})`);
}
all("function Qen(", 0, 900, 3);
all("function Zen(", 0, 400, 3);
all("function Jen(", 0, 600, 3);
all("DEe(", 200, 200, 40);
all("Jen(", 220, 160, 40);
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-rev-selfsend.txt",
  out.join("\n"),
);
console.log("ok", out.length);
