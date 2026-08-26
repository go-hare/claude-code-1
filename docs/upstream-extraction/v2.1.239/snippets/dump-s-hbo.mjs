import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function around(label, i, before, after) {
  return `#### ${label} ${i}\n` + ascii(buf.subarray(Math.max(0, i - before), Math.min(buf.length, i + after)).toString("latin1"));
}

const parts = [];
// S() is just before o.moveFocus(w)}return Mi({"selection:extendLeft"
const i = buf.indexOf(Buffer.from('o.moveFocus(w)}return Mi({"selection:extendLeft"'));
parts.push(around("S+extend", i, 3500, 200));

// FilePathLink width context provider
for (const n of [
  "hbo.Provider",
  "createContext(null)",
  "Path hidden (unsupported characters)",
  "function HN(",
]) {
  const needle = Buffer.from(n);
  const hits = [];
  let from = 0;
  while (hits.length < 6) {
    const j = buf.indexOf(needle, from);
    if (j < 0) break;
    hits.push(j);
    from = j + 1;
  }
  parts.push(`\n#### "${n}" [${hits.join(",")}]`);
  for (const j of hits.slice(0, 3)) {
    parts.push(ascii(buf.subarray(Math.max(0, j - 150), Math.min(buf.length, j + 250)).toString("latin1")));
    parts.push("---");
  }
}

writeFileSync("docs/upstream-extraction/v2.1.239/snippets/gold-s-hbo.txt", parts.join("\n"));
console.log("ok", i);
