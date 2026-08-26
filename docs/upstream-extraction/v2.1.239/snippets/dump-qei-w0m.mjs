import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function findAll(n, max = 6) {
  const needle = Buffer.from(n);
  const out = [];
  let i = 0;
  while (out.length < max) {
    const j = buf.indexOf(needle, i);
    if (j < 0) break;
    out.push(j);
    i = j + 1;
  }
  return out;
}

function around(i, b, a) {
  const sl = buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a));
  let s = "";
  for (const c of sl) s += c >= 32 && c < 127 ? String.fromCharCode(c) : ".";
  return s;
}

const needles = [
  "function Qei(",
  "function ELe(",
  "function Yc(",
  "function VEt(",
  "function p_a(",
  "function DEe(",
  "w0m=\"\"",
  "Cross-machine messaging is unavailable",
  "is not a local socket address",
  "first line of a plain-text",
];

let out = "";
for (const n of needles) {
  const offs = findAll(n, 4);
  out += `\n==== ${JSON.stringify(n)} hits=${offs.length} ====\n`;
  for (const o of offs.slice(0, 2)) {
    out += `@${o}:\n${around(o, 40, 1600)}\n\n`;
  }
}

writeFileSync(new URL("./gold-qei-w0m.txt", import.meta.url), out, "utf8");
console.log("wrote", out.length);
