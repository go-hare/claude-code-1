import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
function hits(needle, max = 8) {
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
  // #45 compact skill reminder
  "invoked_skills",
  "do not re-invoke",
  "do not re-run the skill",
  "original arguments",
  "skill's original",
  "not a new request",
  "already invoked",
  // #39 title rate limit
  "updateBridgeSessionTitle",
  "title update",
  "lastTitle",
  "titleAt",
  "titleRate",
  "session title sync",
  "runaway",
  // #10 jetbrains 5s
  "5000",
  "isJetBrains",
  "JediTerm",
  "jetbrains plugin",
  // #29 agent vim
  "vimMode",
  "NORMAL mode",
  "keeps your text",
  // #34 slash panel
  "slash-command",
  "pinned above",
  "transcript above",
  "bottom-anchored",
  // #1 cost 1.1
  "1.1",
  "us-only",
  "US only",
  "data residency",
  "residency workspace",
  // #24 insights
  "insights",
  "<empty>",
  "literal",
  // #44 org policy
  "organization policy check",
  "policy rejected",
  "rejected by an organization",
  "shouldRetry:!1",
  // #28 otel
  "PreToolUse",
  "original turn",
  "trace fragmentation",
  "startActiveSpan",
  // #33 focus
  "FOCUS_IN",
  "focus-in",
  "ignoreNext",
  "gainedFocus",
  // #37 hooks cwd
  "posix_spawn",
  "function dme",
  "getOriginalCwd",
  // #11 queued
  "queued prompt",
  "prompt queued",
  // #19 resume
  "all-projects",
  "resume in the current",
  // #50
  "You are sending to yourself",
  "a message to yourself",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 6).join(",")}]`);
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 100, 320));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unknown21-round2.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
