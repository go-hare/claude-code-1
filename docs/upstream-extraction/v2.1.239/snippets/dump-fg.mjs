import { readFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
const needle = Buffer.from("function Fg(");
let from = 0;
let n = 0;
while (n < 6) {
  const i = buf.indexOf(needle, from);
  if (i < 0) break;
  n++;
  from = i + 1;
  const s = buf.subarray(i, i + 250).toString("latin1").replace(/[^\x20-\x7e]/g, ".");
  console.log("----", i);
  console.log(s);
}
const n2 = Buffer.from("{rows:U}=Fg(");
console.log("call", buf.indexOf(n2));
