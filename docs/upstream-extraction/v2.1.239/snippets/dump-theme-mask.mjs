import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
function around(i, before, after) {
  return ascii(
    buf.subarray(Math.max(0, i - before), Math.min(buf.length, i + after)).toString("latin1"),
  );
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

const lines = [];
for (const n of [
  "function loadCustomThemes",
  "loadCustomThemes",
  "getCachedCustomTheme",
  "customThemeBase",
  "effortUltra",
  "commitUserThemes",
  "function QV",
  "QV()?.name",
  "MFn(QV",
  "function G1w",
  "function sBr",
  "addToHistory",
  "pushToKillRing",
  "getLastKill",
  "double-escape",
  "Esc again to clear",
]) {
  const hs = hits(n);
  lines.push(`#### "${n}" [${hs.join(",")}]`);
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 150, 400));
  }
}

writeFileSync("docs/upstream-extraction/v2.1.239/snippets/gold-theme-mask.txt", lines.join("\n"));
console.log("ok");
