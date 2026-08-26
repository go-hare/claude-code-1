import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 16) {
  const n = Buffer.from(needle);
  const out = [];
  let i = 0;
  while (out.length < max) {
    const j = buf.indexOf(n, i);
    if (j < 0) break;
    out.push(j);
    i = j + 1;
  }
  return out;
}

function around(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"),
  );
}

const needles = [
  "function T0m",
  "function XRw",
  "function A0m",
  "function YRw",
  "function KRw",
  "function l0m",
  "function E0m",
  "function FTl",
  "function JTl",
  "w0m=",
  "var w0m",
  "var T0m",
  "var XRw",
  "var A0m",
  "var YRw",
  "var KRw",
  "function Kwe",
  "message text must not be a teammate protocol frame",
  "message text must not be a teammate lifecycle",
  "Structured team-protocol messages are only available",
  "reason is only delivered on rejections",
  "reason is required when rejecting a shutdown",
  "shutdown_response must be sent to",
  "required when message is a string",
  "Defaults to the first line of a plain-text message",
  "no \"busy\" state",
  "use TaskUpdate",
  "report progress through your task tools",
  "Recipient: teammate name, \"*\" for broadcast",
  "Recipient: a name from",
  "function BEm",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 12).join(",")}]`);
  if (hs.length === 0) continue;
  const before = n.startsWith("function ") ? 20 : 80;
  const after = n.startsWith("function ") ? 2800 : 1800;
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, before, after));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-sendmsg-schema.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
