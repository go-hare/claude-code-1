import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

const start = buf.indexOf(Buffer.from("async function zqe("));
if (start < 0) {
  console.log("zqe not found");
  process.exit(1);
}

const sl = buf.subarray(start, start + 12000);
let s = "";
for (const c of sl) s += c >= 32 && c < 127 ? String.fromCharCode(c) : ".";

// Find m() / m?.() call sites in this window
const hits = [];
for (const n of ["m?.()", "m()", "onTerminalSuccess"]) {
  let i = 0;
  while (true) {
    const j = s.indexOf(n, i);
    if (j < 0) break;
    hits.push({ n, j, ctx: s.slice(Math.max(0, j - 80), j + 120) });
    i = j + 1;
  }
}

writeFileSync(
  new URL("./gold-zqe-m.txt", import.meta.url),
  `start=${start} len=${s.length}\n\n` +
    hits.map(h => `--- ${h.n} @${h.j} ---\n${h.ctx}\n`).join("\n") +
    "\n\n==== body excerpt 3500-7000 ====\n" +
    s.slice(3500, 7000),
  "utf8",
);
console.log("hits", hits.length, "wrote");
