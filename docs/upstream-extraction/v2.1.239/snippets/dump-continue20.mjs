import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, from = 0, until = buf.length, max = 10) {
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
    buf
      .subarray(Math.max(0, i - before), Math.min(buf.length, i + after))
      .toString("latin1"),
  );
}

const needles = [
  // #23 BOM
  "UTF-8 BOM",
  "utf-8 bom",
  "starts with a BOM",
  "\\uFEFF",
  "^\uFEFF",
  "charCodeAt(0)===65279",
  "charCodeAt(0)===0xFEFF",
  // #10 jetbrains 5s
  "5000",
  "JetBrains",
  "jediTerm",
  "JediTerm",
  "plugin is connected",
  // #20 dark-ansi
  "dark-ansi",
  "expandedTool",
  "toolResult",
  // #27 badge
  "ultracode",
  "effortLevel",
  "statusBadge",
  "badge",
  // #26 mouse
  "1006h",
  "mouse tracking",
  "DECSET",
  "SGR mouse",
  "split across",
  // #29 agent vim
  "vim mode",
  "NORMAL mode",
  "agent view",
  // #42 masked
  "mask",
  "password-style",
  "login code",
  "echo:false",
  // #24 insights
  "<tag>",
  "literal",
  // #34 peek
  "transcriptPeek",
  "peekRows",
  "pinned above",
  // #45 compact reminder
  "after compaction",
  "skill's original",
  "compact reminder",
  // #28 otel
  "PreToolUse",
  "deferred by",
  "original turn",
  // #19 resume cd
  "resume in the current",
  "all-projects",
  "deleted directory",
  // #37 hooks
  "posix_spawn ENOENT",
  "project root or home",
  // #51 listing
  "function GCe",
  "live teammates",
  // #50
  "no agent named",
  "your own name",
  "sending to yourself",
  "registeredName",
  // #39
  "titleUpdate",
  "sessionTitle",
  "rate-limit",
  // #11
  "queued",
  "finish early",
  // #33
  "focus click",
  "gained focus",
  "mousedown",
  // #44
  "organization policy",
  "policy check",
  // #1
  "usOnlyInference",
  "us_only",
  "dataResidency",
  "1.1",
  "inference premium",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n, 0, buf.length, 6);
  lines.push(`#### "${n}" [${hs.join(",")}] count~${hs.length}`);
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 80, 160));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-continue20.txt",
  lines.join("\n"),
);
console.log("needles", needles.length, "lines", lines.length);
