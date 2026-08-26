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
  "function WIe",
  "function WIe(",
  "[web-fetch agent] isolation:",
  "built-in web-fetch agent always runs as a local agent",
  "web-fetch agent",
  'agentType:"web-fetch"',
  "agentType:'web-fetch'",
  "subagent_type: \"web-fetch\"",
  "lN=",
  "teammateColors",
  "teammateColors:",
  "assignments:new Map",
  "function Tno",
  "Tno()",
  "availability is gated",
  'isolation: "remote"',
  "USER_TYPE",
  "async function MQA",
  "storageV5",
  "# TeamCreate",
  "TeamCreate",
  "TeamDelete",
  "initializeAssistantTeam",
  "assistant-${",
  "assistant-",
  "CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME",
  "existingTeamName",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 12).join(",")}]`);
  if (hs.length === 0) continue;
  const take = n === "USER_TYPE" || n === "storageV5" || n === "TeamCreate" || n === "assistant-"
    ? 1
    : 3;
  for (const i of hs.slice(0, take)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 160, 2200));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-leftover-invent.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
