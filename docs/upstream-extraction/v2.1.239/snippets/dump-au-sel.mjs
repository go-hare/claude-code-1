import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function around(i, before, after) {
  return `#### ${i}\n` + ascii(buf.subarray(Math.max(0, i - before), Math.min(buf.length, i + after)).toString("latin1"));
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-au-sel.txt",
  [
    around(320084634, 2500, 1500),
    "\n\n==== 320147956 ====\n",
    around(320147956, 400, 400),
    "\n\n==== extend handlers ====\n",
    ...["selection:extendLeft","selection:extendRight","shift+left","moveFocus"].map((n) => {
      const needle = Buffer.from(n);
      const hits = [];
      let from = 300000000;
      while (from < 322000000) {
        const i = buf.indexOf(needle, from);
        if (i < 0 || i >= 322000000) break;
        hits.push(i);
        from = i + 1;
        if (hits.length >= 6) break;
      }
      return `#### "${n}" [${hits.join(",")}]` + hits.slice(0, 3).map((i) => "\n" + around(i, 200, 400)).join("\n");
    }),
  ].join("\n"),
);
console.log("ok");
