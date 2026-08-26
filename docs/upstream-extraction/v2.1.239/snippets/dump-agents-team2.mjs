import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 12) {
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
  "Deprecated; ignored. The session has a single implicit team.",
  "Deprecated; ignored. Subagents inherit the parent session",
  "single implicit team",
  "TeamCreate",
  "TeamDelete",
  "team_name is required",
  "Makes it addressable via SendMessage",
  "name must start with a letter or digit",
  "is reserved",
  "SendMessage routes it to the main conversation",
  "Only synchronous subagents are supported",
  "The name parameter is not available in this context",
  "Z1w",
  "formatTeammatesSection",
  "Teammates:",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 8).join(",")}]`);
  if (hs.length === 0) continue;
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 80, 1600));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-agents-team2.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
