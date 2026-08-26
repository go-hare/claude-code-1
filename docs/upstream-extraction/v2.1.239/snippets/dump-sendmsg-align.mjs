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
  "Plain text message content",
  "structured messages cannot be sent cross-session",
  "structured messages cannot be sent with notify_when_idle",
  "Don't originate shutdown_request",
  "Protocol responses (legacy)",
  "check if tests pass over there",
  "shutdown_request",
  "type: z.literal('shutdown_request')",
  'type:"shutdown_request"',
  "Recipient: teammate name",
  "notify_when_idle",
  "Cross-session",
  "only plain text",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 12).join(",")}]`);
  if (hs.length === 0) continue;
  const before = 200;
  const after = 2200;
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, before, after));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-sendmsg-align.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
