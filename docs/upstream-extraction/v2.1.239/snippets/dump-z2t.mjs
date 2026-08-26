import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function dumpFn(name, after = 400) {
  const needle = Buffer.from("function " + name + "(");
  const hits = [];
  let from = 0;
  while (hits.length < 4) {
    const i = buf.indexOf(needle, from);
    if (i < 0) break;
    hits.push(i);
    from = i + 1;
  }
  return `#### function ${name} [${hits.join(",")}]\n` +
    hits.slice(0, 2).map((i) => ascii(buf.subarray(i, i + after).toString("latin1"))).join("\n---\n");
}

const tqt = buf.indexOf(Buffer.from("Tqt="), 320180000);
const tqt2 = buf.indexOf(Buffer.from(",Tqt="), 320170000);

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-z2t.txt",
  [
    dumpFn("z2t", 350),
    dumpFn("OEc", 400),
    dumpFn("s_g", 250),
    dumpFn("__r", 250),
    dumpFn("jcs", 200),
    `\n#### Tqt around ${tqt} / ${tqt2}\n`,
    ascii(buf.subarray(320175000, 320185000).toString("latin1")),
  ].join("\n\n"),
);
console.log("ok");
