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
  "async function uAl",
  "function uAl",
  "uAl=",
  "The following skills were invoked",
  "Continue to follow these guidelines",
  "skills were invoked in this session",
  "createSkillAttachmentIfNeeded",
  "type:\"invoked_skills\"",
  "type:'invoked_skills'",
  "invoked_skills",
  "do not treat",
  "original invocation",
  "skill reminder",
  "function uq()",
  "MODAL_TRANSCRIPT",
  "transcriptPeek",
  "slashCommandPanel",
  "/config",
  "cover the latest",
  "latest messages",
  "vimMode===",
  "setVimMode",
  "editorMode===\"vim\"",
  "AgentView",
  "ignoreNextClick",
  "lastFocusAt",
  "FOCUS_IN",
  "focusIn",
  "existsSync(e.cwd)",
  "existsSync(t.cwd)",
  "directory no longer exists",
  "crossProjectResume",
  "allProjects",
  "all-projects",
  "organization policy",
  "policy violation",
  "shouldRetry:!1",
  "usOnlyInference",
  "US-only-inference",
  "us_only_inference",
  "costMultiplier",
  "1.1x",
  "*1.1",
  "pendingSgr",
  "incompleteCsi",
  "35;150;7M",
  "keepAliveWhile",
  "SessionStart",
  "literal empty",
  "empty tags",
  "stripTags",
  "<insight>",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 8).join(",")}]`);
  for (const i of hs.slice(0, 3)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 80, 600));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unknown21-round2b.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
