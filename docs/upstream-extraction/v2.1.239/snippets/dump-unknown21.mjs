import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
function hits(needle, from = 0, until = buf.length, max = 8) {
  const n = Buffer.from(needle);
  const out = [];
  let i = from;
  while (out.length < max) {
    const j = buf.indexOf(n, i);
    if (j < 0 || j >= until) break;
    out.push(j);
    i = j + 1;
  }
  return out;
}
function around(i, before, after) {
  return ascii(
    buf.subarray(Math.max(0, i - before), Math.min(buf.length, i + after)).toString("latin1"),
  );
}

const needles = [
  // #27 theme
  "effortUltra",
  "effort_ultra",
  "ultracode",
  "customTheme",
  "themeOverrides",
  // #20 dark-ansi expanded
  "dark-ansi",
  "ansi:black",
  "expanded tool",
  "renderToolResult",
  // #42 masked
  "mask!==",
  "mask!=",
  "mask&&",
  "if(mask)",
  "if(!mask)",
  "mask?\"\":",
  "killRing",
  // #26 mouse
  "35;150",
  "incompleteMouse",
  "mouseBuf",
  "sgrResidue",
  "orphan SGR",
  // #29 agent vim
  "editorMode",
  "vimMode",
  "INSERT",
  // #24 insights
  "insights",
  "empty tag",
  // #1 cost
  "US-only",
  "usOnly",
  "data_residency",
  "data-residency",
  "1.1*",
  "*1.1",
  "1.1*",
  // #2/#21 fullscreen offer
  "fullscreenRenderer",
  "tuiFullscreen",
  "offerFullscreen",
  "shownOnLaunch",
  "fullscreenPrompt",
  "launchCount",
  // #33 focus
  "focusGained",
  "ignoreNextClick",
  "pendingFocus",
  // #34 peek
  "peek",
  "pinAbove",
  "transcriptAbove",
  // #10 jetbrains
  "EditTool",
  "isJetBrains",
  "ideConnected",
  // #28 otel
  "traceparent",
  "startActiveSpan",
  "preToolUse",
  "deferredTools",
  // #39 title
  "syncTitle",
  "lastTitle",
  "titleDedup",
  "session_title",
  // #45 compact reminder
  "compaction",
  "skill arguments",
  "do not re-run",
  // #11 queued
  "queuedCommands",
  "queuedInput",
  "drainQueue",
  // #19 resume
  "crossProjectResume",
  "cwdExists",
  // #37 hooks
  "function dme",
  "getOriginalCwd",
  "os.homedir",
  // #44 policy
  "shouldRetry",
  "policy_rejected",
  "org_policy",
  // #47 keepalive
  "SessionStart",
  "keepAlive",
  "keep-alive",
  // #50
  "describeSelf",
  "function DHm",
  "yourself",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" [${hs.join(",")}] n=${hs.length}`);
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 90, 180));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unknown21.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
