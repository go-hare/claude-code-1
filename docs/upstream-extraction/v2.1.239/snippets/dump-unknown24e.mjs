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
const lines = [];

lines.push("==== fWv dark-ansi ====");
for (const i of hits("fWv=", 4)) {
  lines.push(`--- ${i} ---`);
  lines.push(around(i, 20, 1800));
}

lines.push("\n==== function ZGn ====");
for (const i of hits("function ZGn", 2)) {
  lines.push(around(i, 20, 400));
}

lines.push("\n==== udc callers ====");
for (const n of ["udc(", "udc()", "jfn(", "shouldShowFullscreen", "tui_fullscreen_upsell"]) {
  const hs = hits(n, 6);
  lines.push(`\n#### ${n} [${hs.join(",")}]`);
  for (const i of hs.slice(0, 2)) lines.push(around(i, 80, 400));
}

lines.push("\n==== official upsell gate ====");
for (const n of [
  "function Npf",
  "ochre",
  "fresh_install_on",
  "tui_fullscreen_upsell",
  "Yes, try it",
  "Could not",
]) {
  const hs = hits(n, 4);
  lines.push(`\n#### ${n} [${hs.join(",")}]`);
  for (const i of hs.slice(0, 1)) lines.push(around(i, 60, 500));
}

// more promising UNKNOWN knives
lines.push("\n==== more knives ====");
for (const n of [
  "function parseKeypress",
  "pendingIncomplete",
  "incomplete+=",
  "tokenizer.buffer",
  "FOCUS_IN",
  "ignoreNextMouse",
  "lastFocusAt",
  "focusGainedAt",
  "queuedCommands",
  "abortOnEscape",
  "organization_policy_violation",
  "policy_rejection",
  "do_not_resend",
  "keep-alive",
  "keep_alive",
  "SessionStart hook",
  "Setup hook",
]) {
  const hs = hits(n, 4);
  lines.push(`${n} count=${hs.length}`);
  if (hs.length) lines.push(around(hs[0], 80, 280));
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unknown24e.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
