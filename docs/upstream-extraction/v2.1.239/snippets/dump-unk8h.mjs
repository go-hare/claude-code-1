import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function around(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"),
  );
}

const lines = [];
lines.push("==== restore 322378200 ====");
lines.push(around(322378200, 800, 900));

lines.push("==== someInFlightDrain impl search ====");
// find function body
const n = Buffer.from("setInFlightDrainBatch(");
let i = 0;
let c = 0;
while (c < 8) {
  const j = buf.indexOf(n, i);
  if (j < 0) break;
  const text = around(j, 80, 400);
  if (text.includes("function ") || text.includes("this.") || text.includes("inFlight")) {
    lines.push(`--- ${j} ---`);
    lines.push(text);
  }
  i = j + 1;
  c++;
}

const n2 = Buffer.from("function Ntl(");
const j2 = buf.indexOf(n2);
lines.push(`==== Ntl at ${j2} ====`);
if (j2 >= 0) lines.push(around(j2, 40, 3500));

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk8h.txt",
  lines.join("\n"),
);
console.log("ok");
