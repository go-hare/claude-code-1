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
  return ascii(buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"));
}
const needles = [
  // #21 / #2 fullscreen offer
  "fullscreenUpsellSeenCount",
  "function Npf",
  "function ckb",
  "Ufn",
  "tengu_ochre_hollow",
  "Try the new fullscreen",
  "fullscreen renderer?",
  "FORCE_FULLSCREEN_UPSELL",
  // #1 cost 1.1x
  "1.1*",
  "*1.1",
  "1.1x",
  "US-only-inference",
  "usOnlyInference",
  "dataResidencyPremium",
  "residencyPremium",
  "inferencePremium",
  // #20 dark-ansi expanded tool
  "expandedTool",
  "toolResultColor",
  "ansi:cyanBright",
  "darkAnsiTheme",
  // #26 mouse split
  "35;150;7M",
  "pendingSgr",
  "incompleteCsi",
  "[<35;",
  // #24 insights tags
  "literal tag",
  "<insight>",
  "</insight>",
  "empty tag",
  "stripTags",
  // #10 jetbrains
  "JediTerm",
  "isJetBrainsIdeTerminal",
  // #29 agent vim
  "vimMode===",
  "agent view",
  // #33 focus click
  "ignoreNextClick",
  "gained focus",
  // #34 slash pin
  "transcriptPeek",
  "MODAL_TRANSCRIPT",
  // #37 hooks cwd
  "posix_spawn",
  "function dme",
  // #39 title
  "titleDedup",
  "titleUpdate",
  // #44 org policy
  "organization policy",
  "policy check",
  // #45 compact reminder
  "after compaction",
  "do not re-run",
  // #47 keepalive
  "keepAliveWhile",
  "SessionStart",
  // #19 resume
  "resume in the current",
  "deleted directory",
  // #15 mcp
  "setMcpServers",
  "stuck in a failed",
  // #11 esc queue
  "queued prompt",
  "finish early",
  // #27 custom theme
  "function loadCustomThemes",
  "effortUltra",
  // #50
  "You are sending to yourself",
  "no agent named",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" [${hs.join(",")}]`);
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 120, 280));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unknown24.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
