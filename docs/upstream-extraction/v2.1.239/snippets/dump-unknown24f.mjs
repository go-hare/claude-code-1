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

lines.push("==== dialog shown + show gate ====");
for (const n of [
  "tengu_fullscreen_upsell_dialog_shown",
  "CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL",
  "fullscreenUpsellSeenCount??0)<M4r",
  "fresh_install_on",
  "Selected text auto-copies",
]) {
  const hs = hits(n, 4);
  lines.push(`\n#### ${n} [${hs.join(",")}]`);
  for (const i of hs.slice(0, 2)) lines.push(around(i, 200, 700));
}

lines.push("\n==== fWv rest ====");
lines.push(around(306391774, 0, 2200));

lines.push("\n==== expanded tool color ====");
for (const n of [
  "expanded tool",
  "toolResult",
  "verbose:",
  "isCollapsed",
  "userMessageBackgroundHover",
  "composerSidebarBackground",
  "messageActionsBackground",
]) {
  const hs = hits(n, 3);
  lines.push(`\n#### ${n} count=${hs.length}`);
  if (hs.length) lines.push(around(hs[0], 80, 350));
}

lines.push("\n==== KQd firstStart ====");
for (const n of ["function KQd", "function r0a", "firstStartVersion:"]) {
  const hs = hits(n, 3);
  lines.push(`\n#### ${n} [${hs.join(",")}]`);
  for (const i of hs.slice(0, 1)) lines.push(around(i, 40, 500));
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unknown24f.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
