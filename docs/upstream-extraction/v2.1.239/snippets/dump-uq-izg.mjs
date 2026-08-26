import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function dump(name, needles, before = 80, after = 600) {
  const parts = [];
  for (const n of needles) {
    const needle = Buffer.from(n);
    const hits = [];
    let from = 0;
    while (true) {
      const i = buf.indexOf(needle, from);
      if (i < 0) break;
      hits.push(i);
      from = i + 1;
      if (hits.length >= 8) break;
    }
    parts.push(`#### "${n}" ${hits.length} [${hits.join(", ")}]`);
    for (const i of hits.slice(0, 4)) {
      parts.push(buf.subarray(Math.max(0, i - before), Math.min(buf.length, i + after)).toString("latin1"));
      parts.push("---");
    }
  }
  writeFileSync(`docs/upstream-extraction/v2.1.239/snippets/${name}`, parts.join("\n"));
  console.log(name, "ok");
}

dump("gold-uq.txt", [
  "function uq(",
  "uq=function",
  ",uq=()=>",
  "let uq=",
  "uq(){",
]);

dump("gold-izg-opt.txt", [
  "QPo??{start:0,end:",
  "showAbove?1:0)+(QPo",
  "pTe&&Hi(",
  "clampFieldRows",
]);
