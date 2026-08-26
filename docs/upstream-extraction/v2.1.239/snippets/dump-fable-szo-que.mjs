import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function findAll(n, max = 10) {
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
  'Que=["sonnet","opus","haiku","fable"]',
  "aVt={sonnet:",
  "Balanced performance",
  "Inherit from parent",
  "function SZo(",
  "function QHu(",
  "fable5:",
  "claude-fable-5",
  "us.anthropic.claude-fable-5",
  "anthropic.claude-fable-5",
  "function Ema(",
  "getAgentModelOptions",
];

let out = "";
for (const n of needles) {
  const offs = findAll(n, 6);
  out += `\n==== ${JSON.stringify(n)} hits=${offs.length} ====\n`;
  for (const o of offs.slice(0, 4)) {
    out += `@${o}:\n${around(o, 80, 700)}\n\n`;
  }
}

writeFileSync(new URL("./gold-fable-szo-que.txt", import.meta.url), out, "utf8");
console.log("wrote", out.length);
