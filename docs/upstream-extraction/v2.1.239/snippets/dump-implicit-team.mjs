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
  "session team not initialized",
  "subagent_teammate_no_team_name",
  "This should have happened at startup when agent swarms are enabled",
  "Agent Teams is not yet available",
  "B4f=",
  "B4f=/",
  "/^[a-zA-Z0-9]",
  "name must start with a letter or digit and contain only letters",
  "Already leading team",
  "team_name is required for TeamCreate",
  "Call TeamCreate first",
  "session-derived team name",
  "implicit in-process team",
  "assistant-",
  "initializeAssistantTeam",
  "var B4f",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 12).join(",")}]`);
  if (hs.length === 0) continue;
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 250, 2200));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-implicit-team.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
